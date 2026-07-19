import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  STATUS_LINE_CONFIG_BACKUP,
  disableHermesStatusLineConfig,
  enableHermesStatusLineConfig
} from "../src/content/statusline-config.mjs";

test("Hermes status line replaces explicit empty config and restores it idempotently", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "ccu-statusline-config-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const configPath = join(codexHome, "config.toml");
  const original = [
    "model = \"gpt-5.6-sol\"",
    "",
    "[tui]",
    "status_line = []",
    "status_line_use_colors = false",
    "theme = \"catppuccin-macchiato\"",
    ""
  ].join("\n");
  await writeFile(configPath, original, "utf8");

  const first = await enableHermesStatusLineConfig({ codexHome });
  const managed = await readFile(configPath, "utf8");
  const backup = await readFile(join(codexHome, STATUS_LINE_CONFIG_BACKUP), "utf8");
  assert.equal(first.changed, true);
  assert.match(managed, /status_line = \[\n  "model-with-reasoning",/);
  assert.match(managed, /"session-timing",\n\]/);
  assert.match(managed, /status_line_use_colors = true/);
  assert.match(managed, /theme = "catppuccin-macchiato"/);

  const second = await enableHermesStatusLineConfig({ codexHome });
  assert.equal(second.changed, false);
  assert.equal(await readFile(join(codexHome, STATUS_LINE_CONFIG_BACKUP), "utf8"), backup);

  const disabled = await disableHermesStatusLineConfig({ codexHome });
  assert.equal(disabled.changed, true);
  assert.equal(await readFile(configPath, "utf8"), original);
  await assert.rejects(
    readFile(join(codexHome, STATUS_LINE_CONFIG_BACKUP), "utf8"),
    (error) => error?.code === "ENOENT"
  );
});

test("disable preserves user changes made after CCU enabled the status line", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "ccu-statusline-user-change-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const configPath = join(codexHome, "config.toml");
  await writeFile(
    configPath,
    "[tui]\nstatus_line_use_colors = false\nstatus_line = []\n",
    "utf8"
  );
  await enableHermesStatusLineConfig({ codexHome });
  await writeFile(
    configPath,
    "[tui]\nstatus_line_use_colors = true\nstatus_line = [\"current-dir\"]\n",
    "utf8"
  );

  const result = await disableHermesStatusLineConfig({ codexHome });
  const restored = await readFile(configPath, "utf8");
  assert.deepEqual(result.preservedUserChanges, ["status_line"]);
  assert.match(restored, /status_line_use_colors = false/);
  assert.match(restored, /status_line = \["current-dir"\]/);
});

test("disable removes a tui table that CCU created when it remains otherwise empty", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "ccu-statusline-new-table-"));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const configPath = join(codexHome, "config.toml");
  const original = "model = \"gpt-5.6-sol\"\n";
  await writeFile(configPath, original, "utf8");

  await enableHermesStatusLineConfig({ codexHome });
  await disableHermesStatusLineConfig({ codexHome });
  assert.equal(await readFile(configPath, "utf8"), original);
});
