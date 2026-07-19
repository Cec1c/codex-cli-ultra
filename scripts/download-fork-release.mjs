import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveLatestForkRelease } from "../src/release/github-fork.mjs";
import { FORK_MANIFEST_NAME } from "../src/release/fork-manifest.mjs";
import { sha256File } from "../src/release/hash.mjs";

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return undefined;
  return args[index + 1];
}

const output = resolve(
  optionValue(process.argv.slice(2), "--output") ?? "artifacts/fork-release"
);
const latest = await resolveLatestForkRelease({
  token: process.env.GITHUB_TOKEN
});
await mkdir(output, { recursive: true });
const manifestPath = resolve(output, FORK_MANIFEST_NAME);
const assetPath = resolve(output, latest.manifest.asset.name);
await writeFile(
  manifestPath,
  `${JSON.stringify(latest.manifest, null, 2)}\n`,
  "utf8"
);
await latest.provider.materializeAsset(latest.manifest.asset.name, assetPath);
const actual = await sha256File(assetPath);
if (
  actual.size !== latest.manifest.asset.size ||
  actual.sha256 !== latest.manifest.asset.sha256
) {
  throw new Error("downloaded fork asset did not match its validated manifest");
}
process.stdout.write(`${JSON.stringify({
  releaseTag: latest.manifest.releaseTag,
  displayVersion: latest.manifest.displayVersion,
  manifestPath,
  assetPath,
  sha256: actual.sha256
}, null, 2)}\n`);
