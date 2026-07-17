import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import test from "node:test";

import {
  applyOperations,
  planOperations,
  revertOperations
} from "../src/adapter/transaction.mjs";
import { LOCK_WORKSPACE_PACKAGE_NAMES } from "../src/adapter/codex-0.144.4.mjs";
import { runCli } from "../src/cli.mjs";
import {
  APPROVAL_OVERLAY_SOURCE,
  CHAT_COMPOSER_SOURCE,
  CHATWIDGET_CONSTRUCTOR_SOURCE,
  CHATWIDGET_SOURCE,
  FOOTER_SOURCE,
  MCP_STARTUP_SOURCE,
  SESSION_HEADER_SOURCE,
  STATUS_CARD_SOURCE,
  STATUS_FORMAT_SOURCE,
  STATUS_SURFACES_SOURCE,
  TOOLTIPS_SOURCE
} from "./fixtures/codex-adapter-sources.mjs";

const STATE_DIRECTORY = ".codex-ultra-mvp";
const SNAPSHOT_FILE_NAMES = [
  "codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_narrow.snap",
  "codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_medium.snap",
  "codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_wide.snap"
];

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
  ""
].join("\n");

const SLASH_COMMAND_SOURCE = [
  "pub enum SlashCommand {",
  "    Title,",
  "    Statusline,",
  "    Theme,",
  '    #[strum(to_string = "pets", serialize = "pet")]',
  "    Pets,",
  "    TestApproval,",
  "}",
  "impl SlashCommand {",
  "    fn description(self) -> &'static str {",
  "        match self {",
  '            SlashCommand::Statusline => "configure which items appear in the status line",',
  '            SlashCommand::Theme => "choose a syntax highlighting theme",',
  '            SlashCommand::Pets => "choose or hide the terminal pet",',
  '            SlashCommand::TestApproval => "test approval request",',
  "        }",
  "    }",
  "",
  "    /// Command string without the leading '/'. Provided for compatibility with",
  "    /// existing code that expects a method named `command()`.",
  "    pub fn command(self) -> &'static str {",
  '        "fixture"',
  "    }",
  "    fn supports_inline_args(self) -> bool {",
  "        matches!(self,",
  "                | SlashCommand::Raw",
  "                | SlashCommand::Usage",
  "                | SlashCommand::Pets",
  "        )",
  "    }",
  "    fn available_in_side_conversation(self) -> bool {",
  "        matches!(self,",
  "                | SlashCommand::Status",
  "                | SlashCommand::Usage",
  "                | SlashCommand::Ide",
  "        )",
  "    }",
  "    fn available_during_task(self) -> bool {",
  "        match self {",
  "            | SlashCommand::Title",
  "            | SlashCommand::Statusline",
  "            | SlashCommand::AutoReview => true,",
  "        }",
  "    }",
  "}",
  "#[cfg(test)]",
  "mod tests {",
  "    fn certain_commands_are_available_during_task() {",
  "        assert!(SlashCommand::Title.available_during_task());",
  "        assert!(SlashCommand::Statusline.available_during_task());",
  "        assert!(SlashCommand::Raw.available_during_task());",
  "    }",
  "}",
  ""
].join("\n");

const SLASH_DISPATCH_SOURCE = [
  "impl ChatWidget {",
  "    fn dispatch_command(&mut self, cmd: SlashCommand) {",
  "        match cmd {",
  "            SlashCommand::Theme => {",
  "                self.open_theme_picker();",
  "            }",
  "            SlashCommand::Pets => {",
  "                self.open_pets_picker();",
  "            }",
  "        }",
  "    }",
  "    fn dispatch_prepared(&mut self, cmd: SlashCommand, args: String, trimmed: &str) {",
  "        match cmd {",
  "            SlashCommand::Pets if !trimmed.is_empty() => {",
  "                self.select_pet_by_id(args);",
  "            }",
  "            _ => self.dispatch_command(cmd),",
  "        }",
  "    }",
  "    fn queued_command_drain_result(&self, cmd: SlashCommand) -> QueueDrain {",
  "        match cmd {",
  "            | SlashCommand::Statusline",
  "            | SlashCommand::Theme",
  "            | SlashCommand::Pets => QueueDrain::Stop,",
  "        }",
  "    }",
  "    fn dispatch_unknown(&mut self, name: &str) {",
  "            self.add_info_message(",
  "                format!(",
  '                    r#"Unrecognized command \'/{name}\'. Type "/" for a list of supported commands."#',
  "                ),",
  "                /*hint*/ None,",
  "            );",
  "    }",
  "}",
  ""
].join("\n");

const ONBOARDING_AUTH_SOURCE = [
  "impl AuthModeWidget {",
  "    fn render_pick_mode(&self, area: Rect, buf: &mut Buffer) {",
  "        let mut lines: Vec<Line> = vec![",
  "            Line::from(vec![",
  '                "  ".into(),',
  '                "Sign in with ChatGPT to use Codex as part of your paid plan".into(),',
  "            ]),",
  "            Line::from(vec![",
  '                "  ".into(),',
  '                "or connect an API key for usage-based billing".into(),',
  "            ]),",
  "        ];",
  '        let device_code_description = "Sign in from another device with a one-time code";',
  "        lines.extend(create_mode_item(",
  "                        0,",
  "                        option,",
  '                        "Sign in with ChatGPT",',
  "                        chatgpt_description,",
  "        ));",
  "        lines.extend(create_mode_item(",
  "                        1,",
  "                        option,",
  '                        "Provide your own API key",',
  '                        "Pay for what you use",',
  "        ));",
  "        if !self.is_api_login_allowed() {",
  "            lines.push(",
  '                "  API key login is disabled by this workspace. Sign in with ChatGPT to continue."',
  "                    .dim()",
  "                    .into(),",
  "            );",
  "        }",
  "    }",
  "}",
  ""
].join("\n");

