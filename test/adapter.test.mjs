import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";

import {
  applyCodexPatch,
  doctorCodexPatch,
  planCodexPatch,
  revertCodexPatch
} from "../src/adapter/codex-0.144.1.mjs";

const LIB_SOURCE = [
  "mod history_cell;",
  "mod ide_context;",
  "mod keymap;",
  ""
].join("\n");

const STATUS_SOURCE = [
  "impl StatusLineSetupView {",
  "    pub(crate) fn new(",
  "        status_line_items: Option<&[String]>,",
  "        use_theme_colors: bool,",
  "        preview_data: StatusSurfacePreviewData,",
  "        app_event_tx: AppEventSender,",
  "        list_keymap: ListKeymap,",
  "    ) -> Self {",
  "        let mut used_ids = HashSet::new();",
  "        let mut items = vec![MultiSelectItem {",
  "            id: STATUS_LINE_USE_THEME_COLORS_ITEM_ID.to_string(),",
  '            name: "Use theme colors".to_string(),',
  '            description: Some("Apply colors from the active /theme".to_string()),',
  "            enabled: use_theme_colors,",
  "        }];",
  "",
  "        Self {",
  "            picker: MultiSelectPicker::builder(",
  '                "Configure Status Line".to_string(),',
  '                Some("Select which items to display in the status line.".to_string()),',
  "                app_event_tx,",
  "            )",
  "            .build(),",
  "        }",
  "    }",
  "}",
  "",
  "#[cfg(test)]",
  "mod tests {",
  "    fn render_lines(view: &StatusLineSetupView, width: u16) -> String {",
  "        String::new()",
  "    }",
  "}",
  ""
].join("\n");

async function createFixture() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "codex-ultra-adapter-"));
  const overlayDir = join(sourceRoot, "overlay");
  const libPath = join(sourceRoot, "codex-rs", "tui", "src", "lib.rs");
  const statusPath = join(
    sourceRoot,
    "codex-rs",
    "tui",
    "src",
    "bottom_pane",
    "status_line_setup.rs"
  );
  await mkdir(dirname(statusPath), { recursive: true });
  await mkdir(overlayDir, { recursive: true });
  await writeFile(libPath, LIB_SOURCE, "utf8");
  await writeFile(statusPath, STATUS_SOURCE, "utf8");
  await writeFile(join(overlayDir, "i18n.rs"), "pub(crate) fn marker() {}\n", "utf8");
  await writeFile(
    join(overlayDir, "i18n_tests.rs"),
    "#[test]\nfn marker_test() {}\n",
    "utf8"
  );
  return { sourceRoot, overlayDir, statusPath };
}

async function snapshotTree(root) {
  const snapshot = {};
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        snapshot[relative(root, path).replaceAll("\\", "/")] =
          await readFile(path, "utf8");
      }
    }
  }
  await visit(root);
  return snapshot;
}

test("planCodexPatch changes no files during preflight", async () => {
  const fixture = await createFixture();
  const before = await snapshotTree(fixture.sourceRoot);

  const plan = await planCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });

  assert.equal(plan.files.length, 4);
  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
});

test("applyCodexPatch installs overlays and localized call sites", async () => {
  const fixture = await createFixture();

  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });

  const status = await readFile(fixture.statusPath, "utf8");
  assert.match(status, /crate::i18n::global\(\)/);
  assert.match(status, /translator\.text\(/);
  assert.equal(
    await readFile(
      join(fixture.sourceRoot, "codex-rs", "tui", "src", "i18n.rs"),
      "utf8"
    ),
    "pub(crate) fn marker() {}\n"
  );
});

test("drift in one anchor leaves every file untouched", async () => {
  const fixture = await createFixture();
  await writeFile(
    fixture.statusPath,
    STATUS_SOURCE.replace("Configure Status Line", "Configure Status Bar"),
    "utf8"
  );
  const before = await snapshotTree(fixture.sourceRoot);

  await assert.rejects(
    applyCodexPatch(fixture.sourceRoot, {
      verifyGit: false,
      overlayDir: fixture.overlayDir
    }),
    /anchor drift/
  );

  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
});

test("revertCodexPatch restores exact original bytes", async () => {
  const fixture = await createFixture();
  const before = await snapshotTree(fixture.sourceRoot);

  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  await revertCodexPatch(fixture.sourceRoot);

  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
});

test("doctorCodexPatch reports whether the adapter state is applied", async () => {
  const fixture = await createFixture();

  assert.deepEqual(
    await doctorCodexPatch(fixture.sourceRoot, { verifyGit: false }),
    {
      targetCommit: "44918ea10c0f99151c6710411b4322c2f5c96bea",
      sourceCommit: null,
      supported: null,
      applied: false
    }
  );

  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });

  assert.equal(
    (await doctorCodexPatch(fixture.sourceRoot, { verifyGit: false })).applied,
    true
  );
});
