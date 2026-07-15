import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";

import {
  applyCodexPatch,
  doctorCodexPatch,
  LOCK_WORKSPACE_PACKAGE_NAMES,
  planCodexPatch,
  revertCodexPatch,
  TARGET_COMMIT
} from "../src/adapter/codex-0.144.1.mjs";

const LIB_SOURCE = [
  "mod history_cell;",
  "mod hooks_rpc;",
  "mod ide_context;",
  "mod keymap;",
  "pub use markdown_render::render_markdown_text;",
  ""
].join("\n");

const WORKSPACE_CARGO_SOURCE = [
  "[workspace.dependencies]",
  'flate2 = "1.1.8"',
  'futures = { version = "0.3", default-features = false }',
  'uds_windows = "1.1.0"',
  'unicode-segmentation = "1.12.0"',
  ""
].join("\n");

const TUI_CARGO_SOURCE = [
  "[dependencies]",
  "dunce = { workspace = true }",
  'image = { workspace = true, features = ["jpeg", "png", "gif", "webp"] }',
  'two-face = { version = "0.5", default-features = false, features = ["syntect-default-onig"] }',
  "unicode-segmentation = { workspace = true }",
  ""
].join("\n");

const CLI_MAIN_SOURCE = [
  "fn main() -> anyhow::Result<()> {",
  "    let remote_control_disabled = codex_app_server::take_remote_control_disabled_env();",
  "}",
  ""
].join("\n");

const CARGO_LOCK_SOURCE = LOCK_WORKSPACE_PACKAGE_NAMES.map((packageName) => {
  const lines = [
    "[[package]]",
    `name = "${packageName}"`,
    'version = "0.0.0"'
  ];
  if (packageName === "codex-tui") {
    lines.push(
      "dependencies = [",
      ' "dunce",',
      ' "image",',
      ' "two-face",',
      ' "unicode-segmentation",',
      "]"
    );
  }
  return lines.join("\n") + "\n";
}).join("\n");

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
  "            orderable: false,",
  "            section_break_after: true,",
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
  "    #[test]",
  "    fn setup_view_snapshot_uses_runtime_preview_values() {",
  "        let (tx_raw, _rx) = unbounded_channel::<AppEvent>();",
  "        let view = StatusLineSetupView::new(",
  "            Some(&[",
  "                StatusLineItem::ModelName.to_string(),",
  "                StatusLineItem::CurrentDir.to_string(),",
  "                StatusLineItem::GitBranch.to_string(),",
  "            ]),",
  "            /*use_theme_colors*/ true,",
  "            StatusSurfacePreviewData::from_iter([",
  "                (",
  "                    StatusLineItem::ModelName.preview_item(),",
  '                    "gpt-5-codex".to_string(),',
  "                ),",
  "                (",
  "                    StatusLineItem::CurrentDir.preview_item(),",
  '                    "~/codex-rs".to_string(),',
  "                ),",
  "                (",
  "                    StatusLineItem::GitBranch.preview_item(),",
  '                    "jif/statusline-preview".to_string(),',
  "                ),",
  "                (",
  "                    StatusLineItem::WeeklyLimit.preview_item(),",
  '                    "weekly 82% left".to_string(),',
  "                ),",
  "            ]),",
  "            AppEventSender::new(tx_raw),",
  "            crate::keymap::RuntimeKeymap::defaults().list,",
  "        );",
  "",
  "        assert_snapshot!(render_lines(&view, /*width*/ 72));",
  "    }",
  "",
  "    fn render_lines(view: &StatusLineSetupView, width: u16) -> String {",
  "        String::new()",
  "    }",
  "}",
  ""
].join("\n");