const COMMAND_POPUP_SOURCE = [
  "impl CommandPopup {",
  "    fn rows_from_matches(&self) {",
  "                let description = item.description().to_string();",
  "    }",
  "}",
  "impl CommandItem {",
  "    fn description(&self) -> &str {",
  "        match self {",
  "            Self::Builtin(cmd) => cmd.description(),",
  "            Self::ServiceTier(command) => &command.description,",
  "        }",
  "    }",
  "}",
  "impl WidgetRef for CommandPopup {",
  "    fn render_ref(&self, area: Rect, buf: &mut Buffer) {",
  "        let rows = self.rows_from_matches(self.filtered());",
  "        render_rows_with_col_width_mode(",
  "            area.inset(Insets::tlbr(",
  "                /*top*/ 0, /*left*/ 2, /*bottom*/ 0, /*right*/ 0,",
  "            )),",
  "            buf,",
  "            &rows,",
  "            &self.state,",
  "            MAX_POPUP_ROWS,",
  '            "no matches",',
  "            COMMAND_COLUMN_WIDTH,",
  "        );",
  "    }",
  "}",
  ""
].join("\n");

const COMMAND_POPUP_SNAPSHOT_SOURCE = [
  "/statusline - configure which items appear in the status line",
  "/theme - choose a syntax highlighting theme",
  "/pets - choose or hide the terminal pet",
  ""
].join("\n");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeFixtureFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

async function createTransactionFixture(files) {
  const sourceRoot = await mkdtemp(join(tmpdir(), "codex-ultra-transaction-"));
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFixtureFile(sourceRoot, relativePath, content);
  }
  return sourceRoot;
}

async function createDirectoryLink(target, path) {
  await symlink(
    target,
    path,
    process.platform === "win32" ? "junction" : "dir"
  );
}

function createMkdirBarrier(targetPath) {
  let arrivals = 0;
  let release;
  const barrier = new Promise((resolveBarrier) => {
    release = resolveBarrier;
  });
  return async (path, options) => {
    if (path === targetPath && arrivals < 2) {
      arrivals += 1;
      if (arrivals === 2) {
        release();
      }
      await barrier;
    }
    return mkdir(path, options);
  };
}

async function createCodexFixture() {
  const sourceRoot = await createTransactionFixture({
    "codex-rs/Cargo.toml": WORKSPACE_CARGO_SOURCE,
    "codex-rs/Cargo.lock": CARGO_LOCK_SOURCE,
    "codex-rs/cli/src/main.rs": CLI_MAIN_SOURCE,
    "codex-rs/tui/Cargo.toml": TUI_CARGO_SOURCE,
    "codex-rs/tui/src/lib.rs": LIB_SOURCE,
    "codex-rs/tui/src/bottom_pane/status_line_setup.rs": STATUS_SOURCE,
    "codex-rs/tui/src/history_cell/separators.rs":
      HISTORY_SEPARATOR_SOURCE,
    "codex-rs/tui/src/history_cell/tests.rs": HISTORY_TESTS_SOURCE,
    "codex-rs/tui/src/slash_command.rs": SLASH_COMMAND_SOURCE,
    "codex-rs/tui/src/chatwidget/slash_dispatch.rs": SLASH_DISPATCH_SOURCE,
    "codex-rs/tui/src/bottom_pane/command_popup.rs": COMMAND_POPUP_SOURCE,
    "codex-rs/tui/src/status/card.rs": STATUS_CARD_SOURCE,
    "codex-rs/tui/src/status/format.rs": STATUS_FORMAT_SOURCE,
    "codex-rs/tui/src/history_cell/session.rs": SESSION_HEADER_SOURCE,
    "codex-rs/tui/src/tooltips.rs": TOOLTIPS_SOURCE,
    "codex-rs/tui/src/chatwidget.rs": CHATWIDGET_SOURCE,
    "codex-rs/tui/src/chatwidget/constructor.rs": CHATWIDGET_CONSTRUCTOR_SOURCE,
    "codex-rs/tui/src/chatwidget/mcp_startup.rs": MCP_STARTUP_SOURCE,
    "codex-rs/tui/src/chatwidget/status_surfaces.rs": STATUS_SURFACES_SOURCE,
    "codex-rs/tui/src/bottom_pane/footer.rs": FOOTER_SOURCE,
    "codex-rs/tui/src/bottom_pane/chat_composer.rs": CHAT_COMPOSER_SOURCE,
    "codex-rs/tui/src/bottom_pane/approval_overlay.rs":
      APPROVAL_OVERLAY_SOURCE,
    "codex-rs/tui/src/onboarding/auth.rs": ONBOARDING_AUTH_SOURCE,
    "codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__command_popup__tests__command_popup_default_items.snap":
      COMMAND_POPUP_SNAPSHOT_SOURCE
  });
  const overlayDir = join(sourceRoot, "overlay");
  await mkdir(overlayDir, { recursive: true });
  await writeFile(
    join(overlayDir, "i18n.rs"),
    "pub(crate) fn marker() {}\n",
    "utf8"
  );
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
  return { sourceRoot, overlayDir };
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
        snapshot[relative(root, path).replaceAll("\\", "/")] = (
          await readFile(path)
        ).toString("base64");
      }
    }
  }
  await visit(root);
  return snapshot;
}

