import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  applyOperations,
  inspectOperationsState,
  planOperations,
  revertOperations
} from "./transaction.mjs";

const execFileAsync = promisify(execFile);

const MODULE_PATH = "codex-rs/tui/src/lib.rs";
const STATUS_LINE_PATH =
  "codex-rs/tui/src/bottom_pane/status_line_setup.rs";
const HISTORY_SEPARATOR_PATH =
  "codex-rs/tui/src/history_cell/separators.rs";
const HISTORY_TESTS_PATH = "codex-rs/tui/src/history_cell/tests.rs";
const WORKSPACE_CARGO_PATH = "codex-rs/Cargo.toml";
const TUI_CARGO_PATH = "codex-rs/tui/Cargo.toml";
const CARGO_LOCK_PATH = "codex-rs/Cargo.lock";
const CLI_MAIN_PATH = "codex-rs/cli/src/main.rs";
const I18N_PATH = "codex-rs/tui/src/i18n.rs";
const I18N_TESTS_PATH = "codex-rs/tui/src/i18n_tests.rs";
const SNAPSHOT_FILE_NAMES = Object.freeze([
  "codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_narrow.snap",
  "codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_medium.snap",
  "codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_wide.snap"
]);
const SNAPSHOT_PATHS = SNAPSHOT_FILE_NAMES.map(
  (fileName) => "codex-rs/tui/src/bottom_pane/snapshots/" + fileName
);
const STATE_DIRECTORY = ".codex-ultra-mvp";
const ADAPTER_DIRECTORY_URL = new URL(
  "../../adapters/codex/0.144.1/",
  import.meta.url
);
const DEFAULT_MANIFEST_PATH = fileURLToPath(
  new URL("manifest.json", ADAPTER_DIRECTORY_URL)
);
const DEFAULT_OVERLAY_DIR = fileURLToPath(
  new URL("overlay/", ADAPTER_DIRECTORY_URL)
);
const CODEX_TUI_LOCK_BLOCK_SHA256 =
  "dec3736f9d5fb1b72a09bfc8583c9d265c1a50275e1e4eae4655532bea9b9a9a";
const MANIFEST_KEYS = [
  "catalogVersion",
  "i18nApiVersion",
  "schemaVersion",
  "ultraRevision",
  "upstreamCommit",
  "upstreamTag",
  "upstreamVersion"
];

function validateCodexManifest(manifest, expectedCommit) {
  const valid =
    manifest &&
    typeof manifest === "object" &&
    !Array.isArray(manifest) &&
    JSON.stringify(Object.keys(manifest).sort()) ===
      JSON.stringify(MANIFEST_KEYS) &&
    manifest.schemaVersion === 1 &&
    manifest.upstreamVersion === "0.144.1" &&
    manifest.upstreamTag === "rust-v0.144.1" &&
    /^[a-f0-9]{40}$/.test(manifest.upstreamCommit) &&
    manifest.ultraRevision === 1 &&
    manifest.i18nApiVersion === 1 &&
    manifest.catalogVersion === 1 &&
    (expectedCommit === undefined ||
      manifest.upstreamCommit === expectedCommit);
  if (!valid) {
    throw new Error("invalid Codex adapter manifest");
  }
  return manifest;
}

function parseCodexManifest(content, expectedCommit) {
  try {
    return validateCodexManifest(JSON.parse(content), expectedCommit);
  } catch (error) {
    if (error.message === "invalid Codex adapter manifest") {
      throw error;
    }
    throw new Error("invalid Codex adapter manifest", { cause: error });
  }
}

const DEFAULT_MANIFEST = parseCodexManifest(
  readFileSync(DEFAULT_MANIFEST_PATH, "utf8")
);

export const TARGET_COMMIT = DEFAULT_MANIFEST.upstreamCommit;

