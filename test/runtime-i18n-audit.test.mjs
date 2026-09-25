import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("runtime localization audit catches missing keys after source files move", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ccu-runtime-i18n-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "codex-rs/tui/src/new_surface");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "view.rs"), `
    crate::i18n::tr!("ccu-welcome-back", "Welcome back!");
    keymap_text_with_args("new-surface-not-translated", &[], || "New".into());
    #[cfg(test)] mod tests { fn example() { text("test-key-only", "test"); } }
  `);
  const run = () => spawnSync(process.execPath, [resolve("scripts/audit-runtime-i18n.mjs"), root], { encoding: "utf8" });
  const missing = run();
  assert.equal(missing.status, 1, missing.stderr);
  assert.deepEqual(JSON.parse(missing.stdout).missing, [{ id: "new-surface-not-translated", file: "new_surface/view.rs" }]);
  await writeFile(join(source, "view.rs"), `crate::i18n::tr!("ccu-welcome-back", "Welcome back!");`);
  await writeFile(join(source, "view_tests.rs"), `text("test-key-only", "test");`);
  const covered = run();
  assert.equal(covered.status, 0, covered.stderr);
  assert.deepEqual(JSON.parse(covered.stdout).missing, []);
});