test("adapter plan is read-only and prints relative paths with hashes", async () => {
  const fixture = await createCodexFixture();
  const before = await snapshotTree(fixture.sourceRoot);
  let output = "";

  const result = await runCli(
    ["adapter", "plan", "--source", fixture.sourceRoot],
    {
      stdout: { write(chunk) { output += chunk; } },
      adapterOptions: {
        verifyGit: false,
        overlayDir: fixture.overlayDir
      }
    }
  );

  assert.equal(result.command, "adapter plan");
  assert.equal(result.files.length, 29);
  assert.deepEqual(JSON.parse(output), result);
  for (const file of result.files) {
    assert.match(file.relativePath, /^[^\\/]+(?:\/[^\\/]+)*$/);
    assert.match(file.afterHash, /^[a-f0-9]{64}$/);
    if (file.created) {
      assert.equal(file.beforeHash, null);
    } else {
      assert.match(file.beforeHash, /^[a-f0-9]{64}$/);
    }
  }
  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
  assert.equal(
    await pathExists(join(fixture.sourceRoot, STATE_DIRECTORY)),
    false
  );
});

test("whole-plan anchor drift rejects before any source write", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const before = await snapshotTree(sourceRoot);

  await assert.rejects(
    applyOperations(sourceRoot, [
      {
        type: "replace",
        relativePath: "src/first.txt",
        anchor: "alpha",
        replacement: "changed"
      },
      {
        type: "replace",
        relativePath: "src/second.txt",
        anchor: "missing",
        replacement: "changed"
      }
    ]),
    /anchor drift/
  );

  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("revertOperations restores exact original bytes", async () => {
  const original = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("alpha\r\n中文\r\n", "utf8"),
    Buffer.from([0x00, 0xff])
  ]);
  const sourceRoot = await createTransactionFixture({
    "src/exact.bin": original
  });
  const targetPath = join(sourceRoot, "src", "exact.bin");

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/exact.bin",
      anchor: Buffer.from("alpha"),
      replacement: Buffer.from("omega")
    }
  ]);
  assert.notDeepEqual(await readFile(targetPath), original);

  await revertOperations(sourceRoot);

  assert.deepEqual(await readFile(targetPath), original);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("revertOperations accepts mixed before, after, and missing-created state", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const firstPath = join(sourceRoot, "src", "first.txt");
  const secondPath = join(sourceRoot, "src", "second.txt");
  const createdPath = join(sourceRoot, "src", "created.txt");

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/first.txt",
      anchor: "alpha",
      replacement: "changed-alpha"
    },
    {
      type: "replace",
      relativePath: "src/second.txt",
      anchor: "bravo",
      replacement: "changed-bravo"
    },
    {
      type: "create",
      relativePath: "src/created.txt",
      content: "created\n"
    }
  ]);
  await writeFile(firstPath, "alpha\n", "utf8");
  await rm(createdPath);

  await revertOperations(sourceRoot);

  assert.equal(await readFile(firstPath, "utf8"), "alpha\n");
  assert.equal(await readFile(secondPath, "utf8"), "bravo\n");
  assert.equal(await pathExists(createdPath), false);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("revertOperations retries partial tombstone cleanup without rereading state", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const targetPath = join(sourceRoot, "src", "file.txt");
  const stateDirectory = "claims/active";
  const stateRoot = join(sourceRoot, "claims", "active");
  const tombstoneRoot = join(
    sourceRoot,
    "claims",
    "active.cleanup-pending"
  );
  let cleanupAttempts = 0;
  let stateRenames = 0;

  await applyOperations(
    sourceRoot,
    [
      {
        type: "replace",
        relativePath: "src/file.txt",
        anchor: "alpha",
        replacement: "omega"
      }
    ],
    { stateDirectory }
  );

  const rmImpl = async (path, options) => {
    if (path === tombstoneRoot && options?.recursive) {
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) {
        await rm(join(tombstoneRoot, "state.json"), { force: true });
        await rm(
          join(tombstoneRoot, "backups", "src", "file.txt"),
          { force: true }
        );
        throw Object.assign(new Error("simulated tombstone lock"), {
          code: "EBUSY"
        });
      }
    }
    return rm(path, options);
  };
  const renameImpl = async (oldPath, newPath) => {
    if (oldPath === stateRoot && newPath === tombstoneRoot) {
      stateRenames += 1;
    }
    return rename(oldPath, newPath);
  };

  await assert.rejects(
    revertOperations(sourceRoot, { stateDirectory, renameImpl, rmImpl }),
    /simulated tombstone lock/
  );
  assert.equal(await readFile(targetPath, "utf8"), "alpha\n");
  assert.equal(await pathExists(stateRoot), false);
  assert.equal(await pathExists(tombstoneRoot), true);
  assert.equal(await pathExists(join(tombstoneRoot, "state.json")), false);

  const cleanupResult = await revertOperations(sourceRoot, {
    stateDirectory,
    renameImpl,
    rmImpl
  });

  assert.equal(cleanupAttempts, 2);
  assert.equal(stateRenames, 1);
  assert.equal(cleanupResult, null);
  assert.equal(await readFile(targetPath, "utf8"), "alpha\n");
  assert.equal(await pathExists(stateRoot), false);
  assert.equal(await pathExists(tombstoneRoot), false);
});

