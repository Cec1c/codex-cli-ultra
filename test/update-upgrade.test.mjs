import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { EventEmitter } from "node:events";

import {
  scheduleCcuUpgradeApply,
  stageCcuUpgrade
} from "../src/update/upgrade.mjs";
import { resolveRuntimePlatform } from "../src/platform/runtime.mjs";

const SHA256 = `sha256:${"a".repeat(64)}`;
const LINUX = resolveRuntimePlatform({ platform: "linux", arch: "x64" });
const RUNTIME = resolveRuntimePlatform();

function spawnedChild(pid = 123) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = () => {};
  queueMicrotask(() => child.emit("spawn"));
  return child;
}

async function waitForTerminalJobResult(path, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const result = JSON.parse(await readFile(path, "utf8"));
      if (["succeeded", "failed"].includes(result.status)) return result;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (Date.now() >= deadline) throw new Error(`update job timed out: ${path}`);
    await delay(100);
  }
}

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
      return spawnedChild();
    }
  });

  assert.equal(report.scheduled, true);
  assert.equal(writes.length, 2);
  assert.match(writes[0][0], /cache[\\/]update-jobs[\\/].+\.sh$/);
  assert.match(writes[0][1], /bash "\$CCU_INSTALL_SCRIPT" --non-interactive --preserve-statusline/);
  assert.deepEqual(writes[0][2], { encoding: "utf8", mode: 0o700 });
  assert.match(writes[1][0], /cache[\\/]update-jobs[\\/].+\.json$/);
  assert.equal(JSON.parse(writes[1][1]).status, "scheduled");
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0][0], "sh");
  assert.deepEqual(spawns[0][1], [writes[0][0]]);
  assert.equal(spawns[0][2].detached, true);
  assert.equal(spawns[0][2].env.CCU_MANAGER_PID, "42");
  assert.equal(spawns[0][2].env.CCU_REOPEN_MANAGER, "1");
  assert.equal(spawns[0][2].env.CCU_INSTALL_SCRIPT, staged.installScript);
  assert.equal(
    spawns[0][2].env.CCU_INSTALLED_MANAGER,
    "/home/alice/.local/share/codex-cli-ultra/bin/ccu-manager"
  );
});

test("quick update handoff does not reopen the full Manager TUI", async () => {
  const writes = [];
  const spawns = [];
  await scheduleCcuUpgradeApply({
    changed: true,
    manifest: { ccuVersion: "0.1.6" },
    installScript: "/tmp/ccu/package/install.sh",
    downloadPath: "/tmp/ccu/update.zip.part",
    stagingRoot: "/tmp/ccu/stage-1"
  }, {
    runtime: LINUX,
    installRoot: "/home/alice/.local/share/codex-cli-ultra",
    reopenManager: false,
    mkdir: async () => {},
    writeFile: async (...args) => writes.push(args),
    spawn: (...args) => {
      spawns.push(args);
      return spawnedChild();
    }
  });

  assert.match(writes[0][1], /CCU_REOPEN_MANAGER:-0/);
  assert.equal(spawns[0][2].env.CCU_REOPEN_MANAGER, "0");
});

test("a helper spawn failure is recorded instead of silently losing the update", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccu-update-spawn-failure-"));
  await assert.rejects(
    scheduleCcuUpgradeApply({
      changed: true,
      manifest: { ccuVersion: "0.2.0" },
      installScript: join(root, "install.ps1"),
      downloadPath: join(root, "update.zip.part"),
      stagingRoot: join(root, "stage")
    }, {
      installRoot: root,
      spawn: () => {
        const child = new EventEmitter();
        child.unref = () => {};
        queueMicrotask(() => {
          const error = new Error("pwsh is unavailable");
          error.code = "ENOENT";
          child.emit("error", error);
        });
        return child;
      }
    }),
    /pwsh is unavailable/
  );
  const results = await readdir(join(root, "cache", "update-jobs"));
  const resultName = results.find((name) => name.endsWith(".json"));
  const result = JSON.parse(
    await readFile(join(root, "cache", "update-jobs", resultName), "utf8")
  );
  assert.equal(result.status, "failed");
  assert.match(result.message, /failed to start update helper/);
  await rm(root, { recursive: true, force: true });
});

test("the real platform helper applies a staged update and records completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccu-real-update-helper-"));
  const stagingRoot = join(root, "stage");
  const installScript = join(stagingRoot, RUNTIME.installerName);
  const downloadPath = join(root, "update.zip.part");
  await mkdir(stagingRoot, { recursive: true });
  await writeFile(downloadPath, "cached", "utf8");
  if (RUNTIME.isWindows) {
    await writeFile(
      installScript,
      [
        "param([switch]$NonInteractive, [switch]$PreserveStatusLine)",
        "Set-Content -LiteralPath (Join-Path $env:CCU_INSTALL_ROOT 'applied.txt') -Value 'ok'",
        "& $env:ComSpec /d /c exit 0"
      ].join("\n"),
      "utf8"
    );
  } else {
    await writeFile(
      installScript,
      "#!/usr/bin/env bash\nset -eu\nprintf 'ok\\n' > \"$CCU_INSTALL_ROOT/applied.txt\"\n",
      { encoding: "utf8", mode: 0o700 }
    );
  }

  const handoff = await scheduleCcuUpgradeApply({
    changed: true,
    manifest: { ccuVersion: "0.2.0" },
    installScript,
    downloadPath,
    stagingRoot
  }, {
    installRoot: root,
    managerPid: 0,
    reopenManager: false
  });
  const result = await waitForTerminalJobResult(handoff.resultPath);
  assert.deepEqual(result, {
    schemaVersion: 1,
    status: "succeeded",
    targetVersion: "0.2.0",
    message: "CCU upgrade completed"
  });
  assert.equal((await readFile(join(root, "applied.txt"), "utf8")).trim(), "ok");
  await delay(100);
  await rm(root, { recursive: true, force: true });
});
