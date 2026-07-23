import assert from "node:assert/strict";
import test from "node:test";

import { manageMain } from "../src/manage-main.mjs";
import { nextPatchVersion } from "../src/release/ccu-version.mjs";
import { CCU_VERSION } from "../src/version.mjs";

function manifest(revision = 1) {
  return {
    schemaVersion: 1,
    type: "codex-ccu-i18n-build",
    releaseTag: `ccu-rust-v0.144.5-r${revision}`,
    displayVersion: `0.144.5-ccu.i18n.${revision}`,
    upstreamVersion: "0.144.5",
    upstreamTag: "rust-v0.144.5",
    upstreamCommit: "a".repeat(40),
    forkCommit: revision.toString().repeat(40).slice(0, 40),
    ultraRevision: revision,
    i18nApiVersion: 1,
    platform: "x86_64-pc-windows-msvc",
    asset: {
      name: `codex-r${revision}.zip`,
      size: 100,
      sha256: `sha256:${"c".repeat(64)}`
    }
  };
}

const installRoot = "C:\\Users\\me\\AppData\\Local\\codex-cli-ultra";
const state = {
  schemaVersion: 1,
  official: {
    version: "0.144.5",
    packageJsonPath: "C:\\npm\\node_modules\\@openai\\codex\\package.json",
    platformPackageVersion: "0.144.5-win32-x64",
    platformPackageJsonPath:
      "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\package.json",
    binaryPath:
      "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"
  },
  active: {
    releaseId: "0.144.5-ccu.i18n.1",
    upstreamVersion: "0.144.5",
    ultraRevision: 1,
    platform: "x86_64-pc-windows-msvc",
    binaryPath:
      `${installRoot}\\releases\\0.144.5-ccu.i18n.1\\x86_64-pc-windows-msvc\\package\\bin\\codex.exe`,
    size: 123,
    mtimeMs: 456,
    sha256: `sha256:${"d".repeat(64)}`
  },
  locale: null,
  lastKnownGood: null
};

test("management version reports both CCU and the installed fork build", async () => {
  let output = "";
  const code = await manageMain({
    args: ["version"],
    installRoot,
    readState: async () => state,
    readFile: async () => JSON.stringify(manifest(1)),
    stdout: { write(chunk) { output += chunk; } }
  });
  assert.equal(code, 0);
  assert.match(
    output,
    new RegExp(`codex-cli-ultra ${CCU_VERSION.replaceAll(".", "\\.")}`)
  );
  assert.match(output, /fork 0\.144\.5-ccu\.i18n\.1/);
  assert.match(output, /i18n API 1/);
});

test("status check reports a newer fork revision", async () => {
  let output = "";
  const latest = manifest(2);
  const latestCcuVersion = nextPatchVersion(CCU_VERSION);
  const code = await manageMain({
    args: ["status", "--check", "--json"],
    installRoot,
    readState: async () => state,
    readFile: async () => JSON.stringify(manifest(1)),
    resolveLatestForkRelease: async () => ({
      manifest: latest,
      provider: { materializeAsset: async () => {} }
    }),
    resolveLatestCcuRelease: async () => ({
      repository: "Cec1c/codex-cli-ultra",
      tag: `v${latestCcuVersion}`,
      version: latestCcuVersion,
      url: `https://github.com/Cec1c/codex-cli-ultra/releases/tag/v${latestCcuVersion}`
    }),
    resolveLatestUpstreamRelease: async () => ({
      repository: "openai/codex",
      tag: "rust-v0.144.6",
      version: "0.144.6",
      url: "https://github.com/openai/codex/releases/tag/rust-v0.144.6"
    }),
    stdout: { write(chunk) { output += chunk; } }
  });
  assert.equal(code, 0);
  const report = JSON.parse(output);
  assert.equal(report.updateAvailable, true);
  assert.equal(report.latest.displayVersion, latest.displayVersion);
  assert.equal(report.latestCcu.version, latestCcuVersion);
  assert.equal(report.ccuUpdateAvailable, true);
  assert.equal(report.latestUpstream.version, "0.144.6");
  assert.equal(report.upstreamUpdateAvailable, true);
  assert.deepEqual(report.onlineErrors, []);
});

test("status check preserves local state when remote sources partially fail", async () => {
  let output = "";
  const code = await manageMain({
    args: ["status", "--check", "--json"],
    installRoot,
    readState: async () => state,
    readFile: async () => JSON.stringify(manifest(1)),
    resolveLatestForkRelease: async () => {
      throw new Error("fetch failed");
    },
    resolveLatestCcuRelease: async () => ({
      repository: "Cec1c/codex-cli-ultra",
      tag: "v0.1.2",
      version: "0.1.2",
      url: "https://github.com/Cec1c/codex-cli-ultra/releases/tag/v0.1.2"
    }),
    resolveLatestUpstreamRelease: async () => {
      throw new Error("request timeout");
    },
    stdout: { write(chunk) { output += chunk; } }
  });

  assert.equal(code, 0);
  const report = JSON.parse(output);
  assert.equal(report.fork.displayVersion, "0.144.5-ccu.i18n.1");
  assert.equal(report.latest, null);
  assert.equal(report.latestCcu.version, "0.1.2");
  assert.deepEqual(report.onlineErrors, [
    { channel: "ccu-i18n", message: "fetch failed" },
    { channel: "codex-upstream", message: "request timeout" }
  ]);
});