test("plan and apply reject an existing cleanup tombstone without overwriting it", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const stateDirectory = "claims/active";
  const tombstoneRoot = join(
    sourceRoot,
    "claims",
    "active.cleanup-pending"
  );
  const markerPath = join(tombstoneRoot, "marker.txt");
  const operations = [
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "alpha",
      replacement: "omega"
    }
  ];
  await mkdir(tombstoneRoot, { recursive: true });
  await writeFile(markerPath, "pending cleanup\n", "utf8");
  const before = await snapshotTree(sourceRoot);

  await assert.rejects(
    planOperations(sourceRoot, operations, { stateDirectory }),
    /adapter cleanup pending/
  );
  await assert.rejects(
    applyOperations(sourceRoot, operations, { stateDirectory }),
    /adapter cleanup pending/
  );

  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await readFile(markerPath, "utf8"), "pending cleanup\n");
  assert.equal(await pathExists(join(sourceRoot, "claims", "active")), false);
});

test("revertOperations rejects simultaneous active and tombstone state", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const targetPath = join(sourceRoot, "src", "file.txt");
  const stateRoot = join(sourceRoot, STATE_DIRECTORY);
  const tombstoneRoot = join(
    sourceRoot,
    `${STATE_DIRECTORY}.cleanup-pending`
  );

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "alpha",
      replacement: "omega"
    }
  ]);
  await mkdir(tombstoneRoot);
  await writeFile(join(tombstoneRoot, "marker.txt"), "ambiguous\n", "utf8");

  await assert.rejects(
    revertOperations(sourceRoot),
    /ambiguous adapter state cleanup/
  );

  assert.equal(await readFile(targetPath, "utf8"), "omega\n");
  assert.equal(await pathExists(join(stateRoot, "state.json")), true);
  assert.equal(
    await readFile(join(tombstoneRoot, "marker.txt"), "utf8"),
    "ambiguous\n"
  );
});

test("cleanup tombstone path rejects a symlink or junction", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const outsideRoot = await mkdtemp(join(tmpdir(), "codex-ultra-outside-"));
  const outsideMarker = join(outsideRoot, "marker.txt");
  const tombstonePath = join(
    sourceRoot,
    `${STATE_DIRECTORY}.cleanup-pending`
  );
  await writeFile(outsideMarker, "outside\n", "utf8");
  await createDirectoryLink(outsideRoot, tombstonePath);

  await assert.rejects(
    planOperations(sourceRoot, [
      {
        type: "replace",
        relativePath: "src/file.txt",
        anchor: "alpha",
        replacement: "omega"
      }
    ]),
    /unsafe adapter reparse point/
  );

  assert.equal(await readFile(outsideMarker, "utf8"), "outside\n");
});

test("revert rollback uses injected fs operations and restores call-time bytes", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const firstPath = join(sourceRoot, "src", "first.txt");
  const secondPath = join(sourceRoot, "src", "second.txt");
  let secondRestoreFailed = false;
  let injectedRollbackSeen = false;

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/first.txt",
      anchor: "alpha",
      replacement: "changed-alpha"
    },
    {
      type: "replace",
      relativePath: "src/second.txt",
      anchor: "bravo",
      replacement: "changed-bravo"
    }
  ]);

  await assert.rejects(
    revertOperations(sourceRoot, {
      writeFileImpl: async (path, data, ...args) => {
        const normalized = path.replaceAll("\\", "/");
        if (
          normalized.includes("/src/second.txt.tmp-") &&
          Buffer.from(data).equals(Buffer.from("bravo\n"))
        ) {
          secondRestoreFailed = true;
          throw new Error("simulated revert failure");
        }
        if (
          secondRestoreFailed &&
          normalized.includes("/src/first.txt.tmp-") &&
          Buffer.from(data).equals(Buffer.from("changed-alpha\n"))
        ) {
          injectedRollbackSeen = true;
        }
        return writeFile(path, data, ...args);
      }
    }),
    /simulated revert failure/
  );

  assert.equal(injectedRollbackSeen, true);
  assert.equal(await readFile(firstPath, "utf8"), "changed-alpha\n");
  assert.equal(await readFile(secondPath, "utf8"), "changed-bravo\n");
  assert.equal(
    await pathExists(join(sourceRoot, STATE_DIRECTORY, "state.json")),
    true
  );
});

