import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildExecutors(options = {}) {
  const outdir = resolve(options.outdir ?? resolve(PROJECT_ROOT, "dist"));
  await mkdir(outdir, { recursive: true });
  return await build({
    absWorkingDir: PROJECT_ROOT,
    entryPoints: {
      launcher: "src/launcher/main.mjs",
      "codex-ultra": "src/manage-main.mjs"
    },
    outdir,
    outExtension: { ".js": ".mjs" },
    platform: "node",
    format: "esm",
    target: "node24",
    bundle: true,
    banner: {
      js: 'import { createRequire as __ccuCreateRequire } from "node:module"; const require = __ccuCreateRequire(import.meta.url);'
    },
    legalComments: "external",
    metafile: true,
    sourcemap: false,
    logLevel: options.logLevel ?? "info"
  });
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  buildExecutors().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
