import { createNetworkClient } from "../network/client.mjs";
import {
  ccuUpdateManifestName,
  validateCcuUpdateManifest
} from "../release/ccu-update-manifest.mjs";
import { RUNTIME_PLATFORM } from "../config/constants.mjs";
import { resolveLatestCcuRelease } from "../release/github-version.mjs";
import { HttpReleaseProvider } from "../release/provider.mjs";
import { readSettings } from "../settings/store.mjs";
import { writeUpdateCacheAtomic } from "./cache.mjs";

const CCU_RELEASES_URL = "https://github.com/Cec1c/codex-cli-ultra/releases";

function manifestProvider(manifestUrl, options, network, manifestName) {
  return new HttpReleaseProvider({
    manifestUrl,
    fetchImpl: network.fetch,
    headers: options.githubToken
      ? { Authorization: `Bearer ${options.githubToken}` }
      : {},
    manifestName
  });
}

async function readUpdateManifest(manifestUrl, options, network, expected = {}) {
  const runtime = options.runtime ?? RUNTIME_PLATFORM;
  const provider = manifestProvider(
    manifestUrl,
    options,
    network,
    ccuUpdateManifestName(runtime)
  );
  return validateCcuUpdateManifest(await provider.readManifest(), expected);
}

export async function checkForCcuUpdate(options = {}) {
  const runtime = options.runtime ?? RUNTIME_PLATFORM;
  const manifestName = ccuUpdateManifestName(runtime);
  const settings =
    options.settings ??
    await (options.readSettings ?? readSettings)(options.installRoot);
  const network = options.networkClient ?? createNetworkClient(settings, options);
  try {
    let latest;
    let manifest = null;
    try {
      latest = await (options.resolveLatestCcuRelease ?? resolveLatestCcuRelease)({
        fetchImpl: network.fetch,
        token: options.githubToken,
        runtime
      });
    } catch (apiError) {
      const manifestUrl =
        options.latestManifestUrl ??
        `${CCU_RELEASES_URL}/latest/download/${manifestName}`;
      try {
        manifest = await readUpdateManifest(
          manifestUrl,
          options,
          network,
          { platform: runtime.id }
        );
      } catch (manifestError) {
        throw new Error(
          `GitHub API update check failed: ${apiError.message}; public manifest fallback failed: ${manifestError.message}`,
          { cause: manifestError }
        );
      }
      latest = {
        repository: "Cec1c/codex-cli-ultra",
        tag: manifest.releaseTag,
        version: manifest.ccuVersion,
        url: `${CCU_RELEASES_URL}/tag/${manifest.releaseTag}`,
        updateManifestUrl: manifestUrl
      };
    }
    if (latest.updateManifestUrl) {
      manifest ??= await readUpdateManifest(
        latest.updateManifestUrl,
        options,
        network,
        { releaseTag: latest.tag, platform: runtime.id }
      );
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
      `CCU ${checked.latest.version} does not provide ${ccuUpdateManifestName(options.runtime ?? RUNTIME_PLATFORM)}`
    );
  }
  const settings = checked.settings;
  const network = options.networkClient ?? createNetworkClient(settings, options);
  return {
    ...checked,
    provider: manifestProvider(
      checked.latest.updateManifestUrl,
      options,
      network,
      ccuUpdateManifestName(options.runtime ?? RUNTIME_PLATFORM)
    ),
    networkClient: network,
    ownsNetworkClient: !options.networkClient
  };
}
