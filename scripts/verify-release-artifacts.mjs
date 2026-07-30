import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { validateCcuUpdateManifest } from "../src/release/ccu-update-manifest.mjs";
import { sha256File } from "../src/release/hash.mjs";

const SUPPORTED_PLATFORMS = Object.freeze([
  "windows-x64",
  "linux-x64",
  "linux-arm64",
  "macos-x64",
  "macos-arm64"
]);

function option(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (index === process.argv.length - 1 || process.argv[index + 1].startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return process.argv[index + 1];
}

function options(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    if (index === process.argv.length - 1 || process.argv[index + 1].startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    values.push(process.argv[index + 1]);
  }
  return values;
}

const directory = resolve(option("--directory", "artifacts"));
const version = option("--version");
if (!/^\d+\.\d+\.\d+(?:-alpha\.[1-9]\d*)?$/.test(version ?? "")) {
  throw new Error("--version must be x.y.z or x.y.z-alpha.N");
}
const requested = options("--platform");
const platforms = requested.length === 0 ? SUPPORTED_PLATFORMS : requested;
if (new Set(platforms).size !== platforms.length) {
  throw new Error("--platform values must be unique");
}
for (const platform of platforms) {
  if (!SUPPORTED_PLATFORMS.includes(platform)) {
    throw new Error(`unsupported release platform: ${platform}`);
  }
}

const verified = [];
for (const platform of platforms) {
  const zipName = `codex-cli-ultra-v${version}-${platform}.zip`;
  const manifestName = platform === "windows-x64"
    ? "ccu-update-manifest.json"
    : `ccu-update-manifest-${platform}.json`;
  const zipPath = join(directory, zipName);
  const manifestPath = join(directory, manifestName);
  const sidecarPath = `${zipPath}.sha256`;
  const manifest = validateCcuUpdateManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
    { releaseTag: `v${version}`, platform }
  );
  const [archive, metadata, sidecar] = await Promise.all([
    sha256File(zipPath),
    stat(zipPath),
    readFile(sidecarPath, "ascii")
  ]);
  if (
    manifest.asset.name !== zipName ||
    manifest.asset.size !== metadata.size ||
    manifest.asset.sha256 !== archive.sha256
  ) {
    throw new Error(`${platform} update manifest does not match its archive`);
  }
  const match = sidecar.trim().match(/^([a-f0-9]{64})  (.+)$/);
  if (
    match === null ||
    match[1] !== archive.sha256.slice("sha256:".length) ||
    match[2] !== basename(zipPath)
  ) {
    throw new Error(`${platform} SHA-256 sidecar does not match its archive`);
  }
  verified.push({ platform, zip: zipName, manifest: manifestName, sha256: match[1] });
}

process.stdout.write(`${JSON.stringify({ version, directory, verified }, null, 2)}\n`);