const HISTORY_SEPARATOR_SOURCE = `//! Turn separators and runtime-metrics labels for transcript history.

use super::*;

#[derive(Debug)]
/// A visual divider between turns, optionally showing how long the assistant "worked for".
///
/// This separator is only emitted for turns that performed concrete work (e.g., running commands,
/// applying patches, making MCP tool calls), so purely conversational turns do not show an empty
/// divider.
pub struct FinalMessageSeparator {
    elapsed_seconds: Option<u64>,
    runtime_metrics: Option<RuntimeMetricsSummary>,
}
impl FinalMessageSeparator {
    /// Creates a separator; completed turns should pass protocol turn duration when available.
    pub(crate) fn new(
        elapsed_seconds: Option<u64>,
        runtime_metrics: Option<RuntimeMetricsSummary>,
    ) -> Self {
        Self {
            elapsed_seconds,
            runtime_metrics,
        }
    }
}
impl HistoryCell for FinalMessageSeparator {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        let mut label_parts = Vec::new();
        if let Some(elapsed_seconds) = self
            .elapsed_seconds
            .filter(|seconds| *seconds > 60)
            .map(crate::status_indicator_widget::fmt_elapsed_compact)
        {
            label_parts.push(format!("Worked for {elapsed_seconds}"));
        }
        if let Some(metrics_label) = self.runtime_metrics.and_then(runtime_metrics_label) {
            label_parts.push(metrics_label);
        }

        if label_parts.is_empty() {
            return vec![Line::from_iter(["─".repeat(width as usize).dim()])];
        }

        let label = format!("─ {} ─", label_parts.join(" • "));
        let (label, _suffix, label_width) = take_prefix_by_width(&label, width as usize);
        vec![
            Line::from_iter([
                label,
                "─".repeat((width as usize).saturating_sub(label_width)),
            ])
            .dim(),
        ]
    }

    fn raw_lines(&self) -> Vec<Line<'static>> {
        let mut label_parts = Vec::new();
        if let Some(elapsed_seconds) = self
            .elapsed_seconds
            .filter(|seconds| *seconds > 60)
            .map(crate::status_indicator_widget::fmt_elapsed_compact)
        {
            label_parts.push(format!("Worked for {elapsed_seconds}"));
        }
        if let Some(metrics_label) = self.runtime_metrics.and_then(runtime_metrics_label) {
            label_parts.push(metrics_label);
        }
        if label_parts.is_empty() {
            Vec::new()
        } else {
            vec![Line::from(label_parts.join(" • "))]
        }
    }
}

pub(crate) fn runtime_metrics_label(_summary: RuntimeMetricsSummary) -> Option<String> {
    None
}
`;

const HISTORY_TESTS_SOURCE = [
  "#[test]",
  "fn final_message_separator_includes_worked_label_after_one_minute() {",
  "    let cell = FinalMessageSeparator::new(Some(61), /*runtime_metrics*/ None);",
  "    let rendered = render_lines(&cell.display_lines(/*width*/ 200));",
  "",
  "    assert_eq!(rendered.len(), 1);",
  '    assert!(rendered[0].contains("Worked for"));',
  "}",
  "",
  "#[test]",
  "fn ps_output_empty_snapshot() {}",
  ""
].join("\n");

const SNAPSHOT_FILE_NAMES = [
  "codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_narrow.snap",
  "codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_medium.snap",
  "codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_wide.snap"
];
const CODEX_MANIFEST = {
  schemaVersion: 1,
  upstreamVersion: "0.144.1",
  upstreamTag: "rust-v0.144.1",
  upstreamCommit: "44918ea10c0f99151c6710411b4322c2f5c96bea",
  ultraRevision: 1,
  i18nApiVersion: 1,
  catalogVersion: 1
};
const EXPECTED_STATE_FILES = [
  { relativePath: "codex-rs/tui/src/lib.rs", created: false },
  {
    relativePath: "codex-rs/tui/src/bottom_pane/status_line_setup.rs",
    created: false
  },
  {
    relativePath: "codex-rs/tui/src/history_cell/separators.rs",
    created: false
  },
  { relativePath: "codex-rs/tui/src/history_cell/tests.rs", created: false },
  { relativePath: "codex-rs/Cargo.toml", created: false },
  { relativePath: "codex-rs/tui/Cargo.toml", created: false },
  { relativePath: "codex-rs/Cargo.lock", created: false },
  { relativePath: "codex-rs/cli/src/main.rs", created: false },
  { relativePath: "codex-rs/tui/src/i18n.rs", created: true },
  { relativePath: "codex-rs/tui/src/i18n_tests.rs", created: true },
  ...SNAPSHOT_FILE_NAMES.map((fileName) => ({
    relativePath: "codex-rs/tui/src/bottom_pane/snapshots/" + fileName,
    created: true
  }))
];

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function rehashState(state) {
  const { stateHash: _oldHash, ...unsignedState } = state;
  return {
    ...unsignedState,
    stateHash: createHash("sha256")
      .update(Buffer.from(canonicalJson(unsignedState)))
      .digest("hex")
  };
}