test("modified revert registers rename commit before temp cleanup can fail", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const firstPath = join(sourceRoot, "src", "first.txt");
  const secondPath = join(sourceRoot, "src", "second.txt");
  let rebuiltTempPath = null;

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/first.txt",
      anchor: "alpha",
      replacement: "changed-alpha"
    },
    {
      type: "replace",
      relativePath: "src/second.txt",
      anchor: "bravo",
      replacement: "changed-bravo"
    }
  ]);

  await assert.rejects(
    revertOperations(sourceRoot, {
      renameImpl: async (oldPath, newPath) => {
        await rename(oldPath, newPath);
        if (newPath === firstPath && rebuiltTempPath === null) {
          rebuiltTempPath = oldPath;
          await writeFile(oldPath, "rebuilt-temp\n", "utf8");
        }
      },
      writeFileImpl: async (path, data, ...args) => {
        if (
          path.replaceAll("\\", "/").includes("/src/second.txt.tmp-") &&
          Buffer.from(data).equals(Buffer.from("bravo\n"))
        ) {
          throw new Error("simulated second revert failure");
        }
        return writeFile(path, data, ...args);
      },
      rmImpl: async (path, options) => {
        if (path === rebuiltTempPath) {
          throw Object.assign(new Error("simulated rebuilt temp lock"), {
            code: "EBUSY"
          });
        }
        return rm(path, options);
      }
    })
  );

  assert.equal(await readFile(firstPath, "utf8"), "changed-alpha\n");
  assert.equal(await readFile(secondPath, "utf8"), "changed-bravo\n");
  assert.equal(
    await pathExists(join(sourceRoot, STATE_DIRECTORY, "state.json")),
    true
  );
});

test("create rejects an existing target and cannot share a path", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/existing.txt": "original\n"
  });
  const before = await snapshotTree(sourceRoot);

  await assert.rejects(
    planOperations(sourceRoot, [
      {
        type: "create",
        relativePath: "src/existing.txt",
        content: "replacement\n"
      }
    ]),
    /create target already exists/
  );
  await assert.rejects(
    planOperations(sourceRoot, [
      {
        type: "create",
        relativePath: "src/new.txt",
        content: "new\n"
      },
      {
        type: "replace",
        relativePath: "src/new.txt",
        anchor: "new",
        replacement: "changed"
      }
    ]),
    /create operation cannot share a path/
  );

  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("create never overwrites a target that appears after preflight", async () => {
  const sourceRoot = await createTransactionFixture({});
  const targetPath = join(sourceRoot, "src", "race.txt");
  let raced = false;

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "create",
          relativePath: "src/race.txt",
          content: "adapter\n"
        }
      ],
      {
        linkImpl: async (existingPath, newPath) => {
          if (!raced && newPath === targetPath) {
            raced = true;
            await writeFile(targetPath, "competitor\n", "utf8");
          }
          return link(existingPath, newPath);
        }
      }
    ),
    (error) => error?.code === "EEXIST"
  );

  assert.equal(raced, true);
  assert.equal(await readFile(targetPath, "utf8"), "competitor\n");
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("concurrent modified applies atomically claim the default state root", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const stateRoot = join(sourceRoot, STATE_DIRECTORY);
  const operations = [
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "alpha",
      replacement: "omega"
    }
  ];
  const mkdirImpl = createMkdirBarrier(stateRoot);

  const results = await Promise.allSettled([
    applyOperations(sourceRoot, operations, { mkdirImpl }),
    applyOperations(sourceRoot, operations, { mkdirImpl })
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.code, "EEXIST");
  assert.equal(
    await readFile(join(sourceRoot, "src", "file.txt"), "utf8"),
    "omega\n"
  );
  assert.equal(await pathExists(join(stateRoot, "state.json")), true);
});

test("concurrent nested-state create loser never deletes winner state", async () => {
  const sourceRoot = await createTransactionFixture({});
  const stateDirectory = "claims/active";
  const stateRoot = join(sourceRoot, "claims", "active");
  const operations = [
    {
      type: "create",
      relativePath: "src/created.txt",
      content: "winner\n"
    }
  ];
  const mkdirImpl = createMkdirBarrier(stateRoot);

  const results = await Promise.allSettled([
    applyOperations(sourceRoot, operations, { stateDirectory, mkdirImpl }),
    applyOperations(sourceRoot, operations, { stateDirectory, mkdirImpl })
  ]);
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");

  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason?.code, "EEXIST");
  assert.equal(
    await readFile(join(sourceRoot, "src", "created.txt"), "utf8"),
    "winner\n"
  );
  assert.equal(await pathExists(join(stateRoot, "state.json")), true);
});

