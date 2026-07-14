import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { launcherMain } from "../../src/launcher/main.mjs";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

test("invalid state recovers official Codex, emits one notice, and forwards args", async () => {
  const calls = [];
  let stderr = "";
  const official = { binaryPath: "C:\\npm\\codex.exe" };
  const selection = {
    kind: "official",
    path: official.binaryPath,
    env: {},
    reason: "state-unavailable",
    notice: "Codex Ultra: state is unavailable; run codex-ultra doctor."
  };
  const exitCode = await launcherMain({
    installRoot: "C:\\Ultra",
    args: ["--help", "中文"],
    env: { PATH: "C:\\Windows" },
    stderr: { write: (value) => { stderr += value; } },
    readState: async (path) => {
      calls.push(["read", path]);
      throw new Error("invalid state");
    },
    discoverOfficialCodex: async (options) => {
      calls.push(["discover", options.installRoot]);
      return official;
    },
    selectLaunchTarget: async (options) => {
      calls.push(["select", options.state, options.recoveredOfficial]);
      return selection;
    },
    writeNoticeOnce: async (options) => {
      calls.push(["notice", options.reason, options.detail]);
      return true;
    },
    runSelectedTarget: async (selected, args) => {
      calls.push(["run", selected.path, args]);
      return 23;
    }
  });

  assert.equal(exitCode, 23);
  assert.equal(stderr, `${selection.notice}\n`);
  assert.deepEqual(calls, [
    ["read", "C:\\Ultra\\state.json"],
    ["discover", "C:\\Ultra"],
    ["select", null, official],
    ["notice", "state-unavailable", selection.notice],
    ["run", official.binaryPath, ["--help", "中文"]]
  ]);
});

test("valid state never performs fallback discovery", async () => {
  const state = { schemaVersion: 1 };
  let discoveryCalls = 0;
  const exitCode = await launcherMain({
    installRoot: "C:\\Ultra",
    readState: async () => state,
    discoverOfficialCodex: async () => {
      discoveryCalls += 1;
      throw new Error("must not discover");
    },
    selectLaunchTarget: async (options) => {
      assert.equal(options.state, state);
      assert.equal(options.recoveredOfficial, null);
      return {
        kind: "official",
        path: "C:\\npm\\codex.exe",
        env: {},
        reason: "ultra-not-installed",
        notice: null
      };
    },
    runSelectedTarget: async () => 0
  });
  assert.equal(exitCode, 0);
  assert.equal(discoveryCalls, 0);
});

test("fatal selection reports once and does not create a deduped notice", async () => {
  let stderr = "";
  let noticeCalls = 0;
  const message =
    "Codex Ultra: no trusted Codex binary is available; run codex-ultra doctor.";
  const exitCode = await launcherMain({
    installRoot: "C:\\Ultra",
    stderr: { write: (value) => { stderr += value; } },
    readState: async () => {
      throw new Error("missing");
    },
    discoverOfficialCodex: async () => {
      throw new Error("missing");
    },
    selectLaunchTarget: async () => ({
      kind: "error",
      path: null,
      env: {},
      reason: "no-trusted-binary",
      notice: message
    }),
    writeNoticeOnce: async () => {
      noticeCalls += 1;
      return true;
    }
  });
  assert.equal(exitCode, 127);
  assert.equal(noticeCalls, 0);
  assert.equal(stderr, `${message}\n`);
});

test("launcher dependency graph contains no release, installer, or network implementation", async () => {
  const visited = new Set();
  const sources = [];

  async function visit(path) {
    const resolvedPath = extname(path) ? path : `${path}.mjs`;
    if (visited.has(resolvedPath)) return;
    visited.add(resolvedPath);
    const source = await readFile(resolvedPath, "utf8");
    sources.push(source);
    const importPattern = /(?:import|export)\s+(?:[^"']+?\s+from\s+)?["']([^"']+)["']/g;
    for (const match of source.matchAll(importPattern)) {
      if (!match[1].startsWith(".")) continue;
      await visit(resolve(dirname(resolvedPath), match[1]));
    }
  }

  await visit(resolve(PROJECT_ROOT, "src/launcher/main.mjs"));
  const normalizedPaths = [...visited].map((path) => path.replaceAll("\\", "/"));
  assert.equal(normalizedPaths.some((path) => path.includes("/release/")), false);
  assert.equal(normalizedPaths.some((path) => path.includes("/installer/")), false);
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /\bfetch\s*\(/);
  assert.doesNotMatch(combined, /node:https|https?:\/\//);
});