async function createFixture() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "codex-ultra-adapter-"));
  const overlayDir = join(sourceRoot, "overlay");
  const workspaceCargoPath = join(sourceRoot, "codex-rs", "Cargo.toml");
  const cargoLockPath = join(sourceRoot, "codex-rs", "Cargo.lock");
  const tuiCargoPath = join(sourceRoot, "codex-rs", "tui", "Cargo.toml");
  const cliMainPath = join(
    sourceRoot,
    "codex-rs",
    "cli",
    "src",
    "main.rs"
  );
  const libPath = join(sourceRoot, "codex-rs", "tui", "src", "lib.rs");
  const statusPath = join(
    sourceRoot,
    "codex-rs",
    "tui",
    "src",
    "bottom_pane",
    "status_line_setup.rs"
  );
  const historySeparatorPath = join(
    sourceRoot,
    "codex-rs",
    "tui",
    "src",
    "history_cell",
    "separators.rs"
  );
  const historyTestsPath = join(
    sourceRoot,
    "codex-rs",
    "tui",
    "src",
    "history_cell",
    "tests.rs"
  );
  await mkdir(dirname(statusPath), { recursive: true });
  await mkdir(dirname(historySeparatorPath), { recursive: true });
  await mkdir(dirname(cliMainPath), { recursive: true });
  await mkdir(overlayDir, { recursive: true });
  await writeFile(workspaceCargoPath, WORKSPACE_CARGO_SOURCE, "utf8");
  await writeFile(cargoLockPath, CARGO_LOCK_SOURCE, "utf8");
  await writeFile(tuiCargoPath, TUI_CARGO_SOURCE, "utf8");
  await writeFile(cliMainPath, CLI_MAIN_SOURCE, "utf8");
  await writeFile(libPath, LIB_SOURCE, "utf8");
  await writeFile(statusPath, STATUS_SOURCE, "utf8");
  await writeFile(historySeparatorPath, HISTORY_SEPARATOR_SOURCE, "utf8");
  await writeFile(historyTestsPath, HISTORY_TESTS_SOURCE, "utf8");
  await writeFile(join(overlayDir, "i18n.rs"), "pub(crate) fn marker() {}\n", "utf8");
  await writeFile(
    join(overlayDir, "i18n_tests.rs"),
    "#[test]\nfn marker_test() {}\n",
    "utf8"
  );
  await mkdir(join(overlayDir, "snapshots"), { recursive: true });
  for (const fileName of SNAPSHOT_FILE_NAMES) {
    await writeFile(
      join(overlayDir, "snapshots", fileName),
      `${fileName}\n配置状态栏\n`,
      "utf8"
    );
  }
  return {
    sourceRoot,
    overlayDir,
    workspaceCargoPath,
    cargoLockPath,
    tuiCargoPath,
    cliMainPath,
    libPath,
    statusPath,
    historySeparatorPath,
    historyTestsPath
  };
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

async function readAdapterState(sourceRoot) {
  return JSON.parse(
    await readFile(
      join(sourceRoot, ".codex-ultra-mvp", "state.json"),
      "utf8"
    )
  );
}

async function restoreModifiedSourceFromBackup(sourceRoot, relativePath) {
  const pathSegments = relativePath.split("/");
  const backup = await readFile(
    join(sourceRoot, ".codex-ultra-mvp", "backups", ...pathSegments)
  );
  await writeFile(join(sourceRoot, ...pathSegments), backup);
}

test("planCodexPatch changes no files during preflight", async () => {
  const fixture = await createFixture();
  const before = await snapshotTree(fixture.sourceRoot);

  const plan = await planCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });

  assert.equal(plan.files.length, 13);
  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
});

test("planCodexPatch includes status-line and Worked for localization", async () => {
  const fixture = await createFixture();

  const plan = await planCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  const paths = plan.files.map((file) => file.relativePath);

  assert.ok(paths.includes("codex-rs/tui/src/history_cell/separators.rs"));
  assert.ok(paths.includes("codex-rs/tui/src/history_cell/tests.rs"));
  assert.equal(
    paths.filter((path) =>
      path.includes("status_line_setup__tests__status_line_setup_zh_cn_")
    ).length,
    3
  );
  for (const fileName of SNAPSHOT_FILE_NAMES) {
    const relativePath =
      "codex-rs/tui/src/bottom_pane/snapshots/" + fileName;
    const planned = plan.files.find(
      (file) => file.relativePath === relativePath
    );
    const overlay = await readFile(
      join(fixture.overlayDir, "snapshots", fileName)
    );
    assert.equal(
      planned.afterHash,
      createHash("sha256").update(overlay).digest("hex")
    );
  }
});

test("planCodexPatch disables optional Git locks", async () => {
  const fixture = await createFixture();
  const calls = [];

  await planCodexPatch(fixture.sourceRoot, {
    overlayDir: fixture.overlayDir,
    verifyLockFingerprint: false,
    execFileImpl: async (file, args, options) => {
      calls.push({ file, args, options });
      if (args.includes("rev-parse")) {
        return { stdout: TARGET_COMMIT + "\n" };
      }
      return { stdout: "" };
    }
  });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.file, "git");
    assert.equal(call.options.env.GIT_OPTIONAL_LOCKS, "0");
  }
});

