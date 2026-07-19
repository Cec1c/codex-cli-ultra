import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { renameSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { resolveInstallRoot } from "./config/constants.mjs";
import { syncBundledContent } from "./content/sync.mjs";
import { discoverOfficialCodex } from "./discovery/official-codex.mjs";
import { installManagementBin } from "./installer/bin.mjs";
import {
  installForkFromProvider,
  pruneInactiveReleases
} from "./installer/install.mjs";
import {
  addUserPathEntry,
  removeUserPathEntry
} from "./installer/windows-path.mjs";
import { uninstallCcu } from "./installer/uninstall.mjs";
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
  "  codex-ultra install [--manifest-url URL | --release-dir PATH] [--enable-statusline | --disable-statusline] [--json]",
  "  codex-ultra update [--manifest-url URL | --release-dir PATH] [--enable-statusline | --disable-statusline] [--json]",
  "  codex-ultra uninstall [--json]",
  "  codex-ultra content sync [--source PATH] [--json]"
].join("\n");

const INSTALL_STAGE_LABELS = Object.freeze({
  manifest: "读取 fork Release 清单",
  "download-fork": "读取内置 Codex 安装包",
  "verify-fork": "校验文件大小与 SHA-256",
  "extract-fork": "解压翻译版 Codex",
  "smoke-version": "验证 Codex 版本",
  "move-release": "安装当前 CCU 版本",
  "prepare-bin": "安装 codex 与 codex-ultra 命令",
  "path-add": "把 CCU 命令加入用户 PATH",
  "state-switch": "切换到已验证版本"
});

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  if (index === args.length - 1 || args[index + 1].startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return args[index + 1];
}

function resolveStatusLinePreset(args) {
  const enable = args.includes("--enable-statusline");
  const disable = args.includes("--disable-statusline");
  if (enable && disable) {
    throw new Error("choose only one of --enable-statusline and --disable-statusline");
  }
  if (enable) return "ccu.hermes";
  if (disable) return null;
  return undefined;
}

function createInstallStageReporter(stdout) {
  let completed = 0;
  const total = Object.keys(INSTALL_STAGE_LABELS).length;
  return async (name) => {
    completed += 1;
    stdout.write(
      `[${completed}/${total}] ${INSTALL_STAGE_LABELS[name] ?? name}\n`
    );
  };
}

