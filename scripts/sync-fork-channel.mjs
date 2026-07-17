import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { resolveLatestForkRelease } from "../src/release/github-fork.mjs";

const latest = await resolveLatestForkRelease({
  token: process.env.GITHUB_TOKEN
});
const channel = {
  schemaVersion: 1,
  channel: "stable",
  source: "Cec1c/codex",
  syncedAt: new Date().toISOString(),
  release: latest.manifest
};
if (process.argv.includes("--write")) {
  const output = resolve("release-channels/stable.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(channel, null, 2) + "\n", "utf8");
}
process.stdout.write(JSON.stringify(channel, null, 2) + "\n");