test("backup failure cleans state and leaves source bytes untouched", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const before = await snapshotTree(sourceRoot);

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/file.txt",
          anchor: "alpha",
          replacement: "omega"
        }
      ],
      {
        writeFileImpl: async (path, ...args) => {
          if (
            path
              .replaceAll("\\", "/")
              .includes(`/${STATE_DIRECTORY}/backups/`)
          ) {
            throw new Error("simulated backup failure");
          }
          return writeFile(path, ...args);
        }
      }
    ),
    /simulated backup failure/
  );

  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("state write failure cleans state and leaves source bytes untouched", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const before = await snapshotTree(sourceRoot);

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/file.txt",
          anchor: "alpha",
          replacement: "omega"
        }
      ],
      {
        writeFileImpl: async (path, ...args) => {
          if (
            path
              .replaceAll("\\", "/")
              .includes(`/${STATE_DIRECTORY}/state.json`)
          ) {
            throw new Error("simulated state failure");
          }
          return writeFile(path, ...args);
        }
      }
    ),
    /simulated state failure/
  );

  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("apply forward, rollback, and cleanup all use injected fs operations", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const stateRoot = join(sourceRoot, STATE_DIRECTORY);
  const tombstoneRoot = join(
    sourceRoot,
    `${STATE_DIRECTORY}.cleanup-pending`
  );
  let forwardFailed = false;
  let rollbackWriteSeen = false;
  let stateTransitionSeen = false;
  let stateCleanupSeen = false;

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/first.txt",
          anchor: "alpha",
          replacement: "changed-alpha"
        },
        {
          type: "replace",
          relativePath: "src/second.txt",
          anchor: "bravo",
          replacement: "changed-bravo"
        }
      ],
      {
        lstatImpl: (...args) => lstat(...args),
        realpathImpl: (...args) => realpath(...args),
        readFileImpl: (...args) => readFile(...args),
        mkdirImpl: (...args) => mkdir(...args),
        writeFileImpl: async (path, data, ...args) => {
          const normalized = path.replaceAll("\\", "/");
          if (
            !normalized.includes(`/${STATE_DIRECTORY}/`) &&
            normalized.includes("/src/second.txt.tmp-") &&
            Buffer.from(data).equals(Buffer.from("changed-bravo\n"))
          ) {
            forwardFailed = true;
            throw new Error("simulated forward failure");
          }
          if (
            forwardFailed &&
            normalized.includes("/src/first.txt.tmp-") &&
            Buffer.from(data).equals(Buffer.from("alpha\n"))
          ) {
            rollbackWriteSeen = true;
          }
          return writeFile(path, data, ...args);
        },
        renameImpl: async (oldPath, newPath) => {
          if (oldPath === stateRoot && newPath === tombstoneRoot) {
            stateTransitionSeen = true;
          }
          return rename(oldPath, newPath);
        },
        linkImpl: (...args) => link(...args),
        rmImpl: async (path, options) => {
          if (path === tombstoneRoot && options?.recursive) {
            stateCleanupSeen = true;
          }
          return rm(path, options);
        }
      }
    ),
    /simulated forward failure/
  );

  assert.equal(rollbackWriteSeen, true);
  assert.equal(stateTransitionSeen, true);
  assert.equal(stateCleanupSeen, true);
  assert.equal(
    await readFile(join(sourceRoot, "src", "first.txt"), "utf8"),
    "alpha\n"
  );
  assert.equal(
    await readFile(join(sourceRoot, "src", "second.txt"), "utf8"),
    "bravo\n"
  );
  assert.equal(await pathExists(stateRoot), false);
});

test("modified apply registers rename commit before temp cleanup can fail", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const firstPath = join(sourceRoot, "src", "first.txt");
  const secondPath = join(sourceRoot, "src", "second.txt");
  let rebuiltTempPath = null;

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/first.txt",
          anchor: "alpha",
          replacement: "changed-alpha"
        },
        {
          type: "replace",
          relativePath: "src/second.txt",
          anchor: "bravo",
          replacement: "changed-bravo"
        }
      ],
      {
        renameImpl: async (oldPath, newPath) => {
          await rename(oldPath, newPath);
          if (newPath === firstPath && rebuiltTempPath === null) {
            rebuiltTempPath = oldPath;
            await writeFile(oldPath, "rebuilt-temp\n", "utf8");
          }
        },
        writeFileImpl: async (path, data, ...args) => {
          if (
            path.replaceAll("\\", "/").includes("/src/second.txt.tmp-") &&
            Buffer.from(data).equals(Buffer.from("changed-bravo\n"))
          ) {
            throw new Error("simulated second forward failure");
          }
          return writeFile(path, data, ...args);
        },
        rmImpl: async (path, options) => {
          if (path === rebuiltTempPath) {
            throw Object.assign(new Error("simulated rebuilt temp lock"), {
              code: "EBUSY"
            });
          }
          return rm(path, options);
        }
      }
    )
  );

  assert.equal(await readFile(firstPath, "utf8"), "alpha\n");
  assert.equal(await readFile(secondPath, "utf8"), "bravo\n");
  assert.equal(
    await pathExists(join(sourceRoot, STATE_DIRECTORY, "state.json")),
    false
  );
});

test("incomplete apply rollback keeps state and backups for recovery", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const stateRoot = join(sourceRoot, STATE_DIRECTORY);
  let forwardFailed = false;

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/first.txt",
          anchor: "alpha",
          replacement: "changed-alpha"
        },
        {
          type: "replace",
          relativePath: "src/second.txt",
          anchor: "bravo",
          replacement: "changed-bravo"
        }
      ],
      {
        writeFileImpl: async (path, data, ...args) => {
          const normalized = path.replaceAll("\\", "/");
          if (
            !normalized.includes(`/${STATE_DIRECTORY}/`) &&
            normalized.includes("/src/second.txt.tmp-") &&
            Buffer.from(data).equals(Buffer.from("changed-bravo\n"))
          ) {
            forwardFailed = true;
            throw new Error("simulated forward failure");
          }
          if (
            forwardFailed &&
            normalized.includes("/src/first.txt.tmp-") &&
            Buffer.from(data).equals(Buffer.from("alpha\n"))
          ) {
            throw new Error("simulated rollback failure");
          }
          return writeFile(path, data, ...args);
        }
      }
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors.some((item) => /simulated rollback failure/.test(item.message))
  );

  assert.equal(
    await readFile(join(sourceRoot, "src", "first.txt"), "utf8"),
    "changed-alpha\n"
  );
  assert.equal(
    await readFile(join(sourceRoot, "src", "second.txt"), "utf8"),
    "bravo\n"
  );
  assert.equal(await pathExists(join(stateRoot, "state.json")), true);
  assert.equal(
    await pathExists(join(stateRoot, "backups", "src", "first.txt")),
    true
  );
});

