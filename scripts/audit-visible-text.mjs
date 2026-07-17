import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? ".upstream/codex");
const sourceRoot = join(root, "codex-rs", "tui", "src");
const include = [
  "history_cell/session.rs",
  "onboarding/welcome.rs",
  "tooltips.rs",
  "bottom_pane/footer.rs",
  "bottom_pane/status_line_setup.rs",
  "bottom_pane/slash_commands.rs",
  "bottom_pane/list_selection_view.rs",
  "chatwidget/slash_dispatch.rs"
];

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
  for (const [index, line] of source.split(/\r?\n/).entries()) {
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
      records.push({
        category: category(relative(sourceRoot, path), line),
        file: relative(root, path).replaceAll("\\", "/"),
        line: index + 1,
        text
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
process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  root,
  files: candidates.length,
  records: records.length,
  counts,
  sha256: digest,
  samples: records.slice(0, 40)
}, null, 2) + "\n");
