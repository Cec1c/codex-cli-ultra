import { readFile, readdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

import { parse } from "@fluent/syntax";

const projectRoot = resolve(import.meta.dirname, "..");
const codexRoot = resolve(process.argv[2] ?? ".upstream/codex");
const tuiSourceRoot = join(codexRoot, "codex-rs", "tui", "src");

async function rustFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === "tests" || entry.name === "snapshots") {
      continue;
    }
    const child = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...await rustFiles(child));
    } else if (
      extname(entry.name) === ".rs" &&
      !entry.name.endsWith("_tests.rs") &&
      entry.name !== "i18n_tests.rs"
    ) {
      result.push(child);
    }
  }
  return result;
}

function templateIds(source) {
  const ast = parse(source);
  const junk = ast.body.filter((entry) => entry.type === "Junk");
  if (junk.length > 0) {
    throw new Error("FTL template contains invalid syntax");
  }
  return ast.body
    .filter((entry) => entry.type === "Message")
    .map((entry) => entry.id.name);
}

const [templateSource, catalogSource, files] = await Promise.all([
  readFile(join(projectRoot, "templates", "languages", "messages.en-US.ftl"), "utf8"),
  readFile(
    join(projectRoot, "research", "codex-0.144.5", "tui-messages.jsonl"),
    "utf8"
  ),
  rustFiles(tuiSourceRoot)
]);
const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
const catalogKeys = new Set(
  catalogSource
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line).ftlKey)
);
const ids = templateIds(templateSource);
const dynamicStatusLineEnabled =
  source.includes('format!("status-line-item-{item_id}-name")') &&
  source.includes('format!("status-line-item-{item_id}-description")');
const dynamicKeymapEnabled =
  source.includes('format!("keymap-action-{action_key}-label")') &&
  source.includes('format!("keymap-action-{context_key}-{action_key}-description")') &&
  source.includes('format!("keymap-context-{context_key}-label")') &&
  source.includes('format!("keymap-tab-{tab_id}-{field}")');
const dynamicTitleEnabled =
  source.includes('format!("title-item-{item_id}-name")') &&
  source.includes('format!("title-item-{item_id}-description")');
const coverage = ids.map((id) => {
  if (catalogKeys.has(id)) {
    return { id, source: "catalog" };
  }
  if (id.startsWith("status-line-item-") && dynamicStatusLineEnabled) {
    return { id, source: "dynamic-status-line" };
  }
  if (
    (
      id.startsWith("keymap-action-") ||
      id.startsWith("keymap-context-") ||
      id.startsWith("keymap-tab-")
    ) &&
    dynamicKeymapEnabled
  ) {
    return { id, source: "dynamic-keymap" };
  }
  if (id.startsWith("title-item-") && dynamicTitleEnabled) {
    return { id, source: "dynamic-title" };
  }
  if (source.includes(`"${id}"`)) {
    return { id, source: "runtime-literal" };
  }
  return { id, source: "unused" };
});
const counts = Object.fromEntries(
  [...new Set(coverage.map((entry) => entry.source))]
    .sort()
    .map((name) => [name, coverage.filter((entry) => entry.source === name).length])
);
const unused = coverage
  .filter((entry) => entry.source === "unused")
  .map((entry) => entry.id);

process.stdout.write(JSON.stringify({
  schemaVersion: 1,
  codexRoot,
  templateMessages: ids.length,
  catalogMessages: catalogKeys.size,
  rustFiles: files.length,
  counts,
  unused
}, null, 2) + "\n");

if (unused.length > 0) {
  process.exitCode = 1;
}
