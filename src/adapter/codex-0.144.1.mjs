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
const WORKSPACE_CARGO_PATH = "codex-rs/Cargo.toml";
const TUI_CARGO_PATH = "codex-rs/tui/Cargo.toml";
const CARGO_LOCK_PATH = "codex-rs/Cargo.lock";
const CLI_MAIN_PATH = "codex-rs/cli/src/main.rs";
const I18N_PATH = "codex-rs/tui/src/i18n.rs";
const I18N_TESTS_PATH = "codex-rs/tui/src/i18n_tests.rs";
const SNAPSHOT_FILE_NAME =
  "codex_tui__bottom_pane__status_line_setup__tests__setup_view_snapshot_uses_zh_cn_catalog.snap";
const SNAPSHOT_PATH =
  "codex-rs/tui/src/bottom_pane/snapshots/" + SNAPSHOT_FILE_NAME;
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
  { relativePath: WORKSPACE_CARGO_PATH, created: false },
  { relativePath: TUI_CARGO_PATH, created: false },
  { relativePath: CARGO_LOCK_PATH, created: false },
  { relativePath: CLI_MAIN_PATH, created: false },
  { relativePath: I18N_PATH, created: true },
  { relativePath: I18N_TESTS_PATH, created: true },
  { relativePath: SNAPSHOT_PATH, created: true }
];

const NEW_FUNCTION_ANCHOR = [
  "    pub(crate) fn new(",
  "        status_line_items: Option<&[String]>,",
  "        use_theme_colors: bool,",
  "        preview_data: StatusSurfacePreviewData,",
  "        app_event_tx: AppEventSender,",
  "        list_keymap: ListKeymap,",
  "    ) -> Self {",
  "        let mut used_ids = HashSet::new();"
].join("\n");

const NEW_FUNCTION_REPLACEMENT = [
  "    pub(crate) fn new(",
  "        status_line_items: Option<&[String]>,",
  "        use_theme_colors: bool,",
  "        preview_data: StatusSurfacePreviewData,",
  "        app_event_tx: AppEventSender,",
  "        list_keymap: ListKeymap,",
  "    ) -> Self {",
  "        Self::new_with_translator(",
  "            status_line_items,",
  "            use_theme_colors,",
  "            preview_data,",
  "            app_event_tx,",
  "            list_keymap,",
  "            crate::i18n::global(),",
  "        )",
  "    }",
  "",
  "    fn new_with_translator(",
  "        status_line_items: Option<&[String]>,",
  "        use_theme_colors: bool,",
  "        preview_data: StatusSurfacePreviewData,",
  "        app_event_tx: AppEventSender,",
  "        list_keymap: ListKeymap,",
  "        translator: &crate::i18n::Localizer,",
  "    ) -> Self {",
  "        let mut used_ids = HashSet::new();"
].join("\n");

const SNAPSHOT_ANCHOR =
  "    fn render_lines(view: &StatusLineSetupView, width: u16) -> String {";

const SNAPSHOT_TEST = [
  "    #[test]",
  "    fn setup_view_snapshot_uses_zh_cn_catalog() {",
  "        let translator = crate::i18n::Localizer::from_ftl(",
  '            "zh-CN",',
  "            concat!(",
  '                "tui--status-line--setup--use-theme-colors = 使用主题颜色\\n",',
  '                "tui--status-line--setup--apply-theme-colors = 应用当前 /theme 的颜色\\n",',
  '                "tui--status-line--setup--configure-title = 配置状态栏\\n",',
  '                "tui--status-line--setup--select-items-description = 选择要显示在状态栏中的项目。\\n",',
  "            ),",
  "        );",
  "        let (tx_raw, _rx) = unbounded_channel::<AppEvent>();",
  "        let view = StatusLineSetupView::new_with_translator(",
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
  '                    "codex-ultra/i18n".to_string(),',
  "                ),",
  "            ]),",
  "            AppEventSender::new(tx_raw),",
  "            crate::keymap::RuntimeKeymap::defaults().list,",
  "            &translator,",
  "        );",
  "",
  "        let rendered = render_lines(&view, /*width*/ 72);",
  "        let rendered = rendered",
  "            .lines()",
  "            .map(str::trim_end)",
  "            .collect::<Vec<_>>()",
  '            .join("\\n");',
  "        assert_snapshot!(rendered);",
  "    }",
  "",
  SNAPSHOT_ANCHOR
].join("\n");

function replace(relativePath, anchor, replacement, label) {
  return {
    type: "replace",
    relativePath,
    anchor,
    replacement,
    label,
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
  const [i18nSource, i18nTestsSource, snapshotSource] = await Promise.all([
    readFile(join(overlayDir, "i18n.rs")),
    readFile(join(overlayDir, "i18n_tests.rs")),
    readFile(join(overlayDir, SNAPSHOT_FILE_NAME))
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
      NEW_FUNCTION_ANCHOR,
      NEW_FUNCTION_REPLACEMENT,
      "StatusLineSetupView::new"
    ),
    replace(
      STATUS_LINE_PATH,
      'name: "Use theme colors".to_string(),',
      [
        'name: translator.text("tui.status-line.setup.use-theme-colors", None, || {',
        '                "Use theme colors".to_string()',
        "            }),"
      ].join("\n"),
      "use theme colors"
    ),
    replace(
      STATUS_LINE_PATH,
      'description: Some("Apply colors from the active /theme".to_string()),',
      [
        "description: Some(translator.text(",
        '                "tui.status-line.setup.apply-theme-colors",',
        "                None,",
        '                || "Apply colors from the active /theme".to_string(),',
        "            )),"
      ].join("\n"),
      "apply theme colors"
    ),
    replace(
      STATUS_LINE_PATH,
      '"Configure Status Line".to_string(),',
      [
        'translator.text("tui.status-line.setup.configure-title", None, || {',
        '                    "Configure Status Line".to_string()',
        "                }),"
      ].join("\n"),
      "configure status line title"
    ),
    replace(
      STATUS_LINE_PATH,
      'Some("Select which items to display in the status line.".to_string()),',
      [
        "Some(translator.text(",
        '                    "tui.status-line.setup.select-items-description",',
        "                    None,",
        '                    || "Select which items to display in the status line.".to_string(),',
        "                )),"
      ].join("\n"),
      "configure status line description"
    ),
    replace(
      STATUS_LINE_PATH,
      SNAPSHOT_ANCHOR,
      SNAPSHOT_TEST,
      "zh-CN status line snapshot insertion"
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
    {
      type: "create",
      relativePath: SNAPSHOT_PATH,
      content: snapshotSource
    }
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