test("update passes the latest validated fork release to the installer", async () => {
  let output = "";
  let installerOptions;
  let contentOptions;
  let cleanupScheduled = false;
  const latest = manifest(2);
  const code = await manageMain({
    args: ["update", "--json"],
    installRoot,
    managerSource: "C:\\bundle\\codex-ultra.mjs",
    launcherSource: "C:\\bundle\\launcher.mjs",
    readState: async () => state,
    readFile: async () => JSON.stringify(manifest(1)),
    resolveLatestForkRelease: async () => ({
      manifest: latest,
      provider: { materializeAsset: async () => {} }
    }),
    installForkFromProvider: async (options) => {
      installerOptions = options;
      return {
        changed: true,
        releaseId: latest.displayVersion,
        manifest: latest,
        removedReleases: [],
        deferredReleases: ["0.144.5-ccu.i18n.1"]
      };
    },
    scheduleDeferredCleanup: () => {
      cleanupScheduled = true;
      return 1234;
    },
    syncBundledContent: async (options) => {
      contentOptions = options;
      return {
        language: { locale: "zh-CN", messages: 134 },
        theme: { id: "ccu.hermes", displayName: "Hermes 风格" },
        codexHome: "C:\\Users\\me\\.codex"
      };
    },
    stdout: { write(chunk) { output += chunk; } }
  });
  assert.equal(code, 0);
  assert.equal(typeof installerOptions.provider.readManifest, "function");
  assert.deepEqual(await installerOptions.provider.readManifest(), latest);
  assert.equal(contentOptions.installRoot, installRoot);
  assert.equal(JSON.parse(output).displayVersion, latest.displayVersion);
  assert.equal(JSON.parse(output).content.language.locale, "zh-CN");
  assert.deepEqual(JSON.parse(output).deferredReleases, [
    "0.144.5-ccu.i18n.1"
  ]);
  assert.equal(JSON.parse(output).cleanupScheduled, true);
  assert.equal(cleanupScheduled, true);
});

test("current install schedules cleanup for a release locked by the active session", async () => {
  let output = "";
  let cleanupScheduled = false;
  let binRefreshed = false;
  let contentRefreshed = false;
  const current = manifest(1);
  const code = await manageMain({
    args: ["update", "--json"],
    installRoot,
    readState: async () => state,
    readFile: async () => JSON.stringify(current),
    resolveLatestForkRelease: async () => ({
      manifest: current,
      provider: { materializeAsset: async () => {} }
    }),
    prepareBin: async ({ binDirectory }) => {
      binRefreshed = binDirectory.endsWith("\\bin");
    },
    syncBundledContent: async () => {
      contentRefreshed = true;
      return {
        language: { locale: "zh-CN", messages: 134 },
        theme: { id: "ccu.hermes", displayName: "Hermes 风格" },
        codexHome: "C:\\Users\\me\\.codex"
      };
    },
    pruneInactiveReleases: async () => ({
      removedReleases: [],
      deferredReleases: ["0.144.5-ccu.i18n.0"]
    }),
    scheduleDeferredCleanup: () => {
      cleanupScheduled = true;
      return 5678;
    },
    stdout: { write(chunk) { output += chunk; } }
  });

  assert.equal(code, 0);
  const report = JSON.parse(output);
  assert.equal(report.changed, false);
  assert.deepEqual(report.deferredReleases, ["0.144.5-ccu.i18n.0"]);
  assert.equal(report.cleanupScheduled, true);
  assert.equal(cleanupScheduled, true);
  assert.equal(report.content.theme.id, "ccu.hermes");
  assert.equal(binRefreshed, true);
  assert.equal(contentRefreshed, true);
});

test("hidden cleanup command waits for inactive releases without user output", async () => {
  let called = false;
  const code = await manageMain({
    args: ["__cleanup-releases"],
    installRoot,
    waitForInactiveReleaseCleanup: async (options) => {
      called = options.installRoot === installRoot;
      return { removedReleases: ["old"], deferredReleases: [] };
    }
  });

  assert.equal(code, 0);
  assert.equal(called, true);
});

