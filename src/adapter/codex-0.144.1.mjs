import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const TARGET_COMMIT =
  "44918ea10c0f99151c6710411b4322c2f5c96bea";

const MODULE_PATH = "codex-rs/tui/src/lib.rs";
const STATUS_LINE_PATH =
  "codex-rs/tui/src/bottom_pane/status_line_setup.rs";
const I18N_PATH = "codex-rs/tui/src/i18n.rs";
const I18N_TESTS_PATH = "codex-rs/tui/src/i18n_tests.rs";
const STATE_DIRECTORY = ".codex-ultra-mvp";
const DEFAULT_OVERLAY_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "overlay"
);

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
  "        assert_snapshot!(render_lines(&view, /*width*/ 72));",
  "    }",
  "",
  SNAPSHOT_ANCHOR
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

function replaceExact(source, anchor, replacement, label) {
  const first = source.indexOf(anchor);
  const second = first === -1 ? -1 : source.indexOf(anchor, first + anchor.length);
  if (first === -1 || second !== -1) {
    const count = first === -1 ? 0 : 2;
    throw new Error(
      "anchor drift for " + label + ": expected 1 match, found " + count
    );
  }
  return source.slice(0, first) + replacement + source.slice(first + anchor.length);
}

function transformWithOriginalLineEndings(source, transform) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const normalized = source.replaceAll("\r\n", "\n");
  return transform(normalized).replaceAll("\n", newline);
}

function transformLib(source) {
  return transformWithOriginalLineEndings(source, (normalized) =>
    replaceExact(
      normalized,
      "mod ide_context;",
      ["mod ide_context;", "mod i18n;"].join("\n"),
      "tui lib module declaration"
    )
  );
}

function transformStatusLine(source) {
  return transformWithOriginalLineEndings(source, (normalized) => {
    let result = replaceExact(
      normalized,
      NEW_FUNCTION_ANCHOR,
      NEW_FUNCTION_REPLACEMENT,
      "StatusLineSetupView::new"
    );
    result = replaceExact(
      result,
      'name: "Use theme colors".to_string(),',
      [
        "name: translator.text(",
        '                "tui.status-line.setup.use-theme-colors",',
        '                "Use theme colors",',
        "            ),"
      ].join("\n"),
      "use theme colors"
    );
    result = replaceExact(
      result,
      'description: Some("Apply colors from the active /theme".to_string()),',
      [
        "description: Some(translator.text(",
        '                "tui.status-line.setup.apply-theme-colors",',
        '                "Apply colors from the active /theme",',
        "            )),"
      ].join("\n"),
      "apply theme colors"
    );
    result = replaceExact(
      result,
      '"Configure Status Line".to_string(),',
      [
        "translator.text(",
        '                    "tui.status-line.setup.configure-title",',
        '                    "Configure Status Line",',
        "                ),"
      ].join("\n"),
      "configure status line title"
    );
    result = replaceExact(
      result,
      'Some("Select which items to display in the status line.".to_string()),',
      [
        "Some(translator.text(",
        '                    "tui.status-line.setup.select-items-description",',
        '                    "Select which items to display in the status line.",',
        "                )),"
      ].join("\n"),
      "configure status line description"
    );
    return replaceExact(
      result,
      SNAPSHOT_ANCHOR,
      SNAPSHOT_TEST,
      "zh-CN status line snapshot insertion"
    );
  });
}

