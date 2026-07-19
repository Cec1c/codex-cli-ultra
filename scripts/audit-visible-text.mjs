import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".upstream/codex");
const sourceRoot = join(root, "codex-rs", "tui", "src");
const include = [
  "app/agent_navigation.rs",
  "app/session_lifecycle.rs",
  "history_cell/session.rs",
  "onboarding/welcome.rs",
  "tooltips.rs",
  "bottom_pane/approval_overlay.rs",
  "bottom_pane/experimental_features_view.rs",
  "bottom_pane/footer.rs",
  "bottom_pane/hooks_browser_view.rs",
  "bottom_pane/list_selection_view.rs",
  "bottom_pane/memories_settings_view.rs",
  "bottom_pane/popup_consts.rs",
  "bottom_pane/selection_popup_common.rs",
  "bottom_pane/status_line_setup.rs",
  "bottom_pane/status_surface_preview.rs",
  "bottom_pane/skills_toggle_view.rs",
  "bottom_pane/title_setup.rs",
  "bottom_pane/slash_commands.rs",
  "chatwidget/connectors.rs",
  "chatwidget/hooks.rs",
  "chatwidget/keymap_picker.rs",
  "chatwidget/language.rs",
  "chatwidget/model_popups.rs",
  "chatwidget/permission_popups.rs",
  "chatwidget/permissions_menu.rs",
  "chatwidget/pets.rs",
  "chatwidget/plugin_catalog.rs",
  "chatwidget/plugins.rs",
  "chatwidget/review_popups.rs",
  "chatwidget/settings_popups.rs",
  "chatwidget/skills.rs",
  "chatwidget/slash_dispatch.rs",
  "chatwidget/usage.rs",
  "history_cell/exec.rs",
  "history_cell/mcp.rs",
  "keymap_setup.rs",
  "keymap_setup/actions.rs",
  "keymap_setup/debug.rs",
  "keymap_setup/picker.rs",
  "multi_agents.rs",
  "pets/picker.rs",
  "resume_picker.rs",
  "theme_picker.rs"
];

const localizationCallPattern = /(?:\.text(?:_with_string_arg)?|approval_text|connectors_text|experimental_text|hooks_text|keymap_(?:count_|debug_|setup_|tab_)?text|mcp_(?:label|text)|memories_text|model_popup_text|pet_picker_text|plugin_text|popup_hint_text|resume_text|review_popup_text|session_text|skills_(?:toggle_)?text|theme_text|usage_text|personality_text|permission_i18n::(?:text|preset_|ask_|approve_|auto_))/;
const localizationKeyPattern = /"(?:agent|approval|apps|auto-review|experimental|footer|hooks|keymap|language|mcp|memories|model|onboarding|permissions|personality|pet|plugins|popup|ps|reasoning|resume|review|selection|session|skills|slash|status|stop|title|tooltip|usage)-[a-z0-9-]+"/;

async function files(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await files(child));
    else if (extname(entry.name) === ".rs") result.push(child);
  }
  return result;
}

function category(path, line) {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.includes("session.rs") || normalized.includes("welcome.rs")) return "welcome";
  if (/tip|hint|help|shortcut|press|restart/i.test(line)) return "tips-help";
  if (normalized.includes("slash_commands") || normalized.includes("slash_dispatch")) return "commands";
  if (/description|placeholder|subtitle|footer/i.test(line)) return "secondary";
  return "other";
}

const candidates = (await files(sourceRoot))
  .filter((path) => include.includes(relative(sourceRoot, path).replaceAll("\\", "/")));
const records = [];
const stringPattern = /"(?:[^"\\]|\\.){3,}"/g;
for (const path of candidates) {
  const source = await readFile(path, "utf8");
  const allLines = source.split(/\r?\n/);
  const testModuleIndex = allLines.findIndex((line) => /^\s*mod tests\s*\{/.test(line));
  const lines = testModuleIndex === -1 ? allLines : allLines.slice(0, testModuleIndex);
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(stringPattern)) {
      const text = match[0].slice(1, -1);
      if (
        text.includes("::") ||
        text.startsWith("tui.") ||
        text.startsWith("status-line-") ||
        text.startsWith("slash-") ||
        /^[a-z0-9_.:/-]+$/i.test(text)
      ) {
        continue;
      }
      const context = lines
        .slice(Math.max(0, index - 6), Math.min(lines.length, index + 3))
        .join("\n");
      const normalizedPath = relative(sourceRoot, path).replaceAll("\\", "/");
      const dynamicKeymapDescriptor =
        normalizedPath === "keymap_setup/actions.rs" &&
        /(?:gated_)?action\("/.test(line);
      records.push({
        category: category(relative(sourceRoot, path), line),
        file: relative(root, path).replaceAll("\\", "/"),
        line: index + 1,
        text,
        likelyLocalized:
          dynamicKeymapDescriptor ||
          localizationCallPattern.test(context) ||
          localizationKeyPattern.test(context)
      });
    }
  }
}
records.sort((left, right) =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.text.localeCompare(right.text)
);
const digest = createHash("sha256")
  .update(JSON.stringify(records))
  .digest("hex");
const counts = Object.fromEntries(
  [...new Set(records.map((record) => record.category))]
    .sort()
    .map((name) => [name, records.filter((record) => record.category === name).length])
);
const likelyLocalized = records.filter((record) => record.likelyLocalized).length;
const reviewCandidates = records.filter((record) => !record.likelyLocalized);
const reviewCountsByFile = Object.fromEntries(
  [...new Set(reviewCandidates.map((record) => record.file))]
    .sort()
    .map((file) => [
      file,
      reviewCandidates.filter((record) => record.file === file).length
    ])
);
process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  root,
  files: candidates.length,
  records: records.length,
  likelyLocalized,
  reviewCandidates: reviewCandidates.length,
  reviewCountsByFile,
  counts,
  sha256: digest,
  samples: records.slice(0, 40),
  reviewSamples: reviewCandidates.slice(0, 80)
}, null, 2) + "\n");