async function readOptionalState(path, readStateImpl) {
  try {
    return await readStateImpl(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function cleanupInstalledReleases(options) {
  const state = await readOptionalState(
    join(options.installRoot, "state.json"),
    options.readState ?? readState
  );
  if (state?.active === null || state?.active === undefined) {
    return { removedReleases: [], deferredReleases: [] };
  }
  return (options.pruneInactiveReleases ?? pruneInactiveReleases)(
    options.installRoot,
    state.active.releaseId,
    options
  );
}

export async function waitForInactiveReleaseCleanup(options) {
  const sleep = options.delay ?? delay;
  const intervalMs = options.cleanupIntervalMs ?? 5_000;
  const maxAttempts = options.cleanupMaxAttempts ?? 17_280;
  let cleanup = { removedReleases: [], deferredReleases: [] };
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    cleanup = await cleanupInstalledReleases(options);
    if (cleanup.deferredReleases.length === 0) return cleanup;
    await sleep(intervalMs);
  }
  return cleanup;
}

function scheduleDeferredReleaseCleanup(options) {
  const spawnDetached = options.spawnDetached ?? spawn;
  const managerPath = join(options.installRoot, "bin", "codex-ultra.mjs");
  const child = spawnDetached(
    options.execPath ?? process.execPath,
    [managerPath, "__cleanup-releases"],
    {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...options.env,
        CODEX_ULTRA_HOME: options.installRoot
      }
    }
  );
  child.once?.("error", () => {});
  child.unref?.();
  return child.pid ?? null;
}

function scheduleCleanupIfNeeded(cleanup, options) {
  if (cleanup.deferredReleases.length === 0) return false;
  try {
    const schedule =
      options.scheduleDeferredCleanup ?? scheduleDeferredReleaseCleanup;
    return schedule(options) !== false;
  } catch {
    return false;
  }
}

const INSTALL_ROOT_CLEANUP_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$root = [System.IO.Path]::GetFullPath($env:CCU_INSTALL_ROOT)
$tombstone = [System.IO.Path]::GetFullPath($env:CCU_TOMBSTONE_ROOT)
for ($attempt = 0; $attempt -lt 240; $attempt += 1) {
  if (-not (Test-Path -LiteralPath $root)) { break }
  try {
    [System.IO.Directory]::Move($root, $tombstone)
    break
  }
  catch {}
  Start-Sleep -Milliseconds 250
}
if (Test-Path -LiteralPath $root) { exit 1 }
if (-not (Test-Path -LiteralPath $tombstone)) { exit 0 }
for ($attempt = 0; $attempt -lt 172800; $attempt += 1) {
  try { Remove-Item -LiteralPath $tombstone -Recurse -Force -ErrorAction Stop }
  catch {}
  if (-not (Test-Path -LiteralPath $tombstone)) { exit 0 }
  Start-Sleep -Milliseconds 500
}
exit 1
`;

function scheduleInstallRootCleanup(options) {
  const spawnDetached = options.spawnDetached ?? spawn;
  const tombstoneRoot = join(
    dirname(options.installRoot),
    `.codex-cli-ultra-uninstall-${randomUUID()}`
  );
  const renameInstallRoot = options.renameInstallRoot ?? renameSync;
  const removeTombstone = options.removeTombstone ?? ((path) => {
    rmSync(path, { recursive: true, force: true });
  });
  let movedToTombstone = false;
  try {
    renameInstallRoot(options.installRoot, tombstoneRoot);
    movedToTombstone = true;
  } catch {}
  if (movedToTombstone) {
    try {
      removeTombstone(tombstoneRoot);
      return true;
    } catch {}
  }
  const child = spawnDetached(
    options.pwshExecutable ??
      options.env?.CODEX_CCU_PWSH_EXECUTABLE ??
      "pwsh.exe",
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      INSTALL_ROOT_CLEANUP_SCRIPT
    ],
    {
      detached: true,
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...options.env,
        CCU_INSTALL_ROOT: options.installRoot,
        CCU_TOMBSTONE_ROOT: tombstoneRoot
      }
    }
  );
  child.once?.("error", () => {});
  child.unref?.();
  return Number.isInteger(child.pid) && child.pid > 0;
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

  if (command === "__cleanup-releases") {
    await (
      options.waitForInactiveReleaseCleanup ?? waitForInactiveReleaseCleanup
    )(context);
    return 0;
  }

  if (command === "content" && args[1] === "sync") {
    const managerSource = options.managerSource ?? resolve(process.argv[1]);
    const contentRoot = resolve(
      cwd,
      optionValue(args, "--source") ??
        options.contentRoot ??
        env.CODEX_CCU_CONTENT_ROOT ??
        join(dirname(managerSource), "..")
    );
    const content = await (options.syncBundledContent ?? syncBundledContent)({
      contentRoot,
      installRoot,
      statusLinePreset: resolveStatusLinePreset(args.slice(2)),
      env
    });
    if (json) writeJson(stdout, content);
    else {
      stdout.write(`语言包 ${content.language.locale} 已同步（${content.language.messages} 条消息）\n`);
      stdout.write(`主题 ${content.theme.displayName} 已同步\n`);
      stdout.write(
        content.theme.statusLinePresetEnabled
          ? "CCU 状态栏预设已启用\n"
          : "CCU 状态栏预设未启用\n"
      );
    }
    return 0;
  }

  if (command === "uninstall") {
    const result = await (options.uninstallCcu ?? uninstallCcu)({
      installRoot,
      env,
      removePathEntry: options.removePathEntry ?? removeUserPathEntry
    });
    const schedule =
      options.scheduleInstallRootCleanup ?? scheduleInstallRootCleanup;
    let cleanupScheduled = false;
    try {
      cleanupScheduled = schedule(context) !== false;
    } catch {
      cleanupScheduled = false;
    }
    const report = { ...result, cleanupScheduled };
    if (json) writeJson(stdout, report);
    else {
      stdout.write("已从用户 PATH 移除 CCU，codex 将回退到官方英文版。\n");
      stdout.write(
        cleanupScheduled
          ? "CCU 文件将在当前命令退出后自动删除。\n"
          : `请稍后手动删除 ${installRoot}\n`
      );
      stdout.write("无需结束当前正在运行的 Codex。\n");
    }
    return 0;
  }

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
    const managerSource = options.managerSource ?? resolve(process.argv[1]);
    const launcherSource = options.launcherSource ?? join(
      dirname(managerSource),
      "launcher.mjs"
    );
    const prepareBin = options.prepareBin ?? (({ binDirectory }) =>
      installManagementBin({
        binDirectory,
        managerSource,
        launcherSource
      }));
    const contentRoot = resolve(
      options.contentRoot ??
        env.CODEX_CCU_CONTENT_ROOT ??
        join(dirname(managerSource), "..")
    );
    const statusLinePreset = resolveStatusLinePreset(args.slice(1));
    if (
      current.installedManifest !== null &&
      compareForkReleases(current.installedManifest, release.manifest) >= 0
    ) {
      await prepareBin({
        installRoot,
        binDirectory: join(installRoot, "bin")
      });
      const content = await (options.syncBundledContent ?? syncBundledContent)({
        contentRoot,
        installRoot,
        statusLinePreset,
        env
      });
      const cleanup = await cleanupInstalledReleases(context);
      const cleanupScheduled = scheduleCleanupIfNeeded(cleanup, context);
      const report = {
        changed: false,
        releaseId: current.fork.releaseId,
        displayVersion: current.fork.displayVersion,
        message: "installed fork is already current or newer",
        content,
        ...cleanup,
        cleanupScheduled
      };
      if (json) writeJson(stdout, report);
      else stdout.write(`${report.message}: ${report.displayVersion}\n`);
      return 0;
    }

    const result = await (options.installForkFromProvider ?? installForkFromProvider)({
      provider: release.provider,
      installRoot,
      env,
      discoverOfficialCodex: options.discoverOfficialCodex,
      addPathEntry: options.addPathEntry ?? addUserPathEntry,
      removePathEntry: options.removePathEntry ?? removeUserPathEntry,
      prepareBin,
      onStage:
        options.onStage ??
        (json ? undefined : createInstallStageReporter(stdout))
    });
    const content = await (options.syncBundledContent ?? syncBundledContent)({
      contentRoot,
      installRoot,
      statusLinePreset,
      env
    });
    const cleanup = {
      removedReleases: result.removedReleases ?? [],
      deferredReleases: result.deferredReleases ?? []
    };
    const cleanupScheduled = scheduleCleanupIfNeeded(cleanup, context);
    const report = {
      changed: result.changed,
      releaseId: result.releaseId,
      displayVersion: result.manifest.displayVersion,
      upstreamVersion: result.manifest.upstreamVersion,
      upstreamTag: result.manifest.upstreamTag,
      forkCommit: result.manifest.forkCommit,
      i18nApiVersion: result.manifest.i18nApiVersion,
      content,
      ...cleanup,
      cleanupScheduled
    };
    if (json) writeJson(stdout, report);
    else {
      stdout.write(
        `${result.changed ? "installed" : "verified"} fork ${report.displayVersion}\n`
      );
      stdout.write(`已启用 ${content.language.locale} 中文语言包\n`);
      stdout.write(
        content.theme.statusLinePresetEnabled
          ? `已启用 ${content.theme.displayName} 状态栏预设\n`
          : `已安装 ${content.theme.displayName} 主题，状态栏预设保持关闭\n`
      );
      if (cleanup.deferredReleases.length > 0) {
        stdout.write("旧 CCU 版本将在占用它的会话退出后自动清理。\n");
      }
      stdout.write("请打开新终端，然后运行 codex --yolo。\n");
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