test("install forwards the optional CCU status-line selection", async () => {
  let contentOptions;
  let installerOptions;
  const latest = manifest(2);
  const code = await manageMain({
    args: ["install", "--enable-statusline", "--json"],
    installRoot,
    managerSource: "C:\\bundle\\codex-ultra.mjs",
    launcherSource: "C:\\bundle\\launcher.mjs",
    readState: async () => ({ ...state, active: null }),
    readFile: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    resolveLatestForkRelease: async () => ({
      manifest: latest,
      provider: { materializeAsset: async () => {} }
    }),
    installForkFromProvider: async (options) => {
      installerOptions = options;
      return {
        changed: true,
        releaseId: latest.displayVersion,
        manifest: latest,
        removedReleases: [],
        deferredReleases: []
      };
    },
    syncBundledContent: async (options) => {
      contentOptions = options;
      return {
        language: { locale: "zh-CN", messages: 1396 },
        theme: {
          id: "ccu.hermes",
          displayName: "Hermes 风格",
          statusLinePresetEnabled: true
        },
        codexHome: "C:\\Users\\me\\.codex"
      };
    },
    stdout: { write() {} }
  });

  assert.equal(code, 0);
  assert.equal(contentOptions.statusLinePreset, "ccu.hermes");
  assert.equal(typeof installerOptions.onStage, "undefined");
});

test("uninstall removes CCU and schedules install-root cleanup", async () => {
  let uninstallOptions;
  let cleanupProcess;
  let output = "";
  const code = await manageMain({
    args: ["uninstall", "--json"],
    installRoot,
    uninstallCcu: async (options) => {
      uninstallOptions = options;
      return {
        changed: true,
        installRoot,
        official: state.official,
        pathRemoved: true,
        stateChanged: true,
        removedPreferences: ["ui-language", "ui-theme"]
      };
    },
    renameInstallRoot: () => {
      const error = new Error("release is still locked");
      error.code = "EBUSY";
      throw error;
    },
    spawnDetached: (executable, args, options) => {
      cleanupProcess = { executable, args, options };
      return {
        pid: 1234,
        once() {},
        unref() {}
      };
    },
    stdout: { write(chunk) { output += chunk; } }
  });

  assert.equal(code, 0);
  assert.equal(uninstallOptions.installRoot, installRoot);
  assert.equal(cleanupProcess.executable, "pwsh.exe");
  assert.deepEqual(cleanupProcess.args.slice(0, 5), [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden"
  ]);
  assert.equal(cleanupProcess.options.detached, true);
  assert.equal(cleanupProcess.options.windowsHide, true);
  assert.equal(cleanupProcess.options.stdio, "ignore");
  assert.equal(cleanupProcess.options.env.CCU_INSTALL_ROOT, installRoot);
  assert.match(
    cleanupProcess.options.env.CCU_TOMBSTONE_ROOT,
    /\.codex-cli-ultra-uninstall-[0-9a-f-]+$/
  );
  assert.match(cleanupProcess.args.at(-1), /\[System\.IO\.Directory\]::Move/);
  assert.doesNotMatch(
    cleanupProcess.args.at(-1),
    /Remove-Item -LiteralPath \$root -Recurse/
  );
  assert.equal(JSON.parse(output).cleanupScheduled, true);
});

test("uninstall removes an unlocked install root without a background process", async () => {
  let renamed;
  let removed;
  let spawned = false;
  let output = "";
  const code = await manageMain({
    args: ["uninstall", "--json"],
    installRoot,
    uninstallCcu: async () => ({
      changed: true,
      installRoot,
      official: state.official,
      pathRemoved: true,
      stateChanged: true,
      removedPreferences: ["ui-language", "ui-theme"]
    }),
    renameInstallRoot: (source, destination) => {
      renamed = { source, destination };
    },
    removeTombstone: (path) => {
      removed = path;
    },
    spawnDetached: () => {
      spawned = true;
      throw new Error("background cleanup should not run");
    },
    stdout: { write(chunk) { output += chunk; } }
  });

  assert.equal(code, 0);
  assert.equal(renamed.source, installRoot);
  assert.equal(removed, renamed.destination);
  assert.match(removed, /\.codex-cli-ultra-uninstall-[0-9a-f-]+$/);
  assert.equal(spawned, false);
  assert.equal(JSON.parse(output).cleanupScheduled, true);
});

test("uninstall reports cleanup as unscheduled when the helper has no pid", async () => {
  let output = "";
  const code = await manageMain({
    args: ["uninstall", "--json"],
    installRoot,
    uninstallCcu: async () => ({
      changed: true,
      installRoot,
      official: state.official,
      pathRemoved: true,
      stateChanged: true,
      removedPreferences: []
    }),
    renameInstallRoot: () => {
      throw Object.assign(new Error("locked"), { code: "EBUSY" });
    },
    spawnDetached: () => ({
      pid: undefined,
      once() {},
      unref() {}
    }),
    stdout: { write(chunk) { output += chunk; } }
  });

  assert.equal(code, 0);
  assert.equal(JSON.parse(output).cleanupScheduled, false);
});
