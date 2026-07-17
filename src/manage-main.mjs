import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveInstallRoot } from "./config/constants.mjs";
import { discoverOfficialCodex } from "./discovery/official-codex.mjs";
import { installManagementBin } from "./installer/bin.mjs";
import { installForkFromProvider } from "./installer/install.mjs";
import {
  addUserPathEntry,
  removeUserPathEntry
} from "./installer/windows-path.mjs";
import {
  FORK_MANIFEST_NAME,
  compareForkReleases,
  validateForkManifest
} from "./release/fork-manifest.mjs";
import { resolveLatestForkRelease } from "./release/github-fork.mjs";
import {
  DirectoryReleaseProvider,
  HttpReleaseProvider
} from "./release/provider.mjs";
import { readState } from "./state/store.mjs";
import { CCU_VERSION } from "./version.mjs";

const USAGE = [
  "Usage:",
  "  codex-ultra version [--json]",
  "  codex-ultra status [--check] [--json]",
  "  codex-ultra install [--manifest-url URL | --release-dir PATH] [--json]",
  "  codex-ultra update [--manifest-url URL | --release-dir PATH] [--json]"
].join("\n");

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (index === args.length - 1 || args[index + 1].startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return args[index + 1];
}

async function readOptionalState(path, readStateImpl) {
  try {
    return await readStateImpl(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function installedManifestPath(active) {
  return join(
    dirname(active.binaryPath),
    "..",
    "..",
    FORK_MANIFEST_NAME
  );
}

async function readInstalledManifest(state, readFileImpl = readFile) {
  if (state?.active === null || state?.active === undefined) return null;
  try {
    return validateForkManifest(
      JSON.parse(await readFileImpl(installedManifestPath(state.active), "utf8"))
    );
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return null;
  }
}

async function collectStatus(options) {
  const installRoot = options.installRoot;
  const statePath = join(installRoot, "state.json");
  const state = await readOptionalState(
    statePath,
    options.readState ?? readState
  );
  let official = state?.official ?? null;
  if (official === null) {
    try {
      official = await (options.discoverOfficialCodex ?? discoverOfficialCodex)({
        installRoot,
        env: options.env
      });
    } catch {
      official = null;
    }
  }
  const installedManifest = await readInstalledManifest(
    state,
    options.readFile ?? readFile
  );
  return {
    ccuVersion: CCU_VERSION,
    installRoot,
    official: official === null
      ? { installed: false }
      : {
          installed: true,
          version: official.version,
          binaryPath: official.binaryPath
        },
    fork: state?.active === null || state?.active === undefined
      ? { installed: false }
      : {
          installed: true,
          releaseId: state.active.releaseId,
          displayVersion:
            installedManifest?.displayVersion ?? state.active.releaseId,
          upstreamVersion: state.active.upstreamVersion,
          upstreamTag: installedManifest?.upstreamTag ?? null,
          upstreamCommit: installedManifest?.upstreamCommit ?? null,
          forkCommit: installedManifest?.forkCommit ?? null,
          ultraRevision: state.active.ultraRevision,
          i18nApiVersion: installedManifest?.i18nApiVersion ?? null,
          binaryPath: state.active.binaryPath,
          manifestValid: installedManifest !== null
        },
    installedManifest
  };
}

function writeJson(stdout, value) {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeVersion(stdout, status) {
  stdout.write(`codex-cli-ultra ${status.ccuVersion}\n`);
  if (!status.fork.installed) {
    stdout.write("fork not installed\n");
    return;
  }
  const details = [
    `upstream ${status.fork.upstreamVersion}`,
    status.fork.i18nApiVersion === null
      ? null
      : `i18n API ${status.fork.i18nApiVersion}`
  ].filter(Boolean).join(", ");
  stdout.write(`fork ${status.fork.displayVersion} (${details})\n`);
}

function writeStatus(stdout, status) {
  writeVersion(stdout, status);
  stdout.write(
    status.official.installed
      ? `official ${status.official.version} at ${status.official.binaryPath}\n`
      : "official not found\n"
  );
  if (status.fork.installed) {
    stdout.write(`fork binary ${status.fork.binaryPath}\n`);
    if (status.latest) {
      stdout.write(
        status.updateAvailable
          ? `update available: ${status.latest.displayVersion}\n`
          : `up to date: ${status.latest.displayVersion}\n`
      );
    }
  }
}

async function resolveProvider(args, options) {
  const releaseDirectory = optionValue(args, "--release-dir");
  const manifestUrl = optionValue(args, "--manifest-url");
  if (releaseDirectory && manifestUrl) {
    throw new Error("choose only one of --release-dir and --manifest-url");
  }
  if (releaseDirectory) {
    const provider = new DirectoryReleaseProvider(
      resolve(options.cwd, releaseDirectory),
      { manifestName: FORK_MANIFEST_NAME }
    );
    return { provider, manifest: validateForkManifest(await provider.readManifest()) };
  }
  if (manifestUrl) {
    const provider = new HttpReleaseProvider({
      manifestUrl,
      fetchImpl: options.fetchImpl,
      headers: options.githubToken
        ? { Authorization: `Bearer ${options.githubToken}` }
        : {}
    });
    return { provider, manifest: validateForkManifest(await provider.readManifest()) };
  }
  const latest = await (options.resolveLatestForkRelease ?? resolveLatestForkRelease)({
    fetchImpl: options.fetchImpl,
    token: options.githubToken
  });
  return {
    ...latest,
    provider: {
      readManifest: async () => latest.manifest,
      materializeAsset: (...providerArgs) =>
        latest.provider.materializeAsset(...providerArgs)
    }
  };
}

export async function manageMain(options = {}) {
  const args = options.args ?? process.argv.slice(2);
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const installRoot = options.installRoot ?? resolveInstallRoot(env);
  const command = args[0];
  const json = args.includes("--json");
  const context = {
    ...options,
    cwd,
    env,
    installRoot,
    githubToken: options.githubToken ?? env.GITHUB_TOKEN
  };

  if (command === "version" || command === "status") {
    const status = await collectStatus(context);
    if (command === "status" && args.includes("--check")) {
      const latest = await resolveProvider([], context);
      status.latest = latest.manifest;
      status.updateAvailable = status.installedManifest === null
        ? true
        : compareForkReleases(status.installedManifest, latest.manifest) < 0;
    }
    delete status.installedManifest;
    if (json) writeJson(stdout, status);
    else if (command === "version") writeVersion(stdout, status);
    else writeStatus(stdout, status);
    return 0;
  }

  if (command === "install" || command === "update") {
    const release = await resolveProvider(args.slice(1), context);
    const current = await collectStatus(context);
    if (
      current.installedManifest !== null &&
      compareForkReleases(current.installedManifest, release.manifest) >= 0
    ) {
      const report = {
        changed: false,
        releaseId: current.fork.releaseId,
        displayVersion: current.fork.displayVersion,
        message: "installed fork is already current or newer"
      };
      if (json) writeJson(stdout, report);
      else stdout.write(`${report.message}: ${report.displayVersion}\n`);
      return 0;
    }

    const managerSource = options.managerSource ?? resolve(process.argv[1]);
    const launcherSource = options.launcherSource ?? join(
      dirname(managerSource),
      "launcher.mjs"
    );
    const result = await (options.installForkFromProvider ?? installForkFromProvider)({
      provider: release.provider,
      installRoot,
      env,
      discoverOfficialCodex: options.discoverOfficialCodex,
      addPathEntry: options.addPathEntry ?? addUserPathEntry,
      removePathEntry: options.removePathEntry ?? removeUserPathEntry,
      prepareBin: options.prepareBin ?? (({ binDirectory }) =>
        installManagementBin({
          binDirectory,
          managerSource,
          launcherSource
        }))
    });
    const report = {
      changed: result.changed,
      releaseId: result.releaseId,
      displayVersion: result.manifest.displayVersion,
      upstreamVersion: result.manifest.upstreamVersion,
      upstreamTag: result.manifest.upstreamTag,
      forkCommit: result.manifest.forkCommit,
      i18nApiVersion: result.manifest.i18nApiVersion
    };
    if (json) writeJson(stdout, report);
    else {
      stdout.write(
        `${result.changed ? "installed" : "verified"} fork ${report.displayVersion}\n`
      );
      stdout.write("Open a new terminal if codex-ultra is not yet on PATH.\n");
    }
    return 0;
  }

  stderr.write(`${USAGE}\n`);
  return 2;
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  manageMain()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
