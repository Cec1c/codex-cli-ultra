import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

import {
  extractCatalog,
  writeCatalogArtifacts
} from "./catalog/extract.mjs";
import { MESSAGE_SPECS } from "./catalog/message-specs.mjs";
import { validateLanguagePack } from "./language/validate.mjs";
import {
  applyCodexPatch,
  doctorCodexPatch,
  planCodexPatch,
  revertCodexPatch
} from "./adapter/codex-0.144.4.mjs";

const USAGE = [
  "Usage:",
  "  node src/cli.mjs catalog extract --source PATH",
  "  node src/cli.mjs language validate --pack PATH --catalog PATH [--template PATH]",
  "  node src/cli.mjs adapter plan --source PATH",
  "  node src/cli.mjs adapter apply --source PATH",
  "  node src/cli.mjs adapter revert --source PATH",
  "  node src/cli.mjs doctor --source PATH --pack PATH --catalog PATH [--template PATH]"
].join("\n");

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) {
    return undefined;
  }
  return args[index + 1];
}

export async function runCli(
  args,
  {
    cwd = process.cwd(),
    stdout = process.stdout,
    adapterOptions = {}
  } = {}
) {
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
        "research/codex-0.144.5/tui-messages.jsonl"
      ),
      markdownPath: resolve(
        cwd,
        "docs/i18n/codex-0.144.5-text-inventory.md"
      )
    });
    return { command: "catalog extract", records: records.length };
  }
  if (group === "language" && action === "validate") {
    const catalog = optionValue(args, "--catalog");
    const pack = optionValue(args, "--pack");
    const template = optionValue(args, "--template");
    if (!pack || !catalog) {
      throw new Error("language validate requires --pack PATH --catalog PATH");
    }
    const language = await validateLanguagePack({
      catalogPath: resolve(cwd, catalog),
      packRoot: resolve(cwd, pack),
      templatePath: template ? resolve(cwd, template) : undefined
    });
    const report = {
      command: "language validate",
      locale: language.locale,
      messages: language.messageCount,
      sourceHash: language.sourceHash
    };
    stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report;
  }
  if (
    group === "adapter" &&
    (action === "plan" || action === "apply" || action === "revert")
  ) {
    const source = optionValue(args, "--source");
    if (!source) {
      throw new Error(`adapter ${action} requires --source PATH`);
    }
    const sourceRoot = resolve(cwd, source);
    if (action === "plan") {
      const plan = await planCodexPatch(sourceRoot, adapterOptions);
      const report = {
        command: "adapter plan",
        files: plan.files.map((file) => ({
          relativePath: file.relativePath,
          created: file.created,
          beforeHash: file.beforeHash,
          afterHash: file.afterHash
        }))
      };
      stdout.write(JSON.stringify(report, null, 2) + "\n");
      return report;
    }
    if (action === "apply") {
      await applyCodexPatch(sourceRoot, adapterOptions);
    } else {
      await revertCodexPatch(sourceRoot, adapterOptions);
    }
    return { command: `adapter ${action}`, source: sourceRoot };
  }
  if (group === "doctor") {
    const source = optionValue(args, "--source");
    const pack = optionValue(args, "--pack");
    const catalog = optionValue(args, "--catalog");
    const template = optionValue(args, "--template");
    if (!source || !pack || !catalog) {
      throw new Error(
        "doctor requires --source PATH --pack PATH --catalog PATH"
      );
    }
    const [adapter, language] = await Promise.all([
      doctorCodexPatch(resolve(cwd, source)),
      validateLanguagePack({
        packRoot: resolve(cwd, pack),
        catalogPath: resolve(cwd, catalog),
        templatePath: template ? resolve(cwd, template) : undefined
      })
    ]);
    const report = {
      ...adapter,
      locale: language.locale,
      messages: language.messageCount,
      sourceHash: language.sourceHash
    };
    stdout.write(JSON.stringify(report, null, 2) + "\n");
    return report;
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