export const LOCK_WORKSPACE_PACKAGE_NAMES = Object.freeze([
  "app_test_support",
  "codex-agent-graph-store",
  "codex-agent-identity",
  "codex-analytics",
  "codex-ansi-escape",
  "codex-api",
  "codex-app-server",
  "codex-app-server-client",
  "codex-app-server-daemon",
  "codex-app-server-protocol",
  "codex-app-server-test-client",
  "codex-app-server-transport",
  "codex-apply-patch",
  "codex-arg0",
  "codex-async-utils",
  "codex-aws-auth",
  "codex-backend-client",
  "codex-backend-openapi-models",
  "codex-bwrap",
  "codex-chatgpt",
  "codex-cli",
  "codex-client",
  "codex-cloud-config",
  "codex-cloud-tasks",
  "codex-cloud-tasks-client",
  "codex-cloud-tasks-mock-client",
  "codex-code-mode",
  "codex-code-mode-host",
  "codex-code-mode-protocol",
  "codex-collaboration-mode-templates",
  "codex-config",
  "codex-connectors",
  "codex-connectors-extension",
  "codex-context-fragments",
  "codex-core",
  "codex-core-api",
  "codex-core-plugins",
  "codex-core-skills",
  "codex-exec",
  "codex-exec-server",
  "codex-exec-server-protocol",
  "codex-execpolicy",
  "codex-execpolicy-legacy",
  "codex-experimental-api-macros",
  "codex-extension-api",
  "codex-extension-items",
  "codex-external-agent-migration",
  "codex-external-agent-sessions",
  "codex-features",
  "codex-feedback",
  "codex-file-search",
  "codex-file-system",
  "codex-file-watcher",
  "codex-git-utils",
  "codex-goal-extension",
  "codex-guardian",
  "codex-home",
  "codex-hooks",
  "codex-http-client",
  "codex-image-generation-extension",
  "codex-install-context",
  "codex-keyring-store",
  "codex-linux-sandbox",
  "codex-lmstudio",
  "codex-login",
  "codex-mcp",
  "codex-mcp-extension",
  "codex-mcp-server",
  "codex-memories-extension",
  "codex-memories-read",
  "codex-memories-write",
  "codex-message-history",
  "codex-model-provider",
  "codex-model-provider-info",
  "codex-models-manager",
  "codex-network-proxy",
  "codex-ollama",
  "codex-otel",
  "codex-plugin",
  "codex-process-hardening",
  "codex-prompts",
  "codex-protocol",
  "codex-realtime-webrtc",
  "codex-response-debug-context",
  "codex-responses-api-proxy",
  "codex-rmcp-client",
  "codex-rollout",
  "codex-rollout-trace",
  "codex-sandboxing",
  "codex-secrets",
  "codex-shell-command",
  "codex-shell-escalation",
  "codex-skills",
  "codex-skills-extension",
  "codex-state",
  "codex-stdio-to-uds",
  "codex-terminal-detection",
  "codex-test-binary-support",
  "codex-thread-manager-sample",
  "codex-thread-store",
  "codex-tools",
  "codex-tui",
  "codex-uds",
  "codex-utils-absolute-path",
  "codex-utils-approval-presets",
  "codex-utils-cache",
  "codex-utils-cargo-bin",
  "codex-utils-cli",
  "codex-utils-elapsed",
  "codex-utils-fuzzy-match",
  "codex-utils-home-dir",
  "codex-utils-image",
  "codex-utils-json-to-toml",
  "codex-utils-oss",
  "codex-utils-output-truncation",
  "codex-utils-path",
  "codex-utils-path-uri",
  "codex-utils-plugins",
  "codex-utils-pty",
  "codex-utils-readiness",
  "codex-utils-rustls-provider",
  "codex-utils-sandbox-summary",
  "codex-utils-sleep-inhibitor",
  "codex-utils-stream-parser",
  "codex-utils-string",
  "codex-utils-template",
  "codex-v8-poc",
  "codex-web-search-extension",
  "codex-websocket-client",
  "codex-windows-sandbox",
  "core_test_support",
  "mcp_test_support"
]);

