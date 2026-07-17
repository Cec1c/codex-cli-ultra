import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runSelectedTarget } from "../../src/launcher/process.mjs";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const ECHO_CHILD = resolve(PROJECT_ROOT, "test/fixtures/echo-child.mjs");

test("selected target preserves arguments, streams, environment, and exit code", async () => {
  let stdout = "";
  let stderr = "";
  const childEnv = {
    ...process.env,
    CHILD_EXIT_CODE: "23",
    codex_ultra_locale: "untrusted"
  };
  delete childEnv.NODE_TEST_CONTEXT;
  const selection = {
    kind: "ultra",
    path: process.execPath,
    env: { CODEX_ULTRA_LOCALE: "zh-CN" },
    reason: "test",
    notice: null
  };

  const exitCode = await runSelectedTarget(
    selection,
    [ECHO_CHILD, "argument with spaces", "中文参数"],
    {
      stdio: "pipe",
      env: childEnv,
      onSpawn(child) {
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.stdin.end("标准输入");
      }
    }
  );

  assert.equal(exitCode, 23);
  assert.deepEqual(JSON.parse(stdout), {
    args: ["argument with spaces", "中文参数"],
    input: "标准输入",
    locale: "zh-CN"
  });
  assert.equal(stderr, "child-stderr\n");
});

test("an error selection returns 127 without spawning", async () => {
  let stderr = "";
  let spawnCalls = 0;
  const exitCode = await runSelectedTarget(
    {
      kind: "error",
      path: null,
      env: {},
      reason: "no-trusted-binary",
      notice: "repair with codex-ultra doctor"
    },
    [],
    {
      stderr: { write: (value) => { stderr += value; } },
      spawn: () => {
        spawnCalls += 1;
      }
    }
  );
  assert.equal(exitCode, 127);
  assert.equal(spawnCalls, 0);
  assert.equal(stderr, "repair with codex-ultra doctor\n");
});