test("operation and tampered state path escapes are rejected before writes", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const outsidePath = resolve(sourceRoot, "..", "outside.txt");
  const absoluteSlashPath = outsidePath.replaceAll("\\", "/");

  for (const relativePath of [
    "../outside.txt",
    absoluteSlashPath,
    "nested\\outside.txt"
  ]) {
    await assert.rejects(
      planOperations(sourceRoot, [
        {
          type: "create",
          relativePath,
          content: "unsafe\n"
        }
      ]),
      /unsafe adapter file path/
    );
  }
  assert.equal(await pathExists(outsidePath), false);

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/first.txt",
      anchor: "alpha",
      replacement: "changed-alpha"
    },
    {
      type: "replace",
      relativePath: "src/second.txt",
      anchor: "bravo",
      replacement: "changed-bravo"
    }
  ]);
  const firstPath = join(sourceRoot, "src", "first.txt");
  const secondPath = join(sourceRoot, "src", "second.txt");
  const firstApplied = await readFile(firstPath);
  const secondApplied = await readFile(secondPath);
  const statePath = join(sourceRoot, STATE_DIRECTORY, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.files[1].relativePath = "../outside.txt";
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  await assert.rejects(
    revertOperations(sourceRoot),
    /unsafe adapter file path/
  );

  assert.deepEqual(await readFile(firstPath), firstApplied);
  assert.deepEqual(await readFile(secondPath), secondApplied);
  assert.equal(await pathExists(outsidePath), false);
});

test("operation paths reject an existing symlink or junction", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/safe.txt": "safe\n"
  });
  const outsideRoot = await createTransactionFixture({
    "outside.txt": "outside\n"
  });
  const linkPath = join(sourceRoot, "linked");
  await createDirectoryLink(outsideRoot, linkPath);

  await assert.rejects(
    planOperations(sourceRoot, [
      {
        type: "replace",
        relativePath: "linked/outside.txt",
        anchor: "outside",
        replacement: "changed"
      }
    ]),
    /unsafe adapter reparse point/
  );

  assert.equal(
    await readFile(join(outsideRoot, "outside.txt"), "utf8"),
    "outside\n"
  );
});

test("stateDirectory rejects an existing symlink or junction", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const outsideRoot = await createTransactionFixture({
    "sentinel.txt": "outside\n"
  });
  await createDirectoryLink(outsideRoot, join(sourceRoot, ".state-link"));

  await assert.rejects(
    planOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/file.txt",
          anchor: "alpha",
          replacement: "omega"
        }
      ],
      { stateDirectory: ".state-link" }
    ),
    /unsafe adapter reparse point/
  );

  assert.equal(
    await readFile(join(outsideRoot, "sentinel.txt"), "utf8"),
    "outside\n"
  );
});

test("source rename revalidates a parent replaced after temp write", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const outsideRoot = await createTransactionFixture({
    "file.txt": "outside\n"
  });
  let swapped = false;

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/file.txt",
          anchor: "alpha",
          replacement: "omega"
        }
      ],
      {
        writeFileImpl: async (path, data, ...args) => {
          await writeFile(path, data, ...args);
          const normalized = path.replaceAll("\\", "/");
          if (
            !swapped &&
            !normalized.includes(`/${STATE_DIRECTORY}/`) &&
            normalized.includes("/src/file.txt.tmp-")
          ) {
            swapped = true;
            await rename(
              join(sourceRoot, "src"),
              join(sourceRoot, "src-real")
            );
            await createDirectoryLink(outsideRoot, join(sourceRoot, "src"));
            await writeFile(
              join(outsideRoot, basename(path)),
              "attacker-temp\n",
              "utf8"
            );
          }
        }
      }
    )
  );

  assert.equal(swapped, true);
  assert.equal(
    await readFile(join(outsideRoot, "file.txt"), "utf8"),
    "outside\n"
  );
});

test("revert rejects an extra state junction before recursive cleanup", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const outsideRoot = await createTransactionFixture({
    "sentinel.txt": "outside\n"
  });
  const targetPath = join(sourceRoot, "src", "file.txt");
  const stateRoot = join(sourceRoot, STATE_DIRECTORY);

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "alpha",
      replacement: "omega"
    }
  ]);
  await createDirectoryLink(outsideRoot, join(stateRoot, "extra-link"));

  await assert.rejects(
    revertOperations(sourceRoot),
    /unsafe adapter reparse point/
  );

  assert.equal(await readFile(targetPath, "utf8"), "omega\n");
  assert.equal(await pathExists(stateRoot), true);
  assert.equal(
    await readFile(join(outsideRoot, "sentinel.txt"), "utf8"),
    "outside\n"
  );
});

test("win32 path identity rejects case aliases", async () => {
  const sourceRoot = await createTransactionFixture({});

  await assert.rejects(
    planOperations(
      sourceRoot,
      [
        { type: "create", relativePath: "Foo.txt", content: "one\n" },
        { type: "create", relativePath: "foo.txt", content: "two\n" }
      ],
      { platform: "win32" }
    ),
    /adapter path identity collision/
  );
});

test("win32 stateDirectory identity cannot overlap an operation path", async () => {
  const sourceRoot = await createTransactionFixture({});

  await assert.rejects(
    planOperations(
      sourceRoot,
      [
        {
          type: "create",
          relativePath: "state/file.txt",
          content: "unsafe\n"
        }
      ],
      { platform: "win32", stateDirectory: "State" }
    ),
    /adapter state path overlaps an operation path/
  );
});

