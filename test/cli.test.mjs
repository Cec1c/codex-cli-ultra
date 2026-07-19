import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runCli } from "../src/cli.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("catalog extract requires a source path", async () => {
  await assert.rejects(
    runCli(["catalog", "extract"]),
    /catalog extract requires --source PATH/
  );
});

test("unknown commands return concise usage", async () => {
  await assert.rejects(runCli(["unknown"]), /Usage:/);
});

test("language validate requires catalog and pack paths", async () => {
  await assert.rejects(
    runCli(["language", "validate", "--catalog", "catalog.jsonl"]),
    /language validate requires --pack PATH --catalog PATH/
  );
});

test("language validate reports the expanded wired catalog", async () => {
  let output = "";

  const result = await runCli(
    [
      "language",
      "validate",
      "--pack",
      "packages/languages/zh-CN",
      "--catalog",
      "research/codex-0.144.5/tui-messages.jsonl",
      "--template",
      "templates/languages/messages.en-US.ftl"
    ],
    {
      cwd: PROJECT_ROOT,
      stdout: { write(chunk) { output += chunk; } }
    }
  );

  assert.equal(result.command, "language validate");
  assert.equal(result.locale, "zh-CN");
  assert.equal(result.messages, 1334);
  assert.match(result.sourceHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(output), result);
});

test("adapter commands require a source path", async () => {
  await assert.rejects(
    runCli(["adapter", "apply"]),
    /adapter apply requires --source PATH/
  );
  await assert.rejects(
    runCli(["adapter", "revert"]),
    /adapter revert requires --source PATH/
  );
});

test("doctor requires source, language pack, and catalog paths", async () => {
  await assert.rejects(
    runCli(["doctor", "--source", "codex", "--pack", "pack"]),
    /doctor requires --source PATH --pack PATH --catalog PATH/
  );
});