test("applyCodexPatch installs overlays and localized call sites", async () => {
  const fixture = await createFixture();

  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });

  const status = await readFile(fixture.statusPath, "utf8");
  assert.match(status, /crate::i18n::global\(\)/);
  assert.match(status, /crate::i18n::Localizer/);
  assert.match(status, /new_with_localizer/);
  assert.match(status, /localizer\.text\([^)]*None/s);
  assert.match(
    await readFile(fixture.historySeparatorPath, "utf8"),
    /label_parts_with_localizer/
  );
  assert.match(
    await readFile(fixture.historyTestsPath, "utf8"),
    /加班了 7m 57s/
  );
  assert.match(
    await readFile(fixture.libPath, "utf8"),
    /pub fn ultra_i18n_self_check_json/
  );
  assert.match(
    await readFile(fixture.workspaceCargoPath, "utf8"),
    /fluent-bundle = "0\.15\.3"/
  );
  assert.match(
    await readFile(fixture.tuiCargoPath, "utf8"),
    /unic-langid = \{ workspace = true \}/
  );
  assert.match(
    await readFile(fixture.cargoLockPath, "utf8"),
    /name = "codex-tui"\nversion = "0\.144\.1"/
  );
  assert.match(
    await readFile(fixture.cliMainPath, "utf8"),
    /--ultra-i18n-self-check/
  );
  assert.equal(
    await readFile(
      join(fixture.sourceRoot, "codex-rs", "tui", "src", "i18n.rs"),
      "utf8"
    ),
    "pub(crate) fn marker() {}\n"
  );
  for (const fileName of SNAPSHOT_FILE_NAMES) {
    assert.match(
      await readFile(
        join(
          fixture.sourceRoot,
          "codex-rs",
          "tui",
          "src",
          "bottom_pane",
          "snapshots",
          fileName
        ),
        "utf8"
      ),
      /配置状态栏/
    );
  }
});

test("planCodexPatch hard-fails a drifting codex-tui lock block", async () => {
  const fixture = await createFixture();

  await assert.rejects(
    planCodexPatch(fixture.sourceRoot, {
      verifyGit: false,
      verifyLockFingerprint: true,
      overlayDir: fixture.overlayDir
    }),
    /unexpected codex-tui Cargo\.lock package block sha256/
  );
});

test("Codex state binds manifest identity and exact file roles", async () => {
  const fixture = await createFixture();

  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });

  const state = JSON.parse(
    await readFile(
      join(fixture.sourceRoot, ".codex-ultra-mvp", "state.json"),
      "utf8"
    )
  );
  assert.deepEqual(
    {
      adapterId: state.adapterId,
      targetCommit: state.targetCommit,
      ultraRevision: state.ultraRevision,
      i18nApiVersion: state.i18nApiVersion,
      catalogVersion: state.catalogVersion
    },
    {
      adapterId: "codex",
      targetCommit: CODEX_MANIFEST.upstreamCommit,
      ultraRevision: CODEX_MANIFEST.ultraRevision,
      i18nApiVersion: CODEX_MANIFEST.i18nApiVersion,
      catalogVersion: CODEX_MANIFEST.catalogVersion
    }
  );
  assert.deepEqual(
    state.files.map(({ relativePath, created }) => ({
      relativePath,
      created
    })),
    EXPECTED_STATE_FILES
  );
});

test("revertCodexPatch rejects a validly hashed wrong adapter identity", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  const statePath = join(
    fixture.sourceRoot,
    ".codex-ultra-mvp",
    "state.json"
  );
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.adapterId = "other-adapter";
  await writeFile(
    statePath,
    JSON.stringify(rehashState(state), null, 2) + "\n",
    "utf8"
  );

  await assert.rejects(
    revertCodexPatch(fixture.sourceRoot),
    /adapter state metadata mismatch/
  );
});

for (const [label, mutate] of [
  [
    "wrong path",
    (state) => {
      state.files[0].relativePath = "codex-rs/tui/src/other.rs";
    }
  ],
  [
    "wrong created role",
    (state) => {
      state.files[0].created = true;
      state.files[0].beforeHash = null;
    }
  ]
]) {
  test(`revertCodexPatch rejects a validly hashed ${label}`, async () => {
    const fixture = await createFixture();
    await applyCodexPatch(fixture.sourceRoot, {
      verifyGit: false,
      overlayDir: fixture.overlayDir
    });
    const statePath = join(
      fixture.sourceRoot,
      ".codex-ultra-mvp",
      "state.json"
    );
    const state = JSON.parse(await readFile(statePath, "utf8"));
    mutate(state);
    await writeFile(
      statePath,
      JSON.stringify(rehashState(state), null, 2) + "\n",
      "utf8"
    );

    await assert.rejects(
      revertCodexPatch(fixture.sourceRoot),
      /adapter state file allowlist mismatch/
    );
    assert.match(await readFile(fixture.libPath, "utf8"), /mod i18n;/);
  });
}