test("win32 paths reject ADS, DOS devices, and trailing dots or spaces", async () => {
  const sourceRoot = await createTransactionFixture({});

  for (const relativePath of [
    "src/file.txt:stream",
    "src/CON",
    "src/nul.txt",
    "src/trailing.",
    "src/trailing "
  ]) {
    await assert.rejects(
      planOperations(
        sourceRoot,
        [{ type: "create", relativePath, content: "unsafe\n" }],
        { platform: "win32" }
      ),
      /unsafe Windows adapter path/
    );
  }

  await assert.rejects(
    planOperations(
      sourceRoot,
      [{ type: "create", relativePath: "safe.txt", content: "safe\n" }],
      { platform: "win32", stateDirectory: "state." }
    ),
    /unsafe Windows adapter path/
  );
});

test("non-ENOENT lstat errors are never treated as missing paths", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/existing.txt": "safe\n"
  });
  const denied = Object.assign(new Error("simulated access denied"), {
    code: "EACCES"
  });

  await assert.rejects(
    planOperations(
      sourceRoot,
      [
        {
          type: "create",
          relativePath: "src/blocked.txt",
          content: "unsafe\n"
        }
      ],
      {
        lstatImpl: async (path) => {
          if (path.endsWith("blocked.txt")) {
            throw denied;
          }
          return lstat(path);
        }
      }
    ),
    (error) => error === denied
  );
});

test("revert rejects state role tampering before source writes", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const targetPath = join(sourceRoot, "src", "file.txt");

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "alpha",
      replacement: "omega"
    }
  ]);
  const applied = await readFile(targetPath);
  const statePath = join(sourceRoot, STATE_DIRECTORY, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.files[0].created = true;
  state.files[0].beforeHash = null;
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  await assert.rejects(
    revertOperations(sourceRoot),
    /adapter state changed/
  );

  assert.deepEqual(await readFile(targetPath), applied);
});

for (const [label, stateMetadata] of [
  ["top-level Date", new Date("2026-07-12T00:00:00.000Z")],
  ["nested Date", { value: new Date("2026-07-12T00:00:00.000Z") }],
  ["undefined", { value: undefined }],
  ["function", { value() {} }],
  ["BigInt", { value: 1n }],
  ["NaN", { value: Number.NaN }],
  ["Infinity", { value: Number.POSITIVE_INFINITY }],
  ["sparse array", { value: Array(1) }],
  [
    "array with an extra property",
    {
      value: Object.assign([], { extra: "not JSON" })
    }
  ],
  [
    "Array subclass",
    {
      value: new (class extends Array {})()
    }
  ],
  [
    "array with own toJSON",
    {
      value: (() => {
        const array = [];
        Object.defineProperty(array, "toJSON", {
          value() {
            return [];
          }
        });
        return array;
      })()
    }
  ]
]) {
  test(`state metadata rejects non-JSON ${label}`, async () => {
    const sourceRoot = await createTransactionFixture({
      "src/file.txt": "alpha\n"
    });
    const before = await snapshotTree(sourceRoot);

    await assert.rejects(
      applyOperations(
        sourceRoot,
        [
          {
            type: "replace",
            relativePath: "src/file.txt",
            anchor: "alpha",
            replacement: "omega"
          }
        ],
        { stateMetadata }
      ),
      /state metadata must contain only plain JSON values/
    );

    assert.deepEqual(await snapshotTree(sourceRoot), before);
    assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
  });
}

test("inspectOperationsState enforces expected metadata and file roles", async () => {
  const { inspectOperationsState } = await import(
    "../src/adapter/transaction.mjs"
  );
  assert.equal(typeof inspectOperationsState, "function");
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const expectedFiles = [
    { relativePath: "src/file.txt", created: false }
  ];

  await applyOperations(
    sourceRoot,
    [
      {
        type: "replace",
        relativePath: "src/file.txt",
        anchor: "alpha",
        replacement: "omega"
      }
    ],
    { stateMetadata: { adapterId: "fixture", revision: 1 } }
  );

  const inspected = await inspectOperationsState(sourceRoot, {
    expectedStateMetadata: { adapterId: "fixture", revision: 1 },
    expectedFiles
  });
  assert.equal(inspected.state.adapterId, "fixture");
  await assert.rejects(
    inspectOperationsState(sourceRoot, {
      expectedStateMetadata: { adapterId: "other", revision: 1 },
      expectedFiles
    }),
    /adapter state metadata mismatch/
  );
  await assert.rejects(
    inspectOperationsState(sourceRoot, {
      expectedStateMetadata: { adapterId: "fixture", revision: 1 },
      expectedFiles: [{ relativePath: "src/file.txt", created: true }]
    }),
    /adapter state file allowlist mismatch/
  );
});

test("sequential replacements of one path produce one file plan", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha value\n"
  });
  const before = await snapshotTree(sourceRoot);
  const original = Buffer.from("alpha value\n");
  const expected = Buffer.from("charlie value\n");

  const plan = await planOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "alpha",
      replacement: "bravo"
    },
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "bravo",
      replacement: "charlie"
    }
  ]);

  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].relativePath, "src/file.txt");
  assert.deepEqual(plan.files[0].before, original);
  assert.deepEqual(plan.files[0].after, expected);
  assert.equal(plan.files[0].beforeHash, sha256(original));
  assert.equal(plan.files[0].afterHash, sha256(expected));
  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});
