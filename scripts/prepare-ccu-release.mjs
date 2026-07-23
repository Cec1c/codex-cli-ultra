import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  nextPatchVersion,
  prepareCcuVersion
} from "../src/release/ccu-version.mjs";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8")
);
const result = await prepareCcuVersion({
  root,
  nextVersion: nextPatchVersion(packageJson.version)
});
process.stdout.write(`${JSON.stringify(result)}\n`);
