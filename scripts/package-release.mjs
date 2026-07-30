import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import yazl from "yazl";

import { RUNTIME_PLATFORM } from "../src/config/constants.mjs";
import {
  ccuUpdateManifestName,
  validateCcuUpdateManifest
} from "../src/release/ccu-update-manifest.mjs";
import {
  forkManifestName,
  validateForkManifest
} from "../src/release/fork-manifest.mjs";
import { sha256File } from "../src/release/hash.mjs";

const root = resolve(import.meta.dirname, "..");

function option(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  if (index === process.argv.length - 1 || process.argv[index + 1].startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return process.argv[index + 1];
}

function assertChild(parent, candidate, label) {
  const rootPath = resolve(parent);
  const target = resolve(candidate);
  const relation = relative(rootPath, target);
  if (!relation || relation === ".." || relation.startsWith(`..${sep}`)) {
    throw new Error(`${label} must stay inside the output directory`);
  }
  return target;
}

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

async function copy(source, destination, mode = undefined) {
  await cp(source, destination, { recursive: true, force: true });
  if (mode !== undefined && !RUNTIME_PLATFORM.isWindows) {
    const { chmod } = await import("node:fs/promises");
    await chmod(destination, mode);
  }
}

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`release staging contains a symbolic link: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, relativePath));
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    } else {
      throw new Error(`release staging contains an unsupported entry: ${relativePath}`);
    }
  }
  return files;
}

async function createZip(sourceDirectory, destination) {
  const zip = new yazl.ZipFile();
  const rootName = basename(sourceDirectory);
  for (const file of await listFiles(sourceDirectory)) {
    const metadata = await stat(file.absolutePath);
    zip.addFile(file.absolutePath, `${rootName}/${file.relativePath}`, {
      mode: metadata.mode
    });
  }
  await new Promise((resolvePromise, reject) => {
    zip.outputStream
      .pipe(createWriteStream(destination, { flags: "wx" }))
      .once("close", resolvePromise)
      .once("error", reject);
    zip.end();
  });
}

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const version = option("--version", packageJson.version);
if (!/^\d+\.\d+\.\d+(?:-alpha\.[1-9]\d*)?$/.test(version)) {
  throw new Error("--version must be x.y.z or x.y.z-alpha.N");
}
const output = resolve(option("--output", join(root, "artifacts")));
const forkReleaseOption = option("--fork-release-dir");
if (!forkReleaseOption) throw new Error("--fork-release-dir is required");
const forkReleaseDir = resolve(forkReleaseOption);
const skipBuild = process.argv.includes("--skip-build");
await mkdir(output, { recursive: true });

const manifestName = forkManifestName(RUNTIME_PLATFORM);
const forkManifestPath = join(forkReleaseDir, manifestName);
const forkManifest = validateForkManifest(
  JSON.parse(await readFile(forkManifestPath, "utf8")),
  { platform: RUNTIME_PLATFORM.target }
);
const forkAssetPath = join(forkReleaseDir, forkManifest.asset.name);
const forkHash = await sha256File(forkAssetPath);
if (
  forkHash.size !== forkManifest.asset.size ||
  forkHash.sha256 !== forkManifest.asset.sha256
) {
  throw new Error("bundled fork asset size or SHA-256 does not match its manifest");
}

if (!skipBuild) {
  run(RUNTIME_PLATFORM.isWindows ? "npm.cmd" : "npm", ["run", "build"]);
  run("cargo", ["build", "--release", "--locked"], join(root, "tui"));
}

const name = `codex-cli-ultra-v${version}-${RUNTIME_PLATFORM.id}`;
const stage = assertChild(output, join(output, name), "release staging directory");
const zipPath = assertChild(output, join(output, `${name}.zip`), "release ZIP");
const updateManifestPath = assertChild(
  output,
  join(output, ccuUpdateManifestName(RUNTIME_PLATFORM)),
  "CCU update manifest"
);
await rm(stage, { recursive: true, force: true });
await rm(zipPath, { force: true });
await rm(`${zipPath}.sha256`, { force: true });
await mkdir(join(stage, "bin"), { recursive: true });
await mkdir(join(stage, "content", "languages"), { recursive: true });
await mkdir(join(stage, "content", "themes"), { recursive: true });
await mkdir(join(stage, "content", "catalog"), { recursive: true });
await mkdir(join(stage, "fork-release"), { recursive: true });

await copy(join(root, "dist", "codex-ultra.mjs"), join(stage, "bin", "codex-ultra.mjs"));
await copy(join(root, "dist", "launcher.mjs"), join(stage, "bin", "launcher.mjs"));
await copy(
  join(root, "tui", "target", "release", RUNTIME_PLATFORM.managerName),
  join(stage, "bin", RUNTIME_PLATFORM.managerName),
  0o755
);
await copy(
  join(root, "packages", "languages", "zh-CN"),
  join(stage, "content", "languages", "zh-CN")
);
await copy(
  join(root, "packages", "themes", "ccu-hermes"),
  join(stage, "content", "themes", "ccu-hermes")
);
await copy(
  join(root, "research", "codex-0.144.5", "tui-messages.jsonl"),
  join(stage, "content", "catalog", "tui-messages.jsonl")
);
await copy(
  join(root, "templates", "languages", "messages.en-US.ftl"),
  join(stage, "content", "catalog", "messages.en-US.ftl")
);
await copy(join(root, "packages", "quota.example.json"), join(stage, "content", "quota.example.json"));
await copy(forkManifestPath, join(stage, "fork-release", manifestName));
await copy(forkAssetPath, join(stage, "fork-release", forkManifest.asset.name));

if (RUNTIME_PLATFORM.isWindows) {
  for (const name of ["install.ps1", "install.cmd", "uninstall.ps1", "uninstall.cmd"]) {
    await copy(join(root, name), join(stage, name));
  }
} else {
  await copy(join(root, "install.sh"), join(stage, "install.sh"), 0o755);
  await copy(join(root, "uninstall.sh"), join(stage, "uninstall.sh"), 0o755);
}
for (const name of ["README.md", "README.en.md", "LICENSE"]) {
  await copy(join(root, name), join(stage, name));
}

await createZip(stage, zipPath);
const packageHash = await sha256File(zipPath);
await writeFile(
  `${zipPath}.sha256`,
  `${packageHash.sha256.slice("sha256:".length)}  ${basename(zipPath)}\n`,
  "ascii"
);
const updateManifest = validateCcuUpdateManifest({
  schemaVersion: 1,
  type: "codex-cli-ultra-update",
  ccuVersion: version,
  releaseTag: `v${version}`,
  platform: RUNTIME_PLATFORM.id,
  minimumManagerVersion: "0.1.5",
  bundledFork: {
    releaseTag: forkManifest.releaseTag,
    displayVersion: forkManifest.displayVersion,
    upstreamVersion: forkManifest.upstreamVersion,
    i18nApiVersion: forkManifest.i18nApiVersion
  },
  asset: {
    name: basename(zipPath),
    size: packageHash.size,
    sha256: packageHash.sha256
  }
});
await writeFile(updateManifestPath, `${JSON.stringify(updateManifest, null, 2)}\n`, "utf8");

process.stdout.write(`${JSON.stringify({
  version,
  platform: RUNTIME_PLATFORM.id,
  package: stage,
  zip: zipPath,
  sha256: packageHash.sha256.slice("sha256:".length),
  updateManifest: updateManifestPath
})}\n`);
