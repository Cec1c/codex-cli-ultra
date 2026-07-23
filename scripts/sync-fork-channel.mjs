import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { resolveLatestForkRelease } from "../src/release/github-fork.mjs";
import { buildStableChannel } from "../src/release/stable-channel.mjs";

const latest = await resolveLatestForkRelease({
  token: process.env.GITHUB_TOKEN
});
const output = resolve("release-channels/stable.json");
let existingChannel = null;
try {
  existingChannel = JSON.parse(await readFile(output, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const channel = buildStableChannel({
  latestManifest: latest.manifest,
  existingChannel,
  now: new Date()
});
if (process.argv.includes("--write")) {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(channel, null, 2) + "\n", "utf8");
}
process.stdout.write(JSON.stringify(channel, null, 2) + "\n");