async function loadCodexManifest(manifestPath = DEFAULT_MANIFEST_PATH) {
  return parseCodexManifest(
    await readFile(manifestPath, "utf8"),
    TARGET_COMMIT
  );
}

function codexStateMetadata(manifest) {
  return {
    adapterId: "codex",
    targetCommit: manifest.upstreamCommit,
    ultraRevision: manifest.ultraRevision,
    i18nApiVersion: manifest.i18nApiVersion,
    catalogVersion: manifest.catalogVersion
  };
}

const CODEX_STATE_FILES = [
  { relativePath: MODULE_PATH, created: false },
  { relativePath: STATUS_LINE_PATH, created: false },
  { relativePath: HISTORY_SEPARATOR_PATH, created: false },
  { relativePath: HISTORY_TESTS_PATH, created: false },
  { relativePath: WORKSPACE_CARGO_PATH, created: false },
  { relativePath: TUI_CARGO_PATH, created: false },
  { relativePath: CARGO_LOCK_PATH, created: false },
  { relativePath: CLI_MAIN_PATH, created: false },
  { relativePath: I18N_PATH, created: true },
  { relativePath: I18N_TESTS_PATH, created: true },
  ...SNAPSHOT_PATHS.map((relativePath) => ({
    relativePath,
    created: true
  }))
];

const STATUS_LINE_CONSTRUCTOR_ANCHOR = [
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
  "        }];"
].join("\n");

const STATUS_LINE_CONSTRUCTOR_REPLACEMENT = [
  "    pub(crate) fn new(",
  "        status_line_items: Option<&[String]>,",
  "        use_theme_colors: bool,",
  "        preview_data: StatusSurfacePreviewData,",
  "        app_event_tx: AppEventSender,",
  "        list_keymap: ListKeymap,",
  "    ) -> Self {",
  "        Self::new_with_localizer(",
  "            status_line_items,",
  "            use_theme_colors,",
  "            preview_data,",
  "            app_event_tx,",
  "            list_keymap,",
  "            crate::i18n::global(),",
  "        )",
  "    }",
  "",
  "    fn new_with_localizer(",
  "        status_line_items: Option<&[String]>,",
  "        use_theme_colors: bool,",
  "        preview_data: StatusSurfacePreviewData,",
  "        app_event_tx: AppEventSender,",
  "        list_keymap: ListKeymap,",
  "        localizer: &crate::i18n::Localizer,",
  "    ) -> Self {",
  "        let mut used_ids = HashSet::new();",
  "        let mut items = vec![MultiSelectItem {",
  "            id: STATUS_LINE_USE_THEME_COLORS_ITEM_ID.to_string(),",
  '            name: localizer.text("tui.status-line.setup.use-theme-colors", None, || {',
  '                "Use theme colors".to_string()',
  "            }),",
  "            description: Some(localizer.text(",
  '                "tui.status-line.setup.apply-theme-colors",',
  "                None,",
  '                || "Apply colors from the active /theme".to_string(),',
  "            )),",
  "            enabled: use_theme_colors,",
  "            orderable: false,",
  "            section_break_after: true,",
  "        }];"
].join("\n");

const STATUS_LINE_PICKER_ANCHOR = [
  "            picker: MultiSelectPicker::builder(",
  '                "Configure Status Line".to_string(),',
  '                Some("Select which items to display in the status line.".to_string()),',
  "                app_event_tx,",
  "            )"
].join("\n");

const STATUS_LINE_PICKER_REPLACEMENT = [
  "            picker: MultiSelectPicker::builder(",
  '                localizer.text("tui.status-line.setup.configure-title", None, || {',
  '                    "Configure Status Line".to_string()',
  "                }),",
  "                Some(localizer.text(",
  '                    "tui.status-line.setup.select-items-description",',
  "                    None,",
  '                    || "Select which items to display in the status line.".to_string(),',
  "                )),",
  "                app_event_tx,",
  "            )"
].join("\n");

const STATUS_LINE_SNAPSHOT_TEST_ANCHOR = [
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
  "    }"
].join("\n");

