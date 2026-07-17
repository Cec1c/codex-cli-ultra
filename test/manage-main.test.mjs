import assert from "node:assert/strict";
import test from "node:test";

import { manageMain } from "../src/manage-main.mjs";

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
  assert.match(output, /codex-cli-ultra 0\.1\.0/);
  assert.match(output, /fork 0\.144\.5-ccu\.i18n\.1/);
  assert.match(output, /i18n API 1/);
});

test("status check reports a newer fork revision", async () => {
  let output = "";
  const latest = manifest(2);
  const code = await manageMain({
    args: ["status", "--check", "--json"],
    installRoot,
    readState: async () => state,
    readFile: async () => JSON.stringify(manifest(1)),
    resolveLatestForkRelease: async () => ({
      manifest: latest,
      provider: { materializeAsset: async () => {} }
    }),
    stdout: { write(chunk) { output += chunk; } }
  });
  assert.equal(code, 0);
  const report = JSON.parse(output);
  assert.equal(report.updateAvailable, true);
  assert.equal(report.latest.displayVersion, latest.displayVersion);
});

test("update passes the latest validated fork release to the installer", async () => {
  let output = "";
  let installerOptions;
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
        manifest: latest
      };
    },
    stdout: { write(chunk) { output += chunk; } }
  });
  assert.equal(code, 0);
  assert.equal(typeof installerOptions.provider.readManifest, "function");
  assert.deepEqual(await installerOptions.provider.readManifest(), latest);
  assert.equal(JSON.parse(output).displayVersion, latest.displayVersion);
});
