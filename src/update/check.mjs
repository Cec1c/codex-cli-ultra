import { createNetworkClient } from "../network/client.mjs";
import {
  CCU_UPDATE_MANIFEST_NAME,
  validateCcuUpdateManifest
} from "../release/ccu-update-manifest.mjs";
import { resolveLatestCcuRelease } from "../release/github-version.mjs";
import { HttpReleaseProvider } from "../release/provider.mjs";
import { readSettings } from "../settings/store.mjs";
import { writeUpdateCacheAtomic } from "./cache.mjs";

export async function checkForCcuUpdate(options = {}) {
  const settings =
    options.settings ??
    await (options.readSettings ?? readSettings)(options.installRoot);
  const network = options.networkClient ?? createNetworkClient(settings, options);
  try {
    const latest = await (options.resolveLatestCcuRelease ?? resolveLatestCcuRelease)({
      fetchImpl: network.fetch,
      token: options.githubToken
    });
    let manifest = null;
    if (latest.updateManifestUrl) {
      const provider = new HttpReleaseProvider({
        manifestUrl: latest.updateManifestUrl,
        fetchImpl: network.fetch,
        headers: options.githubToken
          ? { Authorization: `Bearer ${options.githubToken}` }
          : {},
        manifestName: CCU_UPDATE_MANIFEST_NAME
      });
      manifest = validateCcuUpdateManifest(await provider.readManifest(), {
        releaseTag: latest.tag
      });
    }
    const cache = await (options.writeUpdateCacheAtomic ?? writeUpdateCacheAtomic)(
      options.installRoot,
      {
        schemaVersion: 1,
        checkedAt: (options.now ?? new Date()).toISOString(),
        latestCcuVersion: latest.version,
        latestCcuTag: latest.tag,
        packageReady: manifest !== null,
        releaseUrl: latest.url,
        updateManifestUrl: latest.updateManifestUrl,
        bundledForkVersion: manifest?.bundledFork.displayVersion ?? null,
        bundledUpstreamVersion: manifest?.bundledFork.upstreamVersion ?? null,
        checkedWithProxy: network.proxyEnabled
      }
    );
    return { latest, manifest, cache, settings };
  } finally {
    if (!options.networkClient) await network.close();
  }
}

export async function resolveCcuUpdatePackage(options = {}) {
  const checked = await checkForCcuUpdate(options);
  if (options.targetVersion && checked.latest.version !== options.targetVersion) {
    throw new Error(
      `requested CCU ${options.targetVersion}, but latest stable is ${checked.latest.version}`
    );
  }
  if (!checked.latest.updateManifestUrl || !checked.manifest) {
    throw new Error(
      `CCU ${checked.latest.version} does not provide ${CCU_UPDATE_MANIFEST_NAME}`
    );
  }
  const settings = checked.settings;
  const network = options.networkClient ?? createNetworkClient(settings, options);
  return {
    ...checked,
    provider: new HttpReleaseProvider({
      manifestUrl: checked.latest.updateManifestUrl,
      fetchImpl: network.fetch,
      headers: options.githubToken
        ? { Authorization: `Bearer ${options.githubToken}` }
        : {},
      manifestName: CCU_UPDATE_MANIFEST_NAME
    }),
    networkClient: network,
    ownsNetworkClient: !options.networkClient
  };
}