const STATUS_LINE_SNAPSHOT_TEST_REPLACEMENT = [
  STATUS_LINE_SNAPSHOT_TEST_ANCHOR,
  "",
  "    #[test]",
  "    fn setup_view_snapshot_uses_zh_cn_localizer() {",
  "        let localizer = crate::i18n::Localizer::from_ftl(",
  '            "zh-CN",',
  "            concat!(",
  '                "tui--status-line--setup--use-theme-colors = 使用主题颜色\\n",',
  '                "tui--status-line--setup--apply-theme-colors = 应用当前 /theme 的颜色\\n",',
  '                "tui--status-line--setup--configure-title = 配置状态栏\\n",',
  '                "tui--status-line--setup--select-items-description = 选择要显示在状态栏中的项目。\\n",',
  "            ),",
  "        );",
  "        let (tx_raw, _rx) = unbounded_channel::<AppEvent>();",
  "        let view = StatusLineSetupView::new_with_localizer(",
  "            Some(&[",
  "                StatusLineItem::ModelName.to_string(),",
  "                StatusLineItem::CurrentDir.to_string(),",
  "                StatusLineItem::GitBranch.to_string(),",
  "            ]),",
  "            /*use_theme_colors*/ true,",
  "            StatusSurfacePreviewData::default(),",
  "            AppEventSender::new(tx_raw),",
  "            crate::keymap::RuntimeKeymap::defaults().list,",
  "            &localizer,",
  "        );",
  "",
  "        assert_snapshot!(",
  '            "status_line_setup_zh_cn_narrow",',
  "            render_lines(&view, /*width*/ 32)",
  "        );",
  "        assert_snapshot!(",
  '            "status_line_setup_zh_cn_medium",',
  "            render_lines(&view, /*width*/ 72)",
  "        );",
  "        assert_snapshot!(",
  '            "status_line_setup_zh_cn_wide",',
  "            render_lines(&view, /*width*/ 120)",
  "        );",
  "    }"
].join("\n");

const HISTORY_SEPARATOR_ANCHOR = `//! Turn separators and runtime-metrics labels for transcript history.

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
}`;

const HISTORY_SEPARATOR_REPLACEMENT = `//! Turn separators and runtime-metrics labels for transcript history.

use super::*;
use fluent_bundle::FluentArgs;

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

    pub(crate) fn label_parts_with_localizer(
        &self,
        localizer: &crate::i18n::Localizer,
    ) -> Vec<String> {
        let mut label_parts = Vec::new();
        if let Some(elapsed_seconds) = self
            .elapsed_seconds
            .filter(|seconds| *seconds > 60)
            .map(crate::status_indicator_widget::fmt_elapsed_compact)
        {
            let mut args = FluentArgs::new();
            args.set("duration", elapsed_seconds.as_str());
            label_parts.push(localizer.text("tui.history.worked-for", Some(&args), || {
                format!("Worked for {elapsed_seconds}")
            }));
        }
        if let Some(metrics_label) = self.runtime_metrics.and_then(runtime_metrics_label) {
            label_parts.push(metrics_label);
        }
        label_parts
    }
}
impl HistoryCell for FinalMessageSeparator {
    fn display_lines(&self, width: u16) -> Vec<Line<'static>> {
        let label_parts = self.label_parts_with_localizer(crate::i18n::global());

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
        let label_parts = self.label_parts_with_localizer(crate::i18n::global());
        if label_parts.is_empty() {
            Vec::new()
        } else {
            vec![Line::from(label_parts.join(" • "))]
        }
    }
}`;

const WORKED_FOR_TEST_ANCHOR = [
  "#[test]",
  "fn final_message_separator_includes_worked_label_after_one_minute() {",
  "    let cell = FinalMessageSeparator::new(Some(61), /*runtime_metrics*/ None);",
  "    let rendered = render_lines(&cell.display_lines(/*width*/ 200));",
  "",
  "    assert_eq!(rendered.len(), 1);",
  '    assert!(rendered[0].contains("Worked for"));',
  "}"
].join("\n");

