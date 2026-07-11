import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  extractCatalog,
  writeCatalogArtifacts
} from "./catalog/extract.mjs";
import { MESSAGE_SPECS } from "./catalog/message-specs.mjs";
import { compileLanguagePack } from "./pack/compile.mjs";

const USAGE = [
  "Usage:",
  "  node src/cli.mjs catalog extract --source PATH",
  "  node src/cli.mjs pack compile --catalog PATH --pack PATH --output PATH"
].join("\n");

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) {
    return undefined;
  }
  return args[index + 1];
}

export async function runCli(args, { cwd = process.cwd() } = {}) {
  const [group, action] = args;
  if (group === "catalog" && action === "extract") {
    const source = optionValue(args, "--source");
    if (!source) {
      throw new Error("catalog extract requires --source PATH");
    }
    const records = await extractCatalog(resolve(cwd, source), MESSAGE_SPECS);
    await writeCatalogArtifacts(records, {
      jsonlPath: resolve(
        cwd,
        "research/codex-0.144.1/tui-messages.jsonl"
      ),
      markdownPath: resolve(
        cwd,
        "docs/i18n/codex-0.144.1-text-inventory.md"
      )
    });
    return { command: "catalog extract", records: records.length };
  }
  if (group === "pack" && action === "compile") {
    const catalog = optionValue(args, "--catalog");
    const pack = optionValue(args, "--pack");
    const output = optionValue(args, "--output");
    if (!catalog || !pack || !output) {
      throw new Error(
        "pack compile requires --catalog PATH --pack PATH --output PATH"
      );
    }
    const compiled = await compileLanguagePack({
      catalogPath: resolve(cwd, catalog),
      packDir: resolve(cwd, pack)
    });
    const outputPath = resolve(cwd, output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      JSON.stringify(compiled, null, 2) + "\n",
      "utf8"
    );
    return {
      command: "pack compile",
      locale: compiled.locale,
      messages: Object.keys(compiled.messages).length,
      output: outputPath
    };
  }
  throw new Error(USAGE);
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
