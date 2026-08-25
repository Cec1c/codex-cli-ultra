import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  scheduleCcuUpgradeApply,
  stageCcuUpgrade
} from "../src/update/upgrade.mjs";
import { resolveRuntimePlatform } from "../src/platform/runtime.mjs";

const SHA256 = `sha256:${"a".repeat(64)}`;
const LINUX = resolveRuntimePlatform({ platform: "linux", arch: "x64" });
const RUNTIME = resolveRuntimePlatform();

function updateManifest() {
  return {
    schemaVersion: 1,
    type: "codex-cli-ultra-update",
    ccuVersion: "0.1.6",
    releaseTag: "v0.1.6",
    platform: RUNTIME.id,
    minimumManagerVersion: "0.1.5",
    bundledFork: {
      releaseTag: "ccu-rust-v0.146.0-r1",
      displayVersion: "0.146.0-ccu.i18n.1",
      upstreamVersion: "0.146.0",
      i18nApiVersion: 1
    },
    asset: {
      name: `codex-cli-ultra-v0.1.6-${RUNTIME.id}.zip`,
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

test("an Alpha manager does not downgrade itself to an older stable release", async () => {
  const report = await stageCcuUpgrade({
    installRoot: "/tmp/ccu-alpha-version-check",
    currentVersion: "0.1.8-alpha.1",
    resolveCcuUpdatePackage: async () => resolvedPackage({
      async materializeAsset() {
        assert.fail("an older stable package must not be downloaded");
      }
    })
  });
  assert.equal(report.changed, false);
  assert.equal(report.message, "CCU is already current or newer");
});

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
  assert.equal(report.installScript.split(/[\\/]/).at(-1), RUNTIME.installerName);
  await rm(installRoot, { recursive: true, force: true });
});

test("CCU upgrade removes a corrupt completed partial before retry", async () => {
  const installRoot = await mkdtemp(join(tmpdir(), "ccu-upgrade-corrupt-"));
  const downloadPath = join(
    installRoot,
    "cache",
    "updates",
    `codex-cli-ultra-v0.1.6-${RUNTIME.id}.zip.part`
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

test("POSIX CCU upgrade handoff uses a private shell script and preserves installer flags", async () => {
  const writes = [];
  const spawns = [];
  const staged = {
    changed: true,
    manifest: { ccuVersion: "0.1.6" },
    installScript: "/tmp/ccu stage/package/install.sh",
    downloadPath: "/home/alice/.local/share/codex-cli-ultra/cache/update.zip.part",
    stagingRoot: "/home/alice/.local/share/codex-cli-ultra/cache/stage-1"
  };
  const report = await scheduleCcuUpgradeApply(staged, {
    runtime: LINUX,
    installRoot: "/home/alice/.local/share/codex-cli-ultra",
    managerPid: 42,
    env: { HOME: "/home/alice", PATH: "/usr/bin" },
    mkdir: async () => {},
    writeFile: async (...args) => writes.push(args),
    spawn: (...args) => {
      spawns.push(args);
      return { pid: 123, once() {}, unref() {} };
    }
  });

  assert.equal(report.scheduled, true);
  assert.equal(writes.length, 1);
  assert.match(writes[0][0], /cache[\\/]update-jobs[\\/].+\.sh$/);
  assert.match(writes[0][1], /bash "\$CCU_INSTALL_SCRIPT" --non-interactive --preserve-statusline/);
  assert.deepEqual(writes[0][2], { encoding: "utf8", mode: 0o700 });
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0][0], "sh");
  assert.deepEqual(spawns[0][1], [writes[0][0]]);
  assert.equal(spawns[0][2].detached, true);
  assert.equal(spawns[0][2].env.CCU_MANAGER_PID, "42");
  assert.equal(spawns[0][2].env.CCU_INSTALL_SCRIPT, staged.installScript);
  assert.equal(
    spawns[0][2].env.CCU_INSTALLED_MANAGER,
    "/home/alice/.local/share/codex-cli-ultra/bin/ccu-manager"
  );
});
