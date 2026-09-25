import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "@fluent/syntax";

// Verify runtime references against the current pack, independently of the
// historical extraction catalog. Retired keys remain valid for older runtimes.
const projectRoot = resolve(import.meta.dirname, "..");
const codexRoot = resolve(process.argv[2] ?? ".upstream/codex");
const sourceRoot = join(codexRoot, "codex-rs", "tui", "src");
const template = parse(await readFile(join(projectRoot, "templates/languages/messages.en-US.ftl"), "utf8"));
const ids = new Set(template.body.filter((entry) => entry.type === "Message").map((entry) => entry.id.name));
const references = new Map();

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "tests" || entry.name === "snapshots" || entry.name.startsWith("test_") || entry.name.endsWith("_tests.rs")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visit(path);
    } else if (entry.name.endsWith(".rs")) {
      const source = (await readFile(path, "utf8")).split(/#\[cfg\(test\)\]\s*(?:#\[[^\n]+\]\s*)?mod tests/)[0];
      const patterns = [
        /\b(?:[a-z_]*text(?:_with_(?:string_)?args?)?|tr|tr_format)!?\(\s*"([a-z][a-z0-9]*-[a-z0-9-]+)"/g,
        /"tui\.slash-command\.description\.[^"]+"\s*,\s*"([a-z][a-z0-9-]+)"/g,
      ];
      for (const pattern of patterns) {
        for (const match of source.matchAll(pattern)) {
          if (match[1] === "i18n-missing-key") continue; // Deliberate fallback probe.
          references.set(match[1], path.slice(sourceRoot.length + 1).replaceAll("\\", "/"));
        }
      }
    }
  }
}

await visit(sourceRoot);
const missing = [...references].filter(([id]) => !ids.has(id)).map(([id, file]) => ({ id, file }));
process.stdout.write(JSON.stringify({ codexRoot, referencedMessages: references.size, templateMessages: ids.size, missing }, null, 2) + "\n");
if (missing.length > 0) process.exitCode = 1;