async function verifyRelease(sourceRoot) {
  const { stdout: headOutput } = await execFileAsync(
    "git",
    ["-C", sourceRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" }
  );
  const head = headOutput.trim();
  if (head !== TARGET_COMMIT) {
    throw new Error(
      "unsupported Codex source commit " + head + "; expected " + TARGET_COMMIT
    );
  }
  const { stdout: statusOutput } = await execFileAsync(
    "git",
    ["-C", sourceRoot, "status", "--porcelain"],
    { encoding: "utf8" }
  );
  if (statusOutput.trim()) {
    throw new Error("Codex source worktree must be clean before apply");
  }
}

export async function planCodexPatch(
  sourceRoot,
  { verifyGit = true, overlayDir = DEFAULT_OVERLAY_DIR } = {}
) {
  const resolvedRoot = resolve(sourceRoot);
  if (verifyGit) {
    await verifyRelease(resolvedRoot);
  }
  const stateRoot = join(resolvedRoot, STATE_DIRECTORY);
  if (await pathExists(stateRoot)) {
    throw new Error("Codex Ultra MVP state already exists");
  }

  const libPath = join(resolvedRoot, MODULE_PATH);
  const statusPath = join(resolvedRoot, STATUS_LINE_PATH);
  const [libSource, statusSource, i18nSource, i18nTestsSource] =
    await Promise.all([
      readFile(libPath, "utf8"),
      readFile(statusPath, "utf8"),
      readFile(join(overlayDir, "i18n.rs"), "utf8"),
      readFile(join(overlayDir, "i18n_tests.rs"), "utf8")
    ]);

  const overlayTargets = [I18N_PATH, I18N_TESTS_PATH];
  for (const relativePath of overlayTargets) {
    if (await pathExists(join(resolvedRoot, relativePath))) {
      throw new Error("overlay target already exists: " + relativePath);
    }
  }

  const files = [
    {
      relativePath: MODULE_PATH,
      before: libSource,
      after: transformLib(libSource),
      created: false
    },
    {
      relativePath: STATUS_LINE_PATH,
      before: statusSource,
      after: transformStatusLine(statusSource),
      created: false
    },
    {
      relativePath: I18N_PATH,
      before: null,
      after: i18nSource,
      created: true
    },
    {
      relativePath: I18N_TESTS_PATH,
      before: null,
      after: i18nTestsSource,
      created: true
    }
  ].map((file) => ({
    ...file,
    beforeHash: file.before === null ? null : sha256(file.before),
    afterHash: sha256(file.after)
  }));

  return {
    sourceRoot: resolvedRoot,
    stateRoot,
    files
  };
}

function assertStateInsideSource(sourceRoot, stateRoot) {
  const stateRelative = relative(resolve(sourceRoot), resolve(stateRoot));
  if (
    !stateRelative ||
    stateRelative.startsWith("..") ||
    isAbsolute(stateRelative)
  ) {
    throw new Error("unsafe adapter state path");
  }
}

export async function applyCodexPatch(sourceRoot, options = {}) {
  const plan = await planCodexPatch(sourceRoot, options);
  assertStateInsideSource(plan.sourceRoot, plan.stateRoot);
  const backupsRoot = join(plan.stateRoot, "backups");
  await mkdir(backupsRoot, { recursive: true });

  for (const file of plan.files) {
    if (file.created) {
      continue;
    }
    const backupPath = join(backupsRoot, file.relativePath);
    await mkdir(dirname(backupPath), { recursive: true });
    await writeFile(backupPath, file.before, "utf8");
  }

  const written = [];
  try {
    for (const file of plan.files) {
      const targetPath = join(plan.sourceRoot, file.relativePath);
      await mkdir(dirname(targetPath), { recursive: true });
      await writeFile(targetPath, file.after, "utf8");
      written.push(file);
    }
    const state = {
      schemaVersion: 1,
      targetCommit: TARGET_COMMIT,
      files: plan.files.map((file) => ({
        relativePath: file.relativePath,
        created: file.created,
        beforeHash: file.beforeHash,
        afterHash: file.afterHash
      }))
    };
    await writeFile(
      join(plan.stateRoot, "state.json"),
      JSON.stringify(state, null, 2) + "\n",
      "utf8"
    );
    return state;
  } catch (error) {
    for (const file of written.reverse()) {
      const targetPath = join(plan.sourceRoot, file.relativePath);
      if (file.created) {
        await rm(targetPath, { force: true });
      } else {
        await writeFile(targetPath, file.before, "utf8");
      }
    }
    await rm(plan.stateRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function revertCodexPatch(sourceRoot) {
  const resolvedRoot = resolve(sourceRoot);
  const stateRoot = join(resolvedRoot, STATE_DIRECTORY);
  assertStateInsideSource(resolvedRoot, stateRoot);
  const state = JSON.parse(
    await readFile(join(stateRoot, "state.json"), "utf8")
  );
  const backupsRoot = join(stateRoot, "backups");

  for (const file of state.files) {
    const targetPath = join(resolvedRoot, file.relativePath);
    const current = await readFile(targetPath, "utf8");
    if (sha256(current) !== file.afterHash) {
      throw new Error(
        "patched file changed after apply: " + file.relativePath
      );
    }
  }

  for (const file of state.files) {
    const targetPath = join(resolvedRoot, file.relativePath);
    if (file.created) {
      await rm(targetPath, { force: true });
    } else {
      const backup = await readFile(
        join(backupsRoot, file.relativePath),
        "utf8"
      );
      await writeFile(targetPath, backup, "utf8");
    }
  }
  await rm(stateRoot, { recursive: true, force: true });
}

export async function doctorCodexPatch(
  sourceRoot,
  { verifyGit = true } = {}
) {
  const resolvedRoot = resolve(sourceRoot);
  let sourceCommit = null;
  let supported = null;
  if (verifyGit) {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", resolvedRoot, "rev-parse", "HEAD"],
      { encoding: "utf8" }
    );
    sourceCommit = stdout.trim();
    supported = sourceCommit === TARGET_COMMIT;
  }
  return {
    targetCommit: TARGET_COMMIT,
    sourceCommit,
    supported,
    applied: await pathExists(
      join(resolvedRoot, STATE_DIRECTORY, "state.json")
    )
  };
}
