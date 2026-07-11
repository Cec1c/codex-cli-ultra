import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import {
  extractCatalog,
  writeCatalogArtifacts
} from "./catalog/extract.mjs";
import { MESSAGE_SPECS } from "./catalog/message-specs.mjs";

const USAGE = [
  "Usage:",
  "  node src/cli.mjs catalog extract --source PATH"
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
