import { execFile } from "node:child_process";
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
  "        translator: &crate::i18n::Translator,",
  "    ) -> Self {",
  "        let mut used_ids = HashSet::new();"
].join("\n");

const SNAPSHOT_ANCHOR =
  "    fn render_lines(view: &StatusLineSetupView, width: u16) -> String {";

const SNAPSHOT_TEST = [
  "    #[test]",
  "    fn setup_view_snapshot_uses_zh_cn_catalog() {",
  "        let translator = crate::i18n::Translator::from_json_str(",
  '            r#"{"messages":{"tui.status-line.setup.apply-theme-colors":"应用当前 /theme 的颜色","tui.status-line.setup.configure-title":"配置状态栏","tui.status-line.setup.select-items-description":"选择要显示在状态栏中的项目。","tui.status-line.setup.use-theme-colors":"使用主题颜色"}}"#,',
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
      STATUS_LINE_PATH,
      NEW_FUNCTION_ANCHOR,
      NEW_FUNCTION_REPLACEMENT,
      "StatusLineSetupView::new"
    ),
    replace(
      STATUS_LINE_PATH,
      'name: "Use theme colors".to_string(),',
      'name: translator.text("tui.status-line.setup.use-theme-colors", "Use theme colors"),',
      "use theme colors"
    ),
    replace(
      STATUS_LINE_PATH,
      'description: Some("Apply colors from the active /theme".to_string()),',
      [
        "description: Some(translator.text(",
        '                "tui.status-line.setup.apply-theme-colors",',
        '                "Apply colors from the active /theme",',
        "            )),"
      ].join("\n"),
      "apply theme colors"
    ),
    replace(
      STATUS_LINE_PATH,
      '"Configure Status Line".to_string(),',
      [
        "translator.text(",
        '                    "tui.status-line.setup.configure-title",',
        '                    "Configure Status Line",',
        "                ),"
      ].join("\n"),
      "configure status line title"
    ),
    replace(
      STATUS_LINE_PATH,
      'Some("Select which items to display in the status line.".to_string()),',
      [
        "Some(translator.text(",
        '                    "tui.status-line.setup.select-items-description",',
        '                    "Select which items to display in the status line.",',
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
