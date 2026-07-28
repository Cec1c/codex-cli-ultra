import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stageCcuUpgrade } from "../src/update/upgrade.mjs";

const SHA256 = `sha256:${"a".repeat(64)}`;

function updateManifest() {
  return {
    schemaVersion: 1,
    type: "codex-cli-ultra-update",
    ccuVersion: "0.1.6",
    releaseTag: "v0.1.6",
    platform: "windows-x64",
    minimumManagerVersion: "0.1.5",
    bundledFork: {
      releaseTag: "ccu-rust-v0.146.0-r1",
      displayVersion: "0.146.0-ccu.i18n.1",
      upstreamVersion: "0.146.0",
      i18nApiVersion: 1
    },
    asset: {
      name: "codex-cli-ultra-v0.1.6-windows-x64.zip",
      size: 4,
      sha256: SHA256
    }
  };
}

function resolvedPackage(provider) {
  return {
    latest: { tag: "v0.1.6", version: "0.1.6" },
    manifest: updateManifest(),
    provider,
    ownsNetworkClient: false
  };
}

test("CCU upgrade forwards real progress through verify and extract stages", async () => {
  const installRoot = await mkdtemp(join(tmpdir(), "ccu-upgrade-stage-"));
  const stages = [];
  const progress = [];
  const report = await stageCcuUpgrade({
    installRoot,
    currentVersion: "0.1.5",
    resolveCcuUpdatePackage: async () => resolvedPackage({
      async materializeAsset(_name, destination, options) {
        await writeFile(destination, "good");
        options.onProgress({
          transferredBytes: 4,
          totalBytes: 4,
          percent: 100,
          instantBytesPerSecond: 2,
          averageBytesPerSecond: 2,
          etaSeconds: 0
        });
      }
    }),
    sha256File: async () => ({ size: 4, sha256: SHA256 }),
    extractZipSecure: async () => {},
    findPackageRoot: async (stagingRoot) => join(stagingRoot, "package"),
    onStage: (event) => stages.push(event.stage),
    onProgress: (event) => progress.push(event)
  });

  assert.equal(report.changed, true);
  assert.deepEqual(stages, ["download", "verify", "extract", "ready"]);
  assert.deepEqual(progress.map((event) => event.percent), [100]);
  assert.match(report.installScript, /package[\\/]install\.ps1$/);
  await rm(installRoot, { recursive: true, force: true });
});

test("CCU upgrade removes a corrupt completed partial before retry", async () => {
  const installRoot = await mkdtemp(join(tmpdir(), "ccu-upgrade-corrupt-"));
  const downloadPath = join(
    installRoot,
    "cache",
    "updates",
    "codex-cli-ultra-v0.1.6-windows-x64.zip.part"
  );
  await assert.rejects(
    stageCcuUpgrade({
      installRoot,
      currentVersion: "0.1.5",
      resolveCcuUpdatePackage: async () => resolvedPackage({
        async materializeAsset(_name, destination) {
          await writeFile(destination, "evil");
        }
      }),
      sha256File: async () => ({
        size: 4,
        sha256: `sha256:${"b".repeat(64)}`
      })
    }),
    /failed size or SHA-256 verification/
  );
  await assert.rejects(access(downloadPath), { code: "ENOENT" });
  await rm(installRoot, { recursive: true, force: true });
});