test("doctorCodexPatch rejects damaged state instead of reporting applied", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  const statePath = join(
    fixture.sourceRoot,
    ".codex-ultra-mvp",
    "state.json"
  );
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.targetCommit = "0000000000000000000000000000000000000000";
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  await assert.rejects(
    doctorCodexPatch(fixture.sourceRoot, { verifyGit: false }),
    /adapter state changed/
  );
});

test("planCodexPatch reads and rejects a drifting version manifest", async () => {
  const fixture = await createFixture();
  const manifestPath = join(fixture.sourceRoot, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        ...CODEX_MANIFEST,
        upstreamCommit: "0000000000000000000000000000000000000000"
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  await assert.rejects(
    planCodexPatch(fixture.sourceRoot, {
      verifyGit: false,
      overlayDir: fixture.overlayDir,
      manifestPath
    }),
    /invalid Codex adapter manifest/
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

test("backup failure removes adapter state without touching sources", async () => {
  const fixture = await createFixture();
  const before = await snapshotTree(fixture.sourceRoot);

  await assert.rejects(
    applyCodexPatch(fixture.sourceRoot, {
      verifyGit: false,
      overlayDir: fixture.overlayDir,
      writeFileImpl: async (path, ...args) => {
        if (
          path
            .replaceAll("\\", "/")
            .includes("/.codex-ultra-mvp/backups/")
        ) {
          throw new Error("simulated backup failure");
        }
        return writeFile(path, ...args);
      }
    }),
    /simulated backup failure/
  );

  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
  assert.equal(
    await pathExists(join(fixture.sourceRoot, ".codex-ultra-mvp")),
    false
  );
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

test("revertCodexPatch rejects a state path outside the source root", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  const statePath = join(
    fixture.sourceRoot,
    ".codex-ultra-mvp",
    "state.json"
  );
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.files[0].relativePath = "../outside-source.txt";
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  await assert.rejects(
    revertCodexPatch(fixture.sourceRoot),
    /unsafe adapter file path/
  );
  assert.equal(
    await pathExists(join(fixture.sourceRoot, "..", "outside-source.txt")),
    false
  );
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

test("doctorCodexPatch reports unapplied after all modified sources are restored", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  const state = await readAdapterState(fixture.sourceRoot);

  for (const file of state.files.filter((file) => !file.created)) {
    await restoreModifiedSourceFromBackup(
      fixture.sourceRoot,
      file.relativePath
    );
  }

  assert.equal(
    (await doctorCodexPatch(fixture.sourceRoot, { verifyGit: false })).applied,
    false
  );
});

test("doctorCodexPatch reports unapplied when a created source is missing", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  await rm(join(fixture.sourceRoot, "codex-rs", "tui", "src", "i18n.rs"));

  assert.equal(
    (await doctorCodexPatch(fixture.sourceRoot, { verifyGit: false })).applied,
    false
  );
});

test("doctorCodexPatch reports unapplied for a recoverable mixed source state", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  await restoreModifiedSourceFromBackup(
    fixture.sourceRoot,
    "codex-rs/tui/src/lib.rs"
  );

  assert.equal(
    (await doctorCodexPatch(fixture.sourceRoot, { verifyGit: false })).applied,
    false
  );
});

test("doctorCodexPatch rejects a current source outside before and after hashes", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  await writeFile(fixture.libPath, "unrelated source bytes\n", "utf8");

  await assert.rejects(
    doctorCodexPatch(fixture.sourceRoot, { verifyGit: false }),
    /patched file changed after apply/
  );
});

test("doctorCodexPatch rejects a damaged backup even after source restoration", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  const relativePath = "codex-rs/tui/src/lib.rs";
  await restoreModifiedSourceFromBackup(fixture.sourceRoot, relativePath);
  await writeFile(
    join(
      fixture.sourceRoot,
      ".codex-ultra-mvp",
      "backups",
      ...relativePath.split("/")
    ),
    "damaged backup bytes\n",
    "utf8"
  );

  await assert.rejects(
    doctorCodexPatch(fixture.sourceRoot, { verifyGit: false }),
    /adapter backup changed/
  );
});
