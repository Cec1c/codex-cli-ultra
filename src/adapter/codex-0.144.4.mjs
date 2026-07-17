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
const SLASH_COMMAND_PATH = "codex-rs/tui/src/slash_command.rs";
const SLASH_DISPATCH_PATH = "codex-rs/tui/src/chatwidget/slash_dispatch.rs";
const COMMAND_POPUP_PATH = "codex-rs/tui/src/bottom_pane/command_popup.rs";
const ONBOARDING_AUTH_PATH = "codex-rs/tui/src/onboarding/auth.rs";
const STATUS_CARD_PATH = "codex-rs/tui/src/status/card.rs";
const STATUS_FORMAT_PATH = "codex-rs/tui/src/status/format.rs";
const APPROVAL_OVERLAY_PATH =
  "codex-rs/tui/src/bottom_pane/approval_overlay.rs";
const SESSION_HEADER_PATH = "codex-rs/tui/src/history_cell/session.rs";
const TOOLTIPS_PATH = "codex-rs/tui/src/tooltips.rs";
const CHATWIDGET_PATH = "codex-rs/tui/src/chatwidget.rs";
const CHATWIDGET_CONSTRUCTOR_PATH = "codex-rs/tui/src/chatwidget/constructor.rs";
const MCP_STARTUP_PATH = "codex-rs/tui/src/chatwidget/mcp_startup.rs";
const STATUS_SURFACES_PATH = "codex-rs/tui/src/chatwidget/status_surfaces.rs";
const FOOTER_PATH = "codex-rs/tui/src/bottom_pane/footer.rs";
const CHAT_COMPOSER_PATH = "codex-rs/tui/src/bottom_pane/chat_composer.rs";
const COMMAND_POPUP_SNAPSHOT_PATH =
  "codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__command_popup__tests__command_popup_default_items.snap";
