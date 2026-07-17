import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { installForkFromProvider } from "../../src/installer/install.mjs";
import { readState } from "../../src/state/store.mjs";

function hash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function forkManifest(assetBytes, revision = 1) {
  return {
    schemaVersion: 1,
    type: "codex-ccu-i18n-build",
    releaseTag: `ccu-rust-v0.144.5-r${revision}`,
    displayVersion: `0.144.5-ccu.i18n.${revision}`,
    upstreamVersion: "0.144.5",
    upstreamTag: "rust-v0.144.5",
    upstreamCommit: "a".repeat(40),
    forkCommit: revision.toString(16).padStart(40, "b").slice(-40),
    ultraRevision: revision,
    i18nApiVersion: 1,
    platform: "x86_64-pc-windows-msvc",
    asset: {
      name: `codex-r${revision}.zip`,
      size: assetBytes.length,
      sha256: hash(assetBytes)
    }
  };
}

const official = {
  version: "0.144.5",
  packageJsonPath: "C:\\npm\\node_modules\\@openai\\codex\\package.json",
  platformPackageVersion: "0.144.5-win32-x64",
  platformPackageJsonPath:
    "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\package.json",
  binaryPath:
    "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"
};

async function installRevision(installRoot, revision) {
  const assetBytes = Buffer.from(`archive-r${revision}`);
  const binaryBytes = Buffer.from(`binary-r${revision}`);
  const manifest = forkManifest(assetBytes, revision);
  const provider = {
    readManifest: async () => manifest,
    materializeAsset: async (_name, destination) => {
      await writeFile(destination, assetBytes);
    }
  };
  const result = await installForkFromProvider({
    provider,
    installRoot,
    discoverOfficialCodex: async () => official,
    extractZipSecure: async (_archive, destination) => {
      const bin = join(destination, "package", "bin");
      await mkdir(bin, { recursive: true });
      await writeFile(join(bin, "codex.exe"), binaryBytes);
    },
    smokeRunner: async (options) => {
      assert.equal(options.displayVersion, manifest.displayVersion);
      assert.deepEqual(options.phases, ["version"]);
    },
    prepareBin: async () => {},
    addPathEntry: async () => ({ changed: false })
  });
  return { result, manifest, binaryBytes };
}

test("fork install keeps only the active CCU release beside the official backup", async () => {
  const installRoot = await mkdtemp(join(tmpdir(), "ccu-fork-install-"));
  const first = await installRevision(installRoot, 1);
  assert.equal(first.result.releaseId, "0.144.5-ccu.i18n.1");
  assert.equal(first.result.state.lastKnownGood, null);
  assert.deepEqual(
    await readFile(first.result.state.active.binaryPath),
    first.binaryBytes
  );

  const second = await installRevision(installRoot, 2);
  assert.equal(second.result.releaseId, "0.144.5-ccu.i18n.2");
  assert.equal(second.result.state.lastKnownGood, null);
  assert.deepEqual(second.result.removedReleases, ["0.144.5-ccu.i18n.1"]);
  assert.deepEqual(
    await readdir(join(installRoot, "releases")),
    ["0.144.5-ccu.i18n.2"]
  );
  const stored = await readState(join(installRoot, "state.json"));
  assert.equal(stored.active.releaseId, "0.144.5-ccu.i18n.2");
  assert.equal(stored.lastKnownGood, null);
});