const WORKED_FOR_TEST_REPLACEMENT = [
  WORKED_FOR_TEST_ANCHOR,
  "",
  "#[test]",
  "fn worked_for_uses_zh_cn_localizer() {",
  "    let localizer = crate::i18n::Localizer::from_ftl(",
  '        "zh-CN",',
  '        "tui--history--worked-for = 加班了 { $duration }\\n",',
  "    );",
  "    let separator = FinalMessageSeparator::new(Some(477), None);",
  "",
  "    assert_eq!(",
  "        separator.label_parts_with_localizer(&localizer),",
  '        vec!["加班了 7m 57s".to_string()]',
  "    );",
  "}"
].join("\n");

function replace(relativePath, anchor, replacement, label) {
  return {
    type: "replace",
    relativePath,
    anchor,
    replacement,
    label,
    expectedOccurrences: 1,
    preserveLineEndings: true
  };
}

function normalizeLf(source) {
  return source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function codexTuiLockBlock(source) {
  const normalized = normalizeLf(source);
  const marker = '[[package]]\nname = "codex-tui"';
  const start = normalized.indexOf(marker);
  if (
    start === -1 ||
    normalized.indexOf(marker, start + marker.length) !== -1
  ) {
    throw new Error("invalid codex-tui Cargo.lock package block");
  }
  const nextPackage = normalized.indexOf(
    "[[package]]",
    start + marker.length
  );
  return normalized.slice(
    start,
    nextPackage === -1 ? normalized.length : nextPackage
  );
}

async function verifyCargoLockFingerprint(sourceRoot) {
  const source = await readFile(join(sourceRoot, CARGO_LOCK_PATH), "utf8");
  const actual = createHash("sha256")
    .update(codexTuiLockBlock(source), "utf8")
    .digest("hex");
  if (actual !== CODEX_TUI_LOCK_BLOCK_SHA256) {
    throw new Error(
      "unexpected codex-tui Cargo.lock package block sha256 " +
        actual +
        "; expected " +
        CODEX_TUI_LOCK_BLOCK_SHA256
    );
  }
}

function workspaceLockVersionOperation(packageName) {
  const anchor = [
    "[[package]]",
    `name = "${packageName}"`,
    'version = "0.0.0"'
  ].join("\n");
  return replace(
    CARGO_LOCK_PATH,
    anchor,
    anchor.replace('version = "0.0.0"', 'version = "0.144.1"'),
    `Cargo.lock workspace package ${packageName} version`
  );
}

async function loadCodexOperations(overlayDir) {
  const [i18nSource, i18nTestsSource, ...snapshotSources] = await Promise.all([
    readFile(join(overlayDir, "i18n.rs")),
    readFile(join(overlayDir, "i18n_tests.rs")),
    ...SNAPSHOT_FILE_NAMES.map((fileName) =>
      readFile(join(overlayDir, "snapshots", fileName))
    )
  ]);

  return [
    replace(
      MODULE_PATH,
      "mod hooks_rpc;",
      ["mod hooks_rpc;", "mod i18n;"].join("\n"),
      "tui lib module declaration"
    ),
    replace(
      MODULE_PATH,
      "pub use markdown_render::render_markdown_text;",
      [
        "pub use markdown_render::render_markdown_text;",
        "",
        "pub fn ultra_i18n_self_check_json() -> String {",
        "    i18n::self_check_json(i18n::global())",
        "}"
      ].join("\n"),
      "tui self-check export"
    ),
    replace(
      STATUS_LINE_PATH,
      STATUS_LINE_CONSTRUCTOR_ANCHOR,
      STATUS_LINE_CONSTRUCTOR_REPLACEMENT,
      "localized StatusLineSetupView constructor"
    ),
    replace(
      STATUS_LINE_PATH,
      STATUS_LINE_PICKER_ANCHOR,
      STATUS_LINE_PICKER_REPLACEMENT,
      "localized StatusLineSetupView picker"
    ),
    replace(
      STATUS_LINE_PATH,
      STATUS_LINE_SNAPSHOT_TEST_ANCHOR,
      STATUS_LINE_SNAPSHOT_TEST_REPLACEMENT,
      "zh-CN status line snapshots"
    ),
    replace(
      HISTORY_SEPARATOR_PATH,
      HISTORY_SEPARATOR_ANCHOR,
      HISTORY_SEPARATOR_REPLACEMENT,
      "localized final message separator"
    ),
    replace(
      HISTORY_TESTS_PATH,
      WORKED_FOR_TEST_ANCHOR,
      WORKED_FOR_TEST_REPLACEMENT,
      "Worked for zh-CN test"
    ),
    replace(
      WORKSPACE_CARGO_PATH,
      'flate2 = "1.1.8"',
      ['flate2 = "1.1.8"', 'fluent-bundle = "0.15.3"'].join("\n"),
      "workspace fluent-bundle dependency"
    ),
    replace(
      WORKSPACE_CARGO_PATH,
      'uds_windows = "1.1.0"',
      ['uds_windows = "1.1.0"', 'unic-langid = "0.9.6"'].join("\n"),
      "workspace unic-langid dependency"
    ),
    replace(
      TUI_CARGO_PATH,
      "dunce = { workspace = true }",
      [
        "dunce = { workspace = true }",
        "fluent-bundle = { workspace = true }"
      ].join("\n"),
      "codex-tui fluent-bundle dependency"
    ),
    replace(
      TUI_CARGO_PATH,
      'two-face = { version = "0.5", default-features = false, features = ["syntect-default-onig"] }',
      [
        'two-face = { version = "0.5", default-features = false, features = ["syntect-default-onig"] }',
        "unic-langid = { workspace = true }"
      ].join("\n"),
      "codex-tui unic-langid dependency"
    ),
    ...LOCK_WORKSPACE_PACKAGE_NAMES.map(workspaceLockVersionOperation),
    replace(
      CARGO_LOCK_PATH,
      [' "dunce",', ' "image",'].join("\n"),
      [' "dunce",', ' "fluent-bundle",', ' "image",'].join("\n"),
      "Cargo.lock codex-tui fluent-bundle dependency"
    ),
    replace(
      CARGO_LOCK_PATH,
      [' "two-face",', ' "unicode-segmentation",'].join("\n"),
      [' "two-face",', ' "unic-langid",', ' "unicode-segmentation",'].join(
        "\n"
      ),
      "Cargo.lock codex-tui unic-langid dependency"
    ),
    replace(
      CLI_MAIN_PATH,
      [
        "fn main() -> anyhow::Result<()> {",
        "    let remote_control_disabled = codex_app_server::take_remote_control_disabled_env();"
      ].join("\n"),
      [
        "fn main() -> anyhow::Result<()> {",
        "    let args = std::env::args_os().collect::<Vec<_>>();",
        '    if args.len() == 2 && args[1].as_os_str() == std::ffi::OsStr::new("--ultra-i18n-self-check") {',
        '        println!("{}", codex_tui::ultra_i18n_self_check_json());',
        "        return Ok(());",
        "    }",
        "",
        "    let remote_control_disabled = codex_app_server::take_remote_control_disabled_env();"
      ].join("\n"),
      "hidden exact-one i18n self-check"
    ),
    {
      type: "create",
      relativePath: I18N_PATH,
      content: i18nSource
    },
    {
      type: "create",
      relativePath: I18N_TESTS_PATH,
      content: i18nTestsSource
    },
    ...SNAPSHOT_PATHS.map((relativePath, index) => ({
      type: "create",
      relativePath,
      content: snapshotSources[index]
    }))
  ];
}

function gitReadOptions() {
  return {
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  };
}

async function verifyRelease(
  sourceRoot,
  targetCommit,
  execFileImpl = execFileAsync
) {
  const { stdout: headOutput } = await execFileImpl(
    "git",
    ["-C", sourceRoot, "rev-parse", "HEAD"],
    gitReadOptions()
  );
  const head = headOutput.trim();
  if (head !== targetCommit) {
    throw new Error(
      "unsupported Codex source commit " + head + "; expected " + targetCommit
    );
  }
  const { stdout: statusOutput } = await execFileImpl(
    "git",
    ["-C", sourceRoot, "status", "--porcelain"],
    gitReadOptions()
  );
  if (statusOutput.trim()) {
    throw new Error("Codex source worktree must be clean before apply");
  }
}

export async function planCodexPatch(
  sourceRoot,
  {
    verifyGit = true,
    verifyLockFingerprint = verifyGit,
    overlayDir = DEFAULT_OVERLAY_DIR,
    manifestPath = DEFAULT_MANIFEST_PATH,
    execFileImpl = execFileAsync,
    ...options
  } = {}
) {
  const resolvedRoot = resolve(sourceRoot);
  const manifest = await loadCodexManifest(manifestPath);
  if (verifyGit) {
    await verifyRelease(
      resolvedRoot,
      manifest.upstreamCommit,
      execFileImpl
    );
  }
  if (verifyLockFingerprint) {
    await verifyCargoLockFingerprint(resolvedRoot);
  }
  const operations = await loadCodexOperations(overlayDir);
  return planOperations(resolvedRoot, operations, {
    ...options,
    stateDirectory: STATE_DIRECTORY
  });
}

export async function applyCodexPatch(
  sourceRoot,
  {
    verifyGit = true,
    verifyLockFingerprint = verifyGit,
    overlayDir = DEFAULT_OVERLAY_DIR,
    manifestPath = DEFAULT_MANIFEST_PATH,
    execFileImpl = execFileAsync,
    ...options
  } = {}
) {
  const resolvedRoot = resolve(sourceRoot);
  const manifest = await loadCodexManifest(manifestPath);
  if (verifyGit) {
    await verifyRelease(
      resolvedRoot,
      manifest.upstreamCommit,
      execFileImpl
    );
  }
  if (verifyLockFingerprint) {
    await verifyCargoLockFingerprint(resolvedRoot);
  }
  const operations = await loadCodexOperations(overlayDir);
  return applyOperations(resolvedRoot, operations, {
    ...options,
    stateDirectory: STATE_DIRECTORY,
    stateMetadata: codexStateMetadata(manifest)
  });
}

export async function revertCodexPatch(
  sourceRoot,
  { manifestPath = DEFAULT_MANIFEST_PATH, ...options } = {}
) {
  const manifest = await loadCodexManifest(manifestPath);
  return revertOperations(resolve(sourceRoot), {
    ...options,
    stateDirectory: STATE_DIRECTORY,
    expectedStateMetadata: codexStateMetadata(manifest),
    expectedFiles: CODEX_STATE_FILES
  });
}

export async function doctorCodexPatch(
  sourceRoot,
  {
    verifyGit = true,
    manifestPath = DEFAULT_MANIFEST_PATH,
    execFileImpl = execFileAsync,
    ...options
  } = {}
) {
  const resolvedRoot = resolve(sourceRoot);
  const manifest = await loadCodexManifest(manifestPath);
  let sourceCommit = null;
  let supported = null;
  if (verifyGit) {
    const { stdout } = await execFileImpl(
      "git",
      ["-C", resolvedRoot, "rev-parse", "HEAD"],
      gitReadOptions()
    );
    sourceCommit = stdout.trim();
    supported = sourceCommit === manifest.upstreamCommit;
  }
  const inspected = await inspectOperationsState(resolvedRoot, {
    ...options,
    stateDirectory: STATE_DIRECTORY,
    expectedStateMetadata: codexStateMetadata(manifest),
    expectedFiles: CODEX_STATE_FILES
  });
  return {
    targetCommit: manifest.upstreamCommit,
    sourceCommit,
    supported,
    applied: inspected?.status === "fully-applied"
  };
}