const SLASH_DESCRIPTION_METADATA = [
  ["SlashCommand::Feedback", "tui.slash-command.description.feedback", "slash-feedback-description"],
  ["SlashCommand::New", "tui.slash-command.description.new", "slash-new-description"],
  ["SlashCommand::Init", "tui.slash-command.description.init", "slash-init-description"],
  ["SlashCommand::Compact", "tui.slash-command.description.compact", "slash-compact-description"],
  ["SlashCommand::Review", "tui.slash-command.description.review", "slash-review-description"],
  ["SlashCommand::Rename", "tui.slash-command.description.rename", "slash-rename-description"],
  ["SlashCommand::Resume", "tui.slash-command.description.resume", "slash-resume-description"],
  ["SlashCommand::Archive", "tui.slash-command.description.archive", "slash-archive-description"],
  ["SlashCommand::Delete", "tui.slash-command.description.delete", "slash-delete-description"],
  ["SlashCommand::Clear", "tui.slash-command.description.clear", "slash-clear-description"],
  ["SlashCommand::Fork", "tui.slash-command.description.fork", "slash-fork-description"],
  ["SlashCommand::App", "tui.slash-command.description.app", "slash-app-description"],
  ["SlashCommand::Quit | SlashCommand::Exit", "tui.slash-command.description.exit", "slash-exit-description"],
  ["SlashCommand::Copy", "tui.slash-command.description.copy", "slash-copy-description"],
  ["SlashCommand::Raw", "tui.slash-command.description.raw", "slash-raw-description"],
  ["SlashCommand::Diff", "tui.slash-command.description.diff", "slash-diff-description"],
  ["SlashCommand::Mention", "tui.slash-command.description.mention", "slash-mention-description"],
  ["SlashCommand::Skills", "tui.slash-command.description.skills", "slash-skills-description"],
  ["SlashCommand::Import", "tui.slash-command.description.import", "slash-import-description"],
  ["SlashCommand::Hooks", "tui.slash-command.description.hooks", "slash-hooks-description"],
  ["SlashCommand::Status", "tui.slash-command.description.status", "slash-status-description"],
  ["SlashCommand::Usage", "tui.slash-command.description.usage", "slash-usage-description"],
  ["SlashCommand::DebugConfig", "tui.slash-command.description.debug-config", "slash-debug-config-description"],
  ["SlashCommand::Title", "tui.slash-command.description.title", "slash-title-description"],
  ["SlashCommand::Statusline", "tui.slash-command.description.statusline", "slash-statusline-description"],
  ["SlashCommand::Theme", "tui.slash-command.description.theme", "slash-theme-description"],
  ["SlashCommand::Language", "tui.slash-command.description.language", "slash-language-description"],
  ["SlashCommand::Pets", "tui.slash-command.description.pets", "slash-pets-description"],
  ["SlashCommand::Ps", "tui.slash-command.description.ps", "slash-ps-description"],
  ["SlashCommand::Stop", "tui.slash-command.description.stop", "slash-stop-description"],
  ["SlashCommand::MemoryDrop | SlashCommand::MemoryUpdate", "tui.slash-command.description.internal-debug", "slash-internal-debug-description"],
  ["SlashCommand::Model", "tui.slash-command.description.model", "slash-model-description"],
  ["SlashCommand::Ide", "tui.slash-command.description.ide", "slash-ide-description"],
  ["SlashCommand::Personality", "tui.slash-command.description.personality", "slash-personality-description"],
  ["SlashCommand::Plan", "tui.slash-command.description.plan", "slash-plan-description"],
  ["SlashCommand::Goal", "tui.slash-command.description.goal", "slash-goal-description"],
  ["SlashCommand::Agent | SlashCommand::MultiAgents", "tui.slash-command.description.agent", "slash-agent-description"],
  ["SlashCommand::Side | SlashCommand::Btw", "tui.slash-command.description.side", "slash-side-description"],
  ["SlashCommand::Permissions", "tui.slash-command.description.permissions", "slash-permissions-description"],
  ["SlashCommand::Keymap", "tui.slash-command.description.keymap", "slash-keymap-description"],
  ["SlashCommand::Vim", "tui.slash-command.description.vim", "slash-vim-description"],
  ["SlashCommand::ElevateSandbox", "tui.slash-command.description.elevate-sandbox", "slash-elevate-sandbox-description"],
  ["SlashCommand::SandboxReadRoot", "tui.slash-command.description.sandbox-read-root", "slash-sandbox-read-root-description"],
  ["SlashCommand::Experimental", "tui.slash-command.description.experimental", "slash-experimental-description"],
  ["SlashCommand::AutoReview", "tui.slash-command.description.approve", "slash-approve-description"],
  ["SlashCommand::Memories", "tui.slash-command.description.memories", "slash-memories-description"],
  ["SlashCommand::Mcp", "tui.slash-command.description.mcp", "slash-mcp-description"],
  ["SlashCommand::Apps", "tui.slash-command.description.apps", "slash-apps-description"],
  ["SlashCommand::Plugins", "tui.slash-command.description.plugins", "slash-plugins-description"],
  ["SlashCommand::Logout", "tui.slash-command.description.logout", "slash-logout-description"],
  ["SlashCommand::Rollout", "tui.slash-command.description.rollout", "slash-rollout-description"],
  ["SlashCommand::TestApproval", "tui.slash-command.description.test-approval", "slash-test-approval-description"]
];
const RUSTFMT_MULTILINE_SLASH_PATTERNS = new Set([
  "SlashCommand::Init",
  "SlashCommand::Fork",
  "SlashCommand::Copy",
  "SlashCommand::Diff",
  "SlashCommand::Pets",
  "SlashCommand::Stop",
  "SlashCommand::Plan",
  "SlashCommand::Goal",
  "SlashCommand::Apps"
]);
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
  "../../adapters/codex/0.144.4/",
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
    manifest.upstreamVersion === "0.144.4" &&
    manifest.upstreamTag === "rust-v0.144.4" &&
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
  { relativePath: STATUS_FORMAT_PATH, created: false },
  { relativePath: STATUS_CARD_PATH, created: false },
  { relativePath: SESSION_HEADER_PATH, created: false },
  { relativePath: TOOLTIPS_PATH, created: false },
  { relativePath: CHATWIDGET_PATH, created: false },
  { relativePath: CHATWIDGET_CONSTRUCTOR_PATH, created: false },
  { relativePath: MCP_STARTUP_PATH, created: false },
  { relativePath: STATUS_SURFACES_PATH, created: false },
  { relativePath: FOOTER_PATH, created: false },
  { relativePath: HISTORY_SEPARATOR_PATH, created: false },
  { relativePath: HISTORY_TESTS_PATH, created: false },
  { relativePath: SLASH_COMMAND_PATH, created: false },
  { relativePath: SLASH_DISPATCH_PATH, created: false },
  { relativePath: CHAT_COMPOSER_PATH, created: false },
  { relativePath: COMMAND_POPUP_PATH, created: false },
  { relativePath: APPROVAL_OVERLAY_PATH, created: false },
  { relativePath: ONBOARDING_AUTH_PATH, created: false },
  { relativePath: COMMAND_POPUP_SNAPSHOT_PATH, created: false },
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
  '            name: localizer.text("status-line-use-theme-colors", None, || {',
  '                "Use theme colors".to_string()',
  "            }),",
  '            description: Some(localizer.text("status-line-apply-theme-colors", None, || {',
  '                "Apply colors from the active /theme".to_string()',
  "            })),",
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
  '                localizer.text("status-line-configure-title", None, || {',
  '                    "Configure Status Line".to_string()',
  "                }),",
  "                Some(",
  '                    localizer.text("status-line-select-items-description", None, || {',
  '                        "Select which items to display in the status line.".to_string()',
  "                    }),",
  "                ),",
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
  '                "status-line-use-theme-colors = 使用主题颜色\\n",',
  '                "status-line-apply-theme-colors = 应用当前 /theme 的颜色\\n",',
  '                "status-line-configure-title = 配置状态栏\\n",',
  '                "status-line-select-items-description = 选择要显示在状态栏中的项目。\\n",',
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
            label_parts.push(localizer.text("history-worked-for", Some(&args), || {
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
  "    let localizer =",
  '        crate::i18n::Localizer::from_ftl("zh-CN", "history-worked-for = 工作了 { $duration }\\n");',
  "    let separator = FinalMessageSeparator::new(Some(477), None);",
  "",
  "    assert_eq!(",
  "        separator.label_parts_with_localizer(&localizer),",
  '        vec!["工作了 7m 57s".to_string()]',
  "    );",
  "}"
].join("\n");

const STATUS_RATE_LIMIT_LINES_ANCHOR = `    fn rate_limit_lines(
        &self,
        state: &StatusRateLimitState,
        available_inner_width: usize,
        formatter: &FieldFormatter,
    ) -> Vec<Line<'static>> {
        match &state.rate_limits {
            StatusRateLimitData::Available(rows_data) => {
                if rows_data.is_empty() {
                    return vec![formatter.line(
                        "Limits",
                        vec![Span::from("not available for this account").dim()],
                    )];
                }

                self.rate_limit_row_lines(rows_data, available_inner_width, formatter)
            }
            StatusRateLimitData::Stale(rows_data) => {
                let mut lines =
                    self.rate_limit_row_lines(rows_data, available_inner_width, formatter);
                lines.push(formatter.line(
                    "Warning",
                    vec![Span::from(if state.refreshing_rate_limits {
                        "limits may be stale - run /status again shortly."
                    } else {
                        "limits may be stale - start new turn to refresh."
                    })
                    .dim()],
                ));
                lines
            }
            StatusRateLimitData::Unavailable => {
                vec![formatter.line(
                    "Limits",
                    vec![Span::from("not available for this account").dim()],
                )]
            }
            StatusRateLimitData::Missing => {
                vec![formatter.line(
                    "Limits",
                    vec![Span::from(if state.refreshing_rate_limits {
                        "refresh requested; run /status again shortly."
                    } else {
                        "data not available yet"
                    })
                    .dim()],
                )]
            }
        }
    }`;

const STATUS_RATE_LIMIT_LINES_REPLACEMENT = `    fn rate_limit_lines(
        &self,
        state: &StatusRateLimitState,
        available_inner_width: usize,
        formatter: &FieldFormatter,
    ) -> Vec<Line<'static>> {
        let limits_label = status_text("status-card-limits-label", "Limits");
        let warning_label = status_text("status-card-warning-label", "Warning");
        match &state.rate_limits {
            StatusRateLimitData::Available(rows_data) => {
                if rows_data.is_empty() {
                    return vec![formatter.line(
                        &limits_label,
                        vec![Span::from(status_text(
                            "status-card-limits-unavailable",
                            "not available for this account",
                        ))
                        .dim()],
                    )];
                }

                self.rate_limit_row_lines(rows_data, available_inner_width, formatter)
            }
            StatusRateLimitData::Stale(rows_data) => {
                let mut lines =
                    self.rate_limit_row_lines(rows_data, available_inner_width, formatter);
                let warning = if state.refreshing_rate_limits {
                    status_text(
                        "status-card-limits-stale-run-status",
                        "limits may be stale - run /status again shortly.",
                    )
                } else {
                    status_text(
                        "status-card-limits-stale-new-turn",
                        "limits may be stale - start new turn to refresh.",
                    )
                };
                lines.push(formatter.line(&warning_label, vec![Span::from(warning).dim()]));
                lines
            }
            StatusRateLimitData::Unavailable => {
                vec![formatter.line(
                    &limits_label,
                    vec![Span::from(status_text(
                        "status-card-limits-unavailable",
                        "not available for this account",
                    ))
                    .dim()],
                )]
            }
            StatusRateLimitData::Missing => {
                let message = if state.refreshing_rate_limits {
                    status_text(
                        "status-card-limits-refresh-requested",
                        "refresh requested; run /status again shortly.",
                    )
                } else {
                    status_text("status-card-limits-data-pending", "data not available yet")
                };
                vec![formatter.line(&limits_label, vec![Span::from(message).dim()])]
            }
        }
    }`;

const STATUS_COLLECT_RATE_LIMIT_LABELS_ANCHOR = `    fn collect_rate_limit_labels(
        &self,
        state: &StatusRateLimitState,
        seen: &mut BTreeSet<String>,
        labels: &mut Vec<String>,
    ) {
        match &state.rate_limits {
            StatusRateLimitData::Available(rows) => {
                if rows.is_empty() {
                    push_label(labels, seen, "Limits");
                } else {
                    for row in rows {
                        push_label(labels, seen, row.label.as_str());
                    }
                }
            }
            StatusRateLimitData::Stale(rows) => {
                for row in rows {
                    push_label(labels, seen, row.label.as_str());
                }
                push_label(labels, seen, "Warning");
            }
            StatusRateLimitData::Unavailable => push_label(labels, seen, "Limits"),
            StatusRateLimitData::Missing => push_label(labels, seen, "Limits"),
        }
    }
}

fn status_permission_summary(`;

const STATUS_COLLECT_RATE_LIMIT_LABELS_REPLACEMENT = `    fn collect_rate_limit_labels(
        &self,
        state: &StatusRateLimitState,
        seen: &mut BTreeSet<String>,
        labels: &mut Vec<String>,
    ) {
        let limits_label = status_text("status-card-limits-label", "Limits");
        let warning_label = status_text("status-card-warning-label", "Warning");
        match &state.rate_limits {
            StatusRateLimitData::Available(rows) => {
                if rows.is_empty() {
                    push_label(labels, seen, &limits_label);
                } else {
                    for row in rows {
                        push_label(labels, seen, row.label.as_str());
                    }
                }
            }
            StatusRateLimitData::Stale(rows) => {
                for row in rows {
                    push_label(labels, seen, row.label.as_str());
                }
                push_label(labels, seen, &warning_label);
            }
            StatusRateLimitData::Unavailable => push_label(labels, seen, &limits_label),
            StatusRateLimitData::Missing => push_label(labels, seen, &limits_label),
        }
    }
}

fn status_text(key: &str, english: &str) -> String {
    crate::i18n::global().text(key, None, || english.to_string())
}

fn status_permission_summary(`;

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
    anchor.replace('version = "0.0.0"', 'version = "0.144.4"'),
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
      STATUS_FORMAT_PATH,
      [
        "    pub(crate) fn line(",
        "        &self,",
        "        label: &'static str,",
        "        value_spans: Vec<Span<'static>>,",
        "    ) -> Line<'static> {"
      ].join("\n"),
      "    pub(crate) fn line(&self, label: &str, value_spans: Vec<Span<'static>>) -> Line<'static> {",
      "status formatter accepts localized labels"
    ),
    replace(
      STATUS_CARD_PATH,
      STATUS_RATE_LIMIT_LINES_ANCHOR,
      STATUS_RATE_LIMIT_LINES_REPLACEMENT,
      "localized status rate-limit messages"
    ),
    replace(
      STATUS_CARD_PATH,
      STATUS_COLLECT_RATE_LIMIT_LABELS_ANCHOR,
      STATUS_COLLECT_RATE_LIMIT_LABELS_REPLACEMENT,
      "localized status rate-limit label sizing"
    ),
    replace(
      STATUS_CARD_PATH,
      [
        "        if available_inner_width == 0 {",
        "            return Vec::new();",
        "        }",
        "",
        "        let account_value = self.account.as_ref().map(|account| match account {"
      ].join("\n"),
      [
        "        if available_inner_width == 0 {",
        "            return Vec::new();",
        "        }",
        "",
        '        let model_label = status_text("status-card-model-label", "Model");',
        '        let directory_label = status_text("status-card-directory-label", "Directory");',
        '        let permissions_label = status_text("status-card-permissions-label", "Permissions");',
        '        let agents_label = status_text("status-card-agents-label", "Agents.md");',
        "        let model_provider_label =",
        '            status_text("status-card-model-provider-label", "Model provider");',
        '        let account_label = status_text("status-card-account-label", "Account");',
        '        let thread_name_label = status_text("status-card-thread-name-label", "Thread name");',
        '        let session_label = status_text("status-card-session-label", "Session");',
        '        let forked_from_label = status_text("status-card-forked-from-label", "Forked from");',
        "        let collaboration_mode_label =",
        '            status_text("status-card-collaboration-mode-label", "Collaboration mode");',
        '        let token_usage_label = status_text("status-card-token-usage-label", "Token usage");',
        "        let context_window_label =",
        '            status_text("status-card-context-window-label", "Context window");',
        '        let remote_label = status_text("status-card-remote-label", "Remote");',
        "",
        "        let account_value = self.account.as_ref().map(|account| match account {"
      ].join("\n"),
      "localized status labels"
    ),
    replace(
      STATUS_CARD_PATH,
      [
        "            StatusAccountDisplay::ApiKey => {",
        '                "API key configured (run codex login to use ChatGPT)".to_string()',
        "            }"
      ].join("\n"),
      [
        "            StatusAccountDisplay::ApiKey => status_text(",
        '                "status-card-api-key-configured",',
        '                "API key configured (run codex login to use ChatGPT)",',
        "            ),"
      ].join("\n"),
      "localized status API key account text"
    ),
    replace(
      STATUS_CARD_PATH,
      [
        '        let mut labels: Vec<String> = vec!["Model", "Directory", "Permissions", "Agents.md"]',
        "            .into_iter()",
        "            .map(str::to_string)",
        "            .collect();"
      ].join("\n"),
      [
        "        let mut labels: Vec<String> = vec![",
        "            model_label.clone(),",
        "            directory_label.clone(),",
        "            permissions_label.clone(),",
        "            agents_label.clone(),",
        "        ];"
      ].join("\n"),
      "localized status base label sizing"
    ),
    replace(
      STATUS_CARD_PATH,
      [
        "        if self.model_provider.is_some() {",
        '            push_label(&mut labels, &mut seen, "Model provider");',
        "        }",
        "        if account_value.is_some() {",
        '            push_label(&mut labels, &mut seen, "Account");',
        "        }",
        "        if thread_name.is_some() {",
        '            push_label(&mut labels, &mut seen, "Thread name");',
        "        }",
        "        if self.session_id.is_some() {",
        '            push_label(&mut labels, &mut seen, "Session");',
        "        }",
        "        if self.session_id.is_some() && self.forked_from.is_some() {",
        '            push_label(&mut labels, &mut seen, "Forked from");',
        "        }",
        "        if self.collaboration_mode.is_some() {",
        '            push_label(&mut labels, &mut seen, "Collaboration mode");',
        "        }",
        '        push_label(&mut labels, &mut seen, "Token usage");',
        "        if self.token_usage.context_window.is_some() {",
        '            push_label(&mut labels, &mut seen, "Context window");',
        "        }"
      ].join("\n"),
      [
        "        if self.model_provider.is_some() {",
        "            push_label(&mut labels, &mut seen, &model_provider_label);",
        "        }",
        "        if account_value.is_some() {",
        "            push_label(&mut labels, &mut seen, &account_label);",
        "        }",
        "        if thread_name.is_some() {",
        "            push_label(&mut labels, &mut seen, &thread_name_label);",
        "        }",
        "        if self.session_id.is_some() {",
        "            push_label(&mut labels, &mut seen, &session_label);",
        "        }",
        "        if self.session_id.is_some() && self.forked_from.is_some() {",
        "            push_label(&mut labels, &mut seen, &forked_from_label);",
        "        }",
        "        if self.collaboration_mode.is_some() {",
        "            push_label(&mut labels, &mut seen, &collaboration_mode_label);",
        "        }",
        "        push_label(&mut labels, &mut seen, &token_usage_label);",
        "        if self.token_usage.context_window.is_some() {",
        "            push_label(&mut labels, &mut seen, &context_window_label);",
        "        }"
      ].join("\n"),
      "localized status optional label sizing"
    ),
    replace(
      STATUS_CARD_PATH,
      '                lines.push(formatter.line("Remote", first.spans));',
      "                lines.push(formatter.line(&remote_label, first.spans));",
      "localized status remote label"
    ),
    replace(
      STATUS_CARD_PATH,
      [
        '        lines.push(formatter.line("Model", model_spans));',
        "        if let Some(model_provider) = self.model_provider.as_ref() {",
        '            lines.push(formatter.line("Model provider", vec![Span::from(model_provider.clone())]));',
        "        }",
        '        lines.push(formatter.line("Directory", vec![Span::from(directory_value)]));',
        '        lines.push(formatter.line("Permissions", vec![Span::from(self.permissions.clone())]));',
        '        lines.push(formatter.line("Agents.md", vec![Span::from(agents_summary)]));',
        "",
        "        if let Some(account_value) = account_value {",
        '            lines.push(formatter.line("Account", vec![Span::from(account_value)]));',
        "        }",
        "",
        "        if let Some(thread_name) = thread_name {",
        '            lines.push(formatter.line("Thread name", vec![Span::from(thread_name.to_string())]));',
        "        }",
        "        if let Some(collab_mode) = self.collaboration_mode.as_ref() {",
        '            lines.push(formatter.line("Collaboration mode", vec![Span::from(collab_mode.clone())]));',
        "        }",
        "        if let Some(session) = self.session_id.as_ref() {",
        '            lines.push(formatter.line("Session", vec![Span::from(session.clone())]));',
        "        }",
        "        if self.session_id.is_some()",
        "            && let Some(forked_from) = self.forked_from.as_ref()",
        "        {",
        '            lines.push(formatter.line("Forked from", vec![Span::from(forked_from.clone())]));',
        "        }",
        "",
        "        lines.push(Line::from(Vec::<Span<'static>>::new()));",
        "        // Hide token usage only for ChatGPT subscribers",
        "        if !matches!(self.account, Some(StatusAccountDisplay::ChatGpt { .. })) {",
        '            lines.push(formatter.line("Token usage", self.token_usage_spans()));',
        "        }",
        "",
        "        if let Some(spans) = self.context_window_spans() {",
        '            lines.push(formatter.line("Context window", spans));',
        "        }"
      ].join("\n"),
      [
        "        lines.push(formatter.line(&model_label, model_spans));",
        "        if let Some(model_provider) = self.model_provider.as_ref() {",
        "            lines.push(formatter.line(",
        "                &model_provider_label,",
        "                vec![Span::from(model_provider.clone())],",
        "            ));",
        "        }",
        "        lines.push(formatter.line(&directory_label, vec![Span::from(directory_value)]));",
        "        lines.push(formatter.line(",
        "            &permissions_label,",
        "            vec![Span::from(self.permissions.clone())],",
        "        ));",
        "        lines.push(formatter.line(&agents_label, vec![Span::from(agents_summary)]));",
        "",
        "        if let Some(account_value) = account_value {",
        "            lines.push(formatter.line(&account_label, vec![Span::from(account_value)]));",
        "        }",
        "",
        "        if let Some(thread_name) = thread_name {",
        "            lines.push(formatter.line(",
        "                &thread_name_label,",
        "                vec![Span::from(thread_name.to_string())],",
        "            ));",
        "        }",
        "        if let Some(collab_mode) = self.collaboration_mode.as_ref() {",
        "            lines.push(formatter.line(",
        "                &collaboration_mode_label,",
        "                vec![Span::from(collab_mode.clone())],",
        "            ));",
        "        }",
        "        if let Some(session) = self.session_id.as_ref() {",
        "            lines.push(formatter.line(&session_label, vec![Span::from(session.clone())]));",
        "        }",
        "        if self.session_id.is_some()",
        "            && let Some(forked_from) = self.forked_from.as_ref()",
        "        {",
        "            lines.push(formatter.line(&forked_from_label, vec![Span::from(forked_from.clone())]));",
        "        }",
        "",
        "        lines.push(Line::from(Vec::<Span<'static>>::new()));",
        "        // Hide token usage only for ChatGPT subscribers",
        "        if !matches!(self.account, Some(StatusAccountDisplay::ChatGpt { .. })) {",
        "            lines.push(formatter.line(&token_usage_label, self.token_usage_spans()));",
        "        }",
        "",
        "        if let Some(spans) = self.context_window_spans() {",
        "            lines.push(formatter.line(&context_window_label, spans));",
        "        }"
      ].join("\n"),
      "localized status card rows"
    ),
    replace(
      STATUS_CARD_PATH,
      [
        "        let note_first_line = Line::from(vec![",
        '            Span::from("Visit ").cyan(),',
        "            CHATGPT_USAGE_URL.cyan().underlined(),",
        '            Span::from(" for up-to-date").cyan(),',
        "        ]);",
        "        let note_second_line = Line::from(vec![",
        '            Span::from("information on rate limits and credits").cyan(),',
        "        ]);",
        "        let note_lines = adaptive_wrap_lines(",
        "            [note_first_line, note_second_line],",
        "            RtOptions::new(available_inner_width),",
        "        );"
      ].join("\n"),
      [
        "        let usage_note = crate::i18n::global().text_with_string_arg(",
        '            "status-card-usage-note",',
        '            "url",',
        "            CHATGPT_USAGE_URL,",
        "            || {",
        "                format!(",
        '                    "Visit {CHATGPT_USAGE_URL} for up-to-date information on rate limits and credits"',
        "                )",
        "            },",
        "        );",
        "        let note_line = if let Some((before, after)) = usage_note.split_once(CHATGPT_USAGE_URL) {",
        "            Line::from(vec![",
        "                Span::from(before.to_string()).cyan(),",
        "                CHATGPT_USAGE_URL.cyan().underlined(),",
        "                Span::from(after.to_string()).cyan(),",
        "            ])",
        "        } else {",
        "            Line::from(usage_note.cyan())",
        "        };",
        "        let note_lines = adaptive_wrap_lines([note_line], RtOptions::new(available_inner_width));"
      ].join("\n"),
      "localized status usage note"
    ),
    replace(
      SESSION_HEADER_PATH,
      [
        "        let mut lines: Vec<Line<'static>> = Vec::new();",
        "        append_markdown(",
        '            &format!("**Tip:** {}", self.tip),',
        "            Some(wrap_width),",
        "            Some(self.cwd.as_path()),",
        "            &mut lines,",
        "        );"
      ].join("\n"),
      [
        "        let mut lines: Vec<Line<'static>> = Vec::new();",
        '        let label = crate::i18n::global().text("tooltip-label", None, || "Tip:".to_string());',
        "        append_markdown(",
        '            &format!("**{label}** {}", self.tip),',
        "            Some(wrap_width),",
        "            Some(self.cwd.as_path()),",
        "            &mut lines,",
        "        );"
      ].join("\n"),
      "localized tooltip label"
    ),
    replace(
      SESSION_HEADER_PATH,
      '        vec![Line::from(format!("Tip: {}", self.tip))]',
      [
        '        let label = crate::i18n::global().text("tooltip-label", None, || "Tip:".to_string());',
        '        vec![Line::from(format!("{label} {}", self.tip))]'
      ].join("\n"),
      "localized raw tooltip label"
    ),
    replace(
      SESSION_HEADER_PATH,
      [
        '        const CHANGE_MODEL_HINT_COMMAND: &str = "/model";',
        '        const CHANGE_MODEL_HINT_EXPLANATION: &str = " to change";',
        '        const DIR_LABEL: &str = "directory:";',
        '        const PERMISSIONS_LABEL: &str = "permissions:";',
        "        let label_width = if self.yolo_mode {",
        "            DIR_LABEL.len().max(PERMISSIONS_LABEL.len())",
        "        } else {",
        "            DIR_LABEL.len()",
        "        };",
        "",
        "        let model_label = format!(",
        '            "{model_label:<label_width$}",',
        '            model_label = "model:",',
        "            label_width = label_width",
        "        );"
      ].join("\n"),
      [
        '        const CHANGE_MODEL_HINT_COMMAND: &str = "/model";',
        "        let localizer = crate::i18n::global();",
        '        let model_label = localizer.text("session-card-model-label", None, || "model:".to_string());',
        '        let dir_label = localizer.text("session-card-directory-label", None, || {',
        '            "directory:".to_string()',
        "        });",
        '        let permissions_label = localizer.text("session-card-permissions-label", None, || {',
        '            "permissions:".to_string()',
        "        });",
        '        let change_model_hint = localizer.text("session-card-change-model-hint", None, || {',
        '            "to change".to_string()',
        "        });",
        "        let label_width = [",
        "            UnicodeWidthStr::width(model_label.as_str()),",
        "            UnicodeWidthStr::width(dir_label.as_str()),",
        "            UnicodeWidthStr::width(permissions_label.as_str()),",
        "        ]",
        "        .into_iter()",
        "        .max()",
        "        .unwrap_or(0);",
        "        let pad_label = |label: &str| {",
        "            let padding = label_width.saturating_sub(UnicodeWidthStr::width(label));",
        '            format!("{label}{}", " ".repeat(padding))',
        "        };",
        "",
        "        let model_label = pad_label(&model_label);"
      ].join("\n"),
      "localized session header labels"
    ),
    replace(
      SESSION_HEADER_PATH,
      [
        '            spans.push("   ".dim());',
        "            spans.push(CHANGE_MODEL_HINT_COMMAND.cyan());",
        "            spans.push(CHANGE_MODEL_HINT_EXPLANATION.dim());"
      ].join("\n"),
      [
        '            spans.push("   ".dim());',
        "            spans.push(CHANGE_MODEL_HINT_COMMAND.cyan());",
        '            spans.push(" ".dim());',
        "            spans.push(change_model_hint.clone().dim());"
      ].join("\n"),
      "localized session model change hint"
    ),
    replace(
      SESSION_HEADER_PATH,
      [
        '        let dir_label = format!("{DIR_LABEL:<label_width$}");',
        '        let dir_prefix = format!("{dir_label} ");'
      ].join("\n"),
      [
        "        let dir_label = pad_label(&dir_label);",
        '        let dir_prefix = format!("{dir_label} ");'
      ].join("\n"),
      "localized session directory label"
    ),
    replace(
      SESSION_HEADER_PATH,
      '            let permissions_label = format!("{PERMISSIONS_LABEL:<label_width$}");',
      "            let permissions_label = pad_label(&permissions_label);",
      "localized session permissions label"
    ),
    replace(
      SESSION_HEADER_PATH,
      [
        "    fn raw_lines(&self) -> Vec<Line<'static>> {",
        "        let mut lines = vec![",
        '            Line::from(format!("OpenAI Codex (v{})", self.version)),',
        "            Line::from(format!(",
        '                "model: {}{}",',
        "                self.model,",
        "                self.reasoning_label()",
        '                    .map(|reasoning| format!(" {reasoning}"))',
        "                    .unwrap_or_default()",
        "            )),",
        "            Line::from(format!(",
        '                "directory: {}",',
        "                self.format_directory(/*max_width*/ None)",
        "            )),",
        "        ];",
        "        if self.yolo_mode {",
        '            lines.push(Line::from("permissions: YOLO mode"));',
        "        }"
      ].join("\n"),
      [
        "    fn raw_lines(&self) -> Vec<Line<'static>> {",
        "        let localizer = crate::i18n::global();",
        '        let model_label = localizer.text("session-card-model-label", None, || "model:".to_string());',
        '        let dir_label = localizer.text("session-card-directory-label", None, || {',
        '            "directory:".to_string()',
        "        });",
        '        let permissions_label = localizer.text("session-card-permissions-label", None, || {',
        '            "permissions:".to_string()',
        "        });",
        "        let mut lines = vec![",
        '            Line::from(format!("OpenAI Codex (v{})", self.version)),',
        "            Line::from(format!(",
        '                "{model_label} {}{}",',
        "                self.model,",
        "                self.reasoning_label()",
        '                    .map(|reasoning| format!(" {reasoning}"))',
        "                    .unwrap_or_default()",
        "            )),",
        "            Line::from(format!(",
        '                "{dir_label} {}",',
        "                self.format_directory(/*max_width*/ None)",
        "            )),",
        "        ];",
        "        if self.yolo_mode {",
        '            lines.push(Line::from(format!("{permissions_label} YOLO mode")));',
        "        }"
      ].join("\n"),
      "localized raw session header"
    ),
    replace(
      TOOLTIPS_PATH,
      "    pick_tooltip(&mut rng).map(str::to_string)",
      "    pick_tooltip(&mut rng).map(localize_tooltip)",
      "localized random startup tooltip"
    ),
    replace(
      TOOLTIPS_PATH,
      [
        "fn pick_tooltip<R: Rng + ?Sized>(rng: &mut R) -> Option<&'static str> {",
        "    if ALL_TOOLTIPS.is_empty() {",
        "        None",
        "    } else {",
        "        ALL_TOOLTIPS",
        "            .get(rng.random_range(0..ALL_TOOLTIPS.len()))",
        "            .copied()",
        "    }",
        "}"
      ].join("\n"),
      [
        "fn pick_tooltip<R: Rng + ?Sized>(rng: &mut R) -> Option<&'static str> {",
        "    if ALL_TOOLTIPS.is_empty() {",
        "        None",
        "    } else {",
        "        ALL_TOOLTIPS",
        "            .get(rng.random_range(0..ALL_TOOLTIPS.len()))",
        "            .copied()",
        "    }",
        "}",
        "",
        "fn localize_tooltip(tip: &str) -> String {",
        "    match tip {",
        '        "Use /rename to rename your threads for easier thread resuming." => crate::i18n::global()',
        '            .text("tooltip-rename-threads", None, || {',
        '                "Use /rename to rename your threads for easier thread resuming.".to_string()',
        "            }),",
        "        _ => tip.to_string(),",
        "    }",
        "}"
      ].join("\n"),
      "startup tooltip localization map"
    ),
    replace(
      CHATWIDGET_PATH,
      [
        "const PLACEHOLDERS: [&str; 8] = [",
        '    "Explain this codebase",',
        '    "Summarize recent commits",',
        '    "Implement {feature}",',
        '    "Find and fix a bug in @filename",',
        '    "Write tests for @filename",',
        '    "Improve documentation in @filename",',
        '    "Run /review on my current changes",',
        '    "Use /skills to list available skills",',
        "];",
        "",
        "const SIDE_PLACEHOLDERS: [&str; 3] = [",
        '    "Check recently modified functions for compatibility",',
        '    "How many files have been modified?",',
        '    "Will this algorithm scale well?",',
        "];"
      ].join("\n"),
      [
        "const PLACEHOLDERS: [(&str, &str); 8] = [",
        '    ("composer-explain-codebase", "Explain this codebase"),',
        '    ("composer-summarize-commits", "Summarize recent commits"),',
        '    ("composer-implement-feature", "Implement {feature}"),',
        '    ("composer-fix-file-bug", "Find and fix a bug in @filename"),',
        '    ("composer-write-file-tests", "Write tests for @filename"),',
        "    (",
        '        "composer-improve-file-docs",',
        '        "Improve documentation in @filename",',
        "    ),",
        "    (",
        '        "composer-review-current-changes",',
        '        "Run /review on my current changes",',
        "    ),",
        "    (",
        '        "composer-list-skills",',
        '        "Use /skills to list available skills",',
        "    ),",
        "];",
        "",
        "const SIDE_PLACEHOLDERS: [(&str, &str); 3] = [",
        "    (",
        '        "composer-side-check-compatibility",',
        '        "Check recently modified functions for compatibility",',
        "    ),",
        "    (",
        '        "composer-side-count-modified-files",',
        '        "How many files have been modified?",',
        "    ),",
        "    (",
        '        "composer-side-check-scale",',
        '        "Will this algorithm scale well?",',
        "    ),",
        "];"
      ].join("\n"),
      "composer placeholder localization metadata"
    ),
    replace(
      CHATWIDGET_CONSTRUCTOR_PATH,
      [
        "        let mut rng = rand::rng();",
        "        let placeholder = PLACEHOLDERS[rng.random_range(0..PLACEHOLDERS.len())].to_string();",
        "        let side_placeholder =",
        "            SIDE_PLACEHOLDERS[rng.random_range(0..SIDE_PLACEHOLDERS.len())].to_string();"
      ].join("\n"),
      [
        "        let mut rng = rand::rng();",
        "        let (placeholder_key, placeholder_english) =",
        "            PLACEHOLDERS[rng.random_range(0..PLACEHOLDERS.len())];",
        "        let placeholder =",
        "            crate::i18n::global().text(placeholder_key, None, || placeholder_english.to_string());",
        "        let (side_placeholder_key, side_placeholder_english) =",
        "            SIDE_PLACEHOLDERS[rng.random_range(0..SIDE_PLACEHOLDERS.len())];",
        "        let side_placeholder = crate::i18n::global().text(side_placeholder_key, None, || {",
        "            side_placeholder_english.to_string()",
        "        });"
      ].join("\n"),
      "localized composer placeholders"
    ),
    replace(
      MCP_STARTUP_PATH,
      [
        "            McpServerStartupState::Failed => McpStartupStatus::Failed {",
        "                error: notification.error.unwrap_or_else(|| {",
        '                    format!("MCP client for `{}` failed to start", notification.name)',
        "                }),",
        "            },"
      ].join("\n"),
      [
        "            McpServerStartupState::Failed => {",
        "                let english_prefix =",
        '                    format!("MCP client for `{}` failed to start", notification.name);',
        "                let error = notification.error.unwrap_or_else(|| english_prefix.clone());",
        "                let localized_prefix = crate::i18n::global().text_with_string_arg(",
        '                    "mcp-client-failed-to-start",',
        '                    "name",',
        "                    notification.name.as_str(),",
        "                    || english_prefix.clone(),",
        "                );",
        "                let error = error",
        "                    .strip_prefix(&english_prefix)",
        "                    .map_or(error.clone(), |suffix| {",
        '                        format!("{localized_prefix}{suffix}")',
        "                    });",
        "                McpStartupStatus::Failed { error }",
        "            }"
      ].join("\n"),
      "localized MCP startup failure prefix"
    ),
    replace(
      STATUS_SURFACES_PATH,
      [
        "            StatusLineItem::UsedTokens => {",
        "                let usage = self.status_line_total_usage();",
        "                let total = usage.blended_total();",
        "                if total <= 0 {",
        "                    None",
        "                } else {",
        '                    Some(format!("{} used", format_tokens_compact(total)))',
        "                }",
        "            }",
        "            StatusLineItem::ContextRemaining => self",
        "                .status_line_context_remaining_percent()",
        '                .map(|remaining| format!("Context {remaining}% left")),',
        "            StatusLineItem::ContextUsed => self",
        "                .status_line_context_used_percent()",
        '                .map(|used| format!("Context {used}% used")),'
      ].join("\n"),
      [
        "            StatusLineItem::UsedTokens => {",
        "                let usage = self.status_line_total_usage();",
        "                let total = usage.blended_total();",
        "                if total <= 0 {",
        "                    None",
        "                } else {",
        "                    let tokens = format_tokens_compact(total);",
        "                    Some(crate::i18n::global().text_with_string_arg(",
        '                        "status-line-tokens-used",',
        '                        "tokens",',
        "                        tokens.as_str(),",
        '                        || format!("{tokens} used"),',
        "                    ))",
        "                }",
        "            }",
        "            StatusLineItem::ContextRemaining => {",
        "                self.status_line_context_remaining_percent()",
        "                    .map(|remaining| {",
        "                        crate::i18n::global().text_with_string_arg(",
        '                            "status-line-context-remaining",',
        '                            "percent",',
        "                            remaining.to_string(),",
        '                            || format!("Context {remaining}% left"),',
        "                        )",
        "                    })",
        "            }",
        "            StatusLineItem::ContextUsed => self.status_line_context_used_percent().map(|used| {",
        "                crate::i18n::global().text_with_string_arg(",
        '                    "status-line-context-used",',
        '                    "percent",',
        "                    used.to_string(),",
        '                    || format!("Context {used}% used"),',
        "                )",
        "            }),"
      ].join("\n"),
      "localized status line context and token values"
    ),
    replace(
      FOOTER_PATH,
      [
        "pub(crate) fn context_window_line(percent: Option<i64>, used_tokens: Option<i64>) -> Line<'static> {",
        "    if let Some(percent) = percent {",
        "        let percent = percent.clamp(0, 100);",
        '        return Line::from(vec![Span::from(format!("{percent}% context left")).dim()]);',
        "    }",
        "",
        "    if let Some(tokens) = used_tokens {",
        "        let used_fmt = format_tokens_compact(tokens);",
        '        return Line::from(vec![Span::from(format!("{used_fmt} used")).dim()]);',
        "    }",
        "",
        '    Line::from(vec![Span::from("100% context left").dim()])',
        "}"
      ].join("\n"),
      [
        "pub(crate) fn context_window_line(percent: Option<i64>, used_tokens: Option<i64>) -> Line<'static> {",
        "    if let Some(percent) = percent {",
        "        let percent = percent.clamp(0, 100);",
        "        let text = crate::i18n::global().text_with_string_arg(",
        '            "footer-context-remaining",',
        '            "percent",',
        "            percent.to_string(),",
        '            || format!("{percent}% context left"),',
        "        );",
        "        return Line::from(vec![Span::from(text).dim()]);",
        "    }",
        "",
        "    if let Some(tokens) = used_tokens {",
        "        let used_fmt = format_tokens_compact(tokens);",
        "        let text = crate::i18n::global().text_with_string_arg(",
        '            "footer-tokens-used",',
        '            "tokens",',
        "            used_fmt.as_str(),",
        '            || format!("{used_fmt} used"),',
        "        );",
        "        return Line::from(vec![Span::from(text).dim()]);",
        "    }",
        "",
        "    let text = crate::i18n::global().text_with_string_arg(",
        '        "footer-context-remaining",',
        '        "percent",',
        '        "100",',
        '        || "100% context left".to_string(),',
        "    );",
        "    Line::from(vec![Span::from(text).dim()])",
        "}"
      ].join("\n"),
      "localized footer context values"
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
      SLASH_COMMAND_PATH,
      [
        "    Title,",
        "    Statusline,",
        "    Theme,",
        '    #[strum(to_string = "pets", serialize = "pet")]'
      ].join("\n"),
      [
        "    Title,",
        "    Statusline,",
        "    Theme,",
        "    Language,",
        '    #[strum(to_string = "pets", serialize = "pet")]'
      ].join("\n"),
      "language slash command enum"
    ),
    replace(
      SLASH_COMMAND_PATH,
      [
        '            SlashCommand::Statusline => "configure which items appear in the status line",',
        '            SlashCommand::Theme => "choose a syntax highlighting theme",',
        '            SlashCommand::Pets => "choose or hide the terminal pet",'
      ].join("\n"),
      [
        '            SlashCommand::Statusline => "configure which items appear in the status line",',
        '            SlashCommand::Theme => "choose a syntax highlighting theme",',
        '            SlashCommand::Language => "view or choose the display language",',
        '            SlashCommand::Pets => "choose or hide the terminal pet",'
      ].join("\n"),
      "language slash command description"
    ),
    replace(
      SLASH_COMMAND_PATH,
      [
        '            SlashCommand::TestApproval => "test approval request",',
        "        }",
        "    }",
        "",
        "    /// Command string without the leading '/'. Provided for compatibility with"
      ].join("\n"),
      [
        '            SlashCommand::TestApproval => "test approval request",',
        "        }",
        "    }",
        "",
        "    pub(crate) fn description_metadata(self) -> (&'static str, &'static str) {",
        "        match self {",
        ...SLASH_DESCRIPTION_METADATA.flatMap(([pattern, id, key]) => {
          const singleLine = `            ${pattern} => ("${id}", "${key}"),`;
          return singleLine.length <= 100 &&
            !RUSTFMT_MULTILINE_SLASH_PATTERNS.has(pattern)
            ? [singleLine]
            : [
                `            ${pattern} => (`,
                `                "${id}",`,
                `                "${key}",`,
                "            ),"
              ];
        }),
        "        }",
        "    }",
        "",
        "    /// Command string without the leading '/'. Provided for compatibility with"
      ].join("\n"),
      "slash command localization metadata"
    ),
    replace(
      SLASH_COMMAND_PATH,
      [
        "                | SlashCommand::Raw",
        "                | SlashCommand::Usage",
        "                | SlashCommand::Pets"
      ].join("\n"),
      [
        "                | SlashCommand::Raw",
        "                | SlashCommand::Usage",
        "                | SlashCommand::Language",
        "                | SlashCommand::Pets"
      ].join("\n"),
      "language slash command inline arguments"
    ),
    replace(
      SLASH_COMMAND_PATH,
      [
        "                | SlashCommand::Status",
        "                | SlashCommand::Usage",
        "                | SlashCommand::Ide"
      ].join("\n"),
      [
        "                | SlashCommand::Status",
        "                | SlashCommand::Usage",
        "                | SlashCommand::Language",
        "                | SlashCommand::Ide"
      ].join("\n"),
      "language slash command side conversation availability"
    ),
    replace(
      SLASH_COMMAND_PATH,
      [
        "            | SlashCommand::Title",
        "            | SlashCommand::Statusline",
        "            | SlashCommand::AutoReview"
      ].join("\n"),
      [
        "            | SlashCommand::Title",
        "            | SlashCommand::Statusline",
        "            | SlashCommand::Language",
        "            | SlashCommand::AutoReview"
      ].join("\n"),
      "language slash command task availability"
    ),
    replace(
      SLASH_COMMAND_PATH,
      [
        "        assert!(SlashCommand::Title.available_during_task());",
        "        assert!(SlashCommand::Statusline.available_during_task());",
        "        assert!(SlashCommand::Raw.available_during_task());"
      ].join("\n"),
      [
        "        assert!(SlashCommand::Title.available_during_task());",
        "        assert!(SlashCommand::Statusline.available_during_task());",
        "        assert!(SlashCommand::Language.available_during_task());",
        "        assert!(SlashCommand::Language.supports_inline_args());",
        "        assert!(SlashCommand::Raw.available_during_task());"
      ].join("\n"),
      "language slash command tests"
    ),
    replace(
      SLASH_DISPATCH_PATH,
      [
        "            SlashCommand::Theme => {",
        "                self.open_theme_picker();",
        "            }",
        "            SlashCommand::Pets => {"
      ].join("\n"),
      [
        "            SlashCommand::Theme => {",
        "                self.open_theme_picker();",
        "            }",
        "            SlashCommand::Language => {",
        "                let (message, hint) = crate::i18n::language_status();",
        "                self.add_info_message(message, Some(hint));",
        "            }",
        "            SlashCommand::Pets => {"
      ].join("\n"),
      "language slash command status dispatch"
    ),
    replace(
      SLASH_DISPATCH_PATH,
      [
        "            SlashCommand::Pets if !trimmed.is_empty() => {",
        "                self.select_pet_by_id(args);",
        "            }",
        "            _ => self.dispatch_command(cmd),"
      ].join("\n"),
      [
        "            SlashCommand::Pets if !trimmed.is_empty() => {",
        "                self.select_pet_by_id(args);",
        "            }",
        "            SlashCommand::Language => match crate::i18n::save_language_preference(trimmed) {",
        "                Ok(message) => self.add_info_message(message, /*hint*/ None),",
        "                Err(message) => self.add_error_message(message),",
        "            },",
        "            _ => self.dispatch_command(cmd),"
      ].join("\n"),
      "language slash command selection dispatch"
    ),
    replace(
      SLASH_DISPATCH_PATH,
      [
        "            | SlashCommand::Statusline",
        "            | SlashCommand::Theme",
        "            | SlashCommand::Pets => QueueDrain::Stop,"
      ].join("\n"),
      [
        "            | SlashCommand::Statusline",
        "            | SlashCommand::Theme",
        "            | SlashCommand::Language",
        "            | SlashCommand::Pets => QueueDrain::Stop,"
      ].join("\n"),
      "language queued command behavior"
    ),
    replace(
      CHAT_COMPOSER_PATH,
      [
        "            let message = format!(",
        '                r#"Unrecognized command \'/{name}\'. Type "/" for a list of supported commands."#',
        "            );"
      ].join("\n"),
      [
        "            let message = crate::i18n::global().text_with_string_arg(",
        '                "slash-unrecognized-command",',
        '                "name",',
        "                name.as_str(),",
        "                || {",
        "                    format!(",
        '                        r#"Unrecognized command \'/{name}\'. Type "/" for a list of supported commands."#',
        "                    )",
        "                },",
        "            );"
      ].join("\n"),
      "localized immediate unknown slash command"
    ),
    replace(
      SLASH_DISPATCH_PATH,
      [
        "            self.add_info_message(",
        "                format!(",
        '                    r#"Unrecognized command \'/{name}\'. Type "/" for a list of supported commands."#',
        "                ),",
        "                /*hint*/ None,",
        "            );"
      ].join("\n"),
      [
        "            let message = crate::i18n::global().text_with_string_arg(",
        '                "slash-unrecognized-command",',
        '                "name",',
        "                name,",
        "                || {",
        "                    format!(",
        '                        r#"Unrecognized command \'/{name}\'. Type "/" for a list of supported commands."#',
        "                    )",
        "                },",
        "            );",
        "            self.add_info_message(message, /*hint*/ None);"
      ].join("\n"),
      "localized queued unknown slash command"
    ),
    replace(
      COMMAND_POPUP_PATH,
      "                let description = item.description().to_string();",
      "                let description = item.description();",
      "localized command popup rows"
    ),
    replace(
      COMMAND_POPUP_PATH,
      [
        "    fn description(&self) -> &str {",
        "        match self {",
        "            Self::Builtin(cmd) => cmd.description(),",
        "            Self::ServiceTier(command) => &command.description,",
        "        }",
        "    }"
      ].join("\n"),
      [
        "    fn description(&self) -> String {",
        "        match self {",
        "            Self::Builtin(cmd) => {",
        "                let (_id, key) = cmd.description_metadata();",
        "                let english = cmd.description();",
        "                crate::i18n::global().text(key, None, || english.to_string())",
        "            }",
        "            Self::ServiceTier(command) => command.description.clone(),",
        "        }",
        "    }"
      ].join("\n"),
      "localized command popup descriptions"
    ),
    replace(
      COMMAND_POPUP_PATH,
      [
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
        "        );"
      ].join("\n"),
      [
        '        let no_matches = crate::i18n::global().text("command-popup-no-matches", None, || {',
        '            "no matches".to_string()',
        "        });",
        "        render_rows_with_col_width_mode(",
        "            area.inset(Insets::tlbr(",
        "                /*top*/ 0, /*left*/ 2, /*bottom*/ 0, /*right*/ 0,",
        "            )),",
        "            buf,",
        "            &rows,",
        "            &self.state,",
        "            MAX_POPUP_ROWS,",
        "            &no_matches,",
        "            COMMAND_COLUMN_WIDTH,",
        "        );"
      ].join("\n"),
      "localized command popup empty state"
    ),
    replace(
      APPROVAL_OVERLAY_PATH,
      [
        "use ratatui::widgets::Paragraph;",
        "use ratatui::widgets::Wrap;",
        "",
        "/// Request coming from the agent that needs user approval."
      ].join("\n"),
      [
        "use ratatui::widgets::Paragraph;",
        "use ratatui::widgets::Wrap;",
        "",
        "fn approval_text(key: &str, english: &str) -> String {",
        "    crate::i18n::global().text(key, None, || english.to_string())",
        "}",
        "",
        "/// Request coming from the agent that needs user approval."
      ].join("\n"),
      "approval localization helper"
    ),
    replace(
      APPROVAL_OVERLAY_PATH,
      '                    || "Would you like to run the following command?".to_string(),',
      [
        "                    || {",
        "                        approval_text(",
        '                            "approval-run-command-title",',
        '                            "Would you like to run the following command?",',
        "                        )",
        "                    },"
      ].join("\n"),
      "localized command approval title"
    ),
    replace(
      APPROVAL_OVERLAY_PATH,
      [
        "            ApprovalRequest::Permissions { .. } => (",
        "                permissions_options(approval_keymap),",
        '                "Would you like to grant these permissions?".to_string(),',
        "            ),",
        "            ApprovalRequest::ApplyPatch { .. } => (",
        "                patch_options(approval_keymap),",
        '                "Would you like to make the following edits?".to_string(),',
        "            ),"
      ].join("\n"),
      [
        "            ApprovalRequest::Permissions { .. } => (",
        "                permissions_options(approval_keymap),",
        "                approval_text(",
        '                    "approval-grant-permissions-title",',
        '                    "Would you like to grant these permissions?",',
        "                ),",
        "            ),",
        "            ApprovalRequest::ApplyPatch { .. } => (",
        "                patch_options(approval_keymap),",
        "                approval_text(",
        '                    "approval-apply-patch-title",',
        '                    "Would you like to make the following edits?",',
        "                ),",
        "            ),"
      ].join("\n"),
      "localized permission and patch approval titles"
    ),
    replace(
      APPROVAL_OVERLAY_PATH,
      [
        "                label: if network_approval_context.is_some() {",
        '                    "Yes, just this once".to_string()',
        "                } else {",
        '                    "Yes, proceed".to_string()',
        "                },"
      ].join("\n"),
      [
        "                label: if network_approval_context.is_some() {",
        "                    approval_text(\"approval-yes-once\", \"Yes, just this once\")",
        "                } else {",
        "                    approval_text(\"approval-yes-proceed\", \"Yes, proceed\")",
        "                },"
      ].join("\n"),
      "localized one-time command approval options"
    ),
    replace(
      APPROVAL_OVERLAY_PATH,
      [
        "                label: if network_approval_context.is_some() {",
        '                    "Yes, and allow this host for this conversation".to_string()',
        "                } else if additional_permissions.is_some() {",
        '                    "Yes, and allow these permissions for this session".to_string()',
        "                } else {",
        '                    "Yes, and don\'t ask again for this command in this session".to_string()',
        "                },"
      ].join("\n"),
      [
        "                label: if network_approval_context.is_some() {",
        "                    approval_text(",
        '                        "approval-allow-host-conversation",',
        '                        "Yes, and allow this host for this conversation",',
        "                    )",
        "                } else if additional_permissions.is_some() {",
        "                    approval_text(",
        '                        "approval-allow-permissions-session",',
        '                        "Yes, and allow these permissions for this session",',
        "                    )",
        "                } else {",
        "                    approval_text(",
        '                        "approval-allow-command-session",',
        '                        "Yes, and don\'t ask again for this command in this session",',
        "                    )",
        "                },"
      ].join("\n"),
      "localized session command approval options"
    ),
    replace(
      APPROVAL_OVERLAY_PATH,
      [
        "                    NetworkPolicyRuleAction::Allow => (",
        '                        "Yes, and allow this host in the future".to_string(),',
        "                        keymap.approve_for_prefix.clone(),",
        "                    ),",
        "                    NetworkPolicyRuleAction::Deny => (",
        '                        "No, and block this host in the future".to_string(),',
        "                        keymap.deny.clone(),",
        "                    ),"
      ].join("\n"),
      [
        "                    NetworkPolicyRuleAction::Allow => (",
        "                        approval_text(",
        '                            "approval-allow-host-future",',
        '                            "Yes, and allow this host in the future",',
        "                        ),",
        "                        keymap.approve_for_prefix.clone(),",
        "                    ),",
        "                    NetworkPolicyRuleAction::Deny => (",
        "                        approval_text(",
        '                            "approval-block-host-future",',
        '                            "No, and block this host in the future",',
        "                        ),",
        "                        keymap.deny.clone(),",
        "                    ),"
      ].join("\n"),
      "localized persistent network approval options"
    ),
    replace(
      APPROVAL_OVERLAY_PATH,
      [
        "            CommandExecutionApprovalDecision::Decline => Some(ApprovalOption {",
        '                label: "No, continue without running it".to_string(),',
        "                decision: ApprovalDecision::Command(CommandExecutionApprovalDecision::Decline),",
        "                shortcuts: keymap.deny.clone(),",
        "            }),",
        "            CommandExecutionApprovalDecision::Cancel => Some(ApprovalOption {",
        '                label: "No, and tell Codex what to do differently".to_string(),',
        "                decision: ApprovalDecision::Command(CommandExecutionApprovalDecision::Cancel),",
        "                shortcuts: keymap.decline.clone(),",
        "            }),"
      ].join("\n"),
      [
        "            CommandExecutionApprovalDecision::Decline => Some(ApprovalOption {",
        "                label: approval_text(",
        '                    "approval-decline-command",',
        '                    "No, continue without running it",',
        "                ),",
        "                decision: ApprovalDecision::Command(CommandExecutionApprovalDecision::Decline),",
        "                shortcuts: keymap.deny.clone(),",
        "            }),",
        "            CommandExecutionApprovalDecision::Cancel => Some(ApprovalOption {",
        "                label: approval_text(",
        '                    "approval-tell-codex",',
        '                    "No, and tell Codex what to do differently",',
        "                ),",
        "                decision: ApprovalDecision::Command(CommandExecutionApprovalDecision::Cancel),",
        "                shortcuts: keymap.decline.clone(),",
        "            }),"
      ].join("\n"),
      "localized command denial options"
    ),
    replace(
      APPROVAL_OVERLAY_PATH,
      [
        "fn patch_options(keymap: &ApprovalKeymap) -> Vec<ApprovalOption> {",
        "    vec![",
        "        ApprovalOption {",
        '            label: "Yes, proceed".to_string(),',
        "            decision: ApprovalDecision::FileChange(FileChangeApprovalDecision::Accept),",
        "            shortcuts: keymap.approve.clone(),",
        "        },",
        "        ApprovalOption {",
        '            label: "Yes, and don\'t ask again for these files".to_string(),',
        "            decision: ApprovalDecision::FileChange(FileChangeApprovalDecision::AcceptForSession),",
        "            shortcuts: keymap.approve_for_session.clone(),",
        "        },",
        "        ApprovalOption {",
        '            label: "No, and tell Codex what to do differently".to_string(),',
        "            decision: ApprovalDecision::FileChange(FileChangeApprovalDecision::Cancel),",
        "            shortcuts: keymap.decline.clone(),",
        "        },",
        "    ]",
        "}"
      ].join("\n"),
      [
        "fn patch_options(keymap: &ApprovalKeymap) -> Vec<ApprovalOption> {",
        "    vec![",
        "        ApprovalOption {",
        '            label: approval_text("approval-yes-proceed", "Yes, proceed"),',
        "            decision: ApprovalDecision::FileChange(FileChangeApprovalDecision::Accept),",
        "            shortcuts: keymap.approve.clone(),",
        "        },",
        "        ApprovalOption {",
        "            label: approval_text(",
        '                "approval-allow-files-session",',
        '                "Yes, and don\'t ask again for these files",',
        "            ),",
        "            decision: ApprovalDecision::FileChange(FileChangeApprovalDecision::AcceptForSession),",
        "            shortcuts: keymap.approve_for_session.clone(),",
        "        },",
        "        ApprovalOption {",
        "            label: approval_text(",
        '                "approval-tell-codex",',
        '                "No, and tell Codex what to do differently",',
        "            ),",
        "            decision: ApprovalDecision::FileChange(FileChangeApprovalDecision::Cancel),",
        "            shortcuts: keymap.decline.clone(),",
        "        },",
        "    ]",
        "}"
      ].join("\n"),
      "localized patch approval options"
    ),
    replace(
      APPROVAL_OVERLAY_PATH,
      [
        '            label: "Yes, grant these permissions for this turn".to_string(),',
        "            decision: ApprovalDecision::Permissions(PermissionsDecision::GrantForTurn),",
        "            shortcuts: keymap.approve.clone(),",
        "        },",
        "        ApprovalOption {",
        '            label: "Yes, grant for this turn with strict auto review".to_string(),',
        "            decision: ApprovalDecision::Permissions(",
        "                PermissionsDecision::GrantForTurnWithStrictAutoReview,",
        "            ),",
        "            shortcuts: vec![key_hint::plain(KeyCode::Char('r'))],",
        "        },",
        "        ApprovalOption {",
        '            label: "Yes, grant these permissions for this session".to_string(),',
        "            decision: ApprovalDecision::Permissions(PermissionsDecision::GrantForSession),",
        "            shortcuts: keymap.approve_for_session.clone(),",
        "        },",
        "        ApprovalOption {",
        '            label: "No, continue without permissions".to_string(),'
      ].join("\n"),
      [
        "            label: approval_text(",
        '                "approval-grant-permissions-turn",',
        '                "Yes, grant these permissions for this turn",',
        "            ),",
        "            decision: ApprovalDecision::Permissions(PermissionsDecision::GrantForTurn),",
        "            shortcuts: keymap.approve.clone(),",
        "        },",
        "        ApprovalOption {",
        "            label: approval_text(",
        '                "approval-grant-strict-review-turn",',
        '                "Yes, grant for this turn with strict auto review",',
        "            ),",
        "            decision: ApprovalDecision::Permissions(",
        "                PermissionsDecision::GrantForTurnWithStrictAutoReview,",
        "            ),",
        "            shortcuts: vec![key_hint::plain(KeyCode::Char('r'))],",
        "        },",
        "        ApprovalOption {",
        "            label: approval_text(",
        '                "approval-grant-permissions-session",',
        '                "Yes, grant these permissions for this session",',
        "            ),",
        "            decision: ApprovalDecision::Permissions(PermissionsDecision::GrantForSession),",
        "            shortcuts: keymap.approve_for_session.clone(),",
        "        },",
        "        ApprovalOption {",
        "            label: approval_text(",
        '                "approval-continue-without-permissions",',
        '                "No, continue without permissions",',
        "            ),"
      ].join("\n"),
      "localized permission approval options"
    ),
    replace(
      APPROVAL_OVERLAY_PATH,
      [
        '            label: "Yes, provide the requested info".to_string(),',
        "            decision: ApprovalDecision::McpElicitation(McpServerElicitationAction::Accept),",
        "            shortcuts: keymap.approve.clone(),",
        "        },",
        "        ApprovalOption {",
        '            label: "No, but continue without it".to_string(),',
        "            decision: ApprovalDecision::McpElicitation(McpServerElicitationAction::Decline),",
        "            shortcuts: decline_shortcuts,",
        "        },",
        "        ApprovalOption {",
        '            label: "Cancel this request".to_string(),'
      ].join("\n"),
      [
        "            label: approval_text(",
        '                "approval-provide-requested-info",',
        '                "Yes, provide the requested info",',
        "            ),",
        "            decision: ApprovalDecision::McpElicitation(McpServerElicitationAction::Accept),",
        "            shortcuts: keymap.approve.clone(),",
        "        },",
        "        ApprovalOption {",
        "            label: approval_text(",
        '                "approval-continue-without-info",',
        '                "No, but continue without it",',
        "            ),",
        "            decision: ApprovalDecision::McpElicitation(McpServerElicitationAction::Decline),",
        "            shortcuts: decline_shortcuts,",
        "        },",
        "        ApprovalOption {",
        "            label: approval_text(\"approval-cancel-request\", \"Cancel this request\"),"
      ].join("\n"),
      "localized elicitation approval options"
    ),
    replace(
      ONBOARDING_AUTH_PATH,
      [
        "    fn render_pick_mode(&self, area: Rect, buf: &mut Buffer) {",
        "        let mut lines: Vec<Line> = vec![",
        "            Line::from(vec![",
        '                "  ".into(),',
        '                "Sign in with ChatGPT to use Codex as part of your paid plan".into(),',
        "            ]),",
        "            Line::from(vec![",
        '                "  ".into(),',
        '                "or connect an API key for usage-based billing".into(),',
        "            ]),"
      ].join("\n"),
      [
        "    fn render_pick_mode(&self, area: Rect, buf: &mut Buffer) {",
        "        let localizer = crate::i18n::global();",
        "        let mut lines: Vec<Line> = vec![",
        "            Line::from(vec![",
        '                "  ".into(),',
        "                localizer",
        '                    .text("onboarding-paid-plan-intro", None, || {',
        '                        "Sign in with ChatGPT to use Codex as part of your paid plan".to_string()',
        "                    })",
        "                    .into(),",
        "            ]),",
        "            Line::from(vec![",
        '                "  ".into(),',
        "                localizer",
        '                    .text("onboarding-api-key-billing-intro", None, || {',
        '                        "or connect an API key for usage-based billing".to_string()',
        "                    })",
        "                    .into(),",
        "            ]),"
      ].join("\n"),
      "localized onboarding introductions"
    ),
    replace(
      ONBOARDING_AUTH_PATH,
      '        let device_code_description = "Sign in from another device with a one-time code";',
      [
        '        let device_code_description = "Sign in from another device with a one-time code";',
        "        let sign_in_chatgpt = localizer.text(\"onboarding-sign-in-chatgpt\", None, || {",
        '            "Sign in with ChatGPT".to_string()',
        "        });",
        "        let provide_api_key = localizer.text(\"onboarding-provide-api-key\", None, || {",
        '            "Provide your own API key".to_string()',
        "        });",
        "        let pay_for_usage = localizer.text(\"onboarding-pay-for-usage\", None, || {",
        '            "Pay for what you use".to_string()',
        "        });"
      ].join("\n"),
      "localized onboarding choice labels"
    ),
    replace(
      ONBOARDING_AUTH_PATH,
      [
        '                        "Sign in with ChatGPT",',
        "                        chatgpt_description,"
      ].join("\n"),
      [
        "                        &sign_in_chatgpt,",
        "                        chatgpt_description,"
      ].join("\n"),
      "localized ChatGPT sign-in choice"
    ),
    replace(
      ONBOARDING_AUTH_PATH,
      [
        '                        "Provide your own API key",',
        '                        "Pay for what you use",'
      ].join("\n"),
      [
        "                        &provide_api_key,",
        "                        &pay_for_usage,"
      ].join("\n"),
      "localized API key choice"
    ),
    replace(
      ONBOARDING_AUTH_PATH,
      [
        "            lines.push(",
        '                "  API key login is disabled by this workspace. Sign in with ChatGPT to continue."',
        "                    .dim()",
        "                    .into(),",
        "            );"
      ].join("\n"),
      [
        '            let message = localizer.text("onboarding-api-key-disabled-workspace", None, || {',
        '                "API key login is disabled by this workspace. Sign in with ChatGPT to continue."',
        "                    .to_string()",
        "            });",
        '            lines.push(format!("  {message}").dim().into());'
      ].join("\n"),
      "localized API key disabled notice"
    ),
    replace(
      COMMAND_POPUP_SNAPSHOT_PATH,
      [
        "/statusline - configure which items appear in the status line",
        "/theme - choose a syntax highlighting theme",
        "/pets - choose or hide the terminal pet"
      ].join("\n"),
      [
        "/statusline - configure which items appear in the status line",
        "/theme - choose a syntax highlighting theme",
        "/language - view or choose the display language",
        "/pets - choose or hide the terminal pet"
      ].join("\n"),
      "language command popup snapshot"
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
