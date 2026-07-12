import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  extractCatalog,
  writeCatalogArtifacts
} from "../src/catalog/extract.mjs";

async function createSourceTree(source) {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-catalog-"));
  const target = join(root, "codex-rs", "tui", "src");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "sample.rs"), source, "utf8");
  return root;
}

const specs = [
  {
    id: "tui.sample.beta",
    ftlKey: "tui--sample--beta",
    surface: "sample",
    kind: "plain",
    translation: "required",
    mvpStatus: "wired",
    path: "codex-rs/tui/src/sample.rs",
    symbol: "Sample::render",
    anchor: '"Beta"',
    english: "Beta"
  },
  {
    id: "tui.sample.alpha",
    ftlKey: "tui--sample--alpha",
    surface: "sample",
    kind: "plain",
    translation: "required",
    mvpStatus: "catalogued",
    path: "codex-rs/tui/src/sample.rs",
    symbol: "Sample::render",
    anchor: '"Alpha"',
    english: "Alpha"
  }
];

test("extractCatalog returns stable records with real line numbers and fingerprints", async () => {
  const sourceRoot = await createSourceTree('fn render() {\n    "Alpha";\n    "Beta";\n}\n');

  const records = await extractCatalog(sourceRoot, specs);

  assert.deepEqual(
    records.map((record) => record.id),
    ["tui.sample.alpha", "tui.sample.beta"]
  );
  assert.equal(records[0].source.line, 2);
  assert.equal(records[1].source.line, 3);
  assert.match(records[0].source.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(records[0].source.release, "rust-v0.144.1");
});

test("extractCatalog rejects a missing exact source anchor", async () => {
  const sourceRoot = await createSourceTree('fn render() {\n    "Alpha";\n}\n');

  await assert.rejects(
    extractCatalog(sourceRoot, [specs[1], specs[0]]),
    /tui\.sample\.beta: expected exactly one source anchor, found 0/
  );
});

test("extractCatalog rejects duplicate exact source anchors", async () => {
  const sourceRoot = await createSourceTree('fn render() {\n    "Alpha";\n    "Alpha";\n}\n');

  await assert.rejects(
    extractCatalog(sourceRoot, [specs[1]]),
    /tui\.sample\.alpha: expected exactly one source anchor, found 2/
  );
});

test("writeCatalogArtifacts emits deterministic JSONL and a Chinese-first report", async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), "codex-ultra-output-"));
  const jsonlPath = join(outputRoot, "catalog.jsonl");
  const markdownPath = join(outputRoot, "catalog.md");
  const sourceRoot = await createSourceTree('fn render() {\n    "Alpha";\n    "Beta";\n}\n');
  const records = await extractCatalog(sourceRoot, specs);

  await writeCatalogArtifacts(records, { jsonlPath, markdownPath });

  const jsonl = await readFile(jsonlPath, "utf8");
  const markdown = await readFile(markdownPath, "utf8");
  assert.equal(jsonl.split("\n").filter(Boolean).length, 2);
  assert.equal(JSON.parse(jsonl.split("\n")[0]).id, "tui.sample.alpha");
  assert.match(markdown, /^# Codex CLI 0\.144\.1 TUI 文本目录/m);
  assert.match(markdown, /## 已接入 MVP \/ Wired in MVP/);
  assert.match(markdown, /tui\.sample\.beta/);
  assert.equal(markdown.endsWith("\n\n"), false);
});
