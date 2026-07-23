import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(version) {
  const match = VERSION_PATTERN.exec(version);
  if (!match) throw new Error(`invalid CCU version: ${version}`);
  return match.slice(1).map(Number);
}

export function nextPatchVersion(version) {
  const [major, minor, patch] = parseVersion(version);
  return `${major}.${minor}.${patch + 1}`;
}

function replaceRequired(content, search, replacement, label) {
  if (!content.includes(search)) {
    throw new Error(`${label} does not contain expected value: ${search}`);
  }
  return content.replaceAll(search, replacement);
}

export async function prepareCcuVersion({ root, nextVersion }) {
  parseVersion(nextVersion);
  const packagePath = resolve(root, "package.json");
  const lockPath = resolve(root, "package-lock.json");
  const sourcePath = resolve(root, "src/version.mjs");
  const packageScriptPath = resolve(root, "scripts/package-release.ps1");
  const readmePaths = [resolve(root, "README.md"), resolve(root, "README.en.md")];

  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  const currentVersion = packageJson.version;
  if (nextPatchVersion(currentVersion) !== nextVersion) {
    throw new Error(
      `next version must be the patch after ${currentVersion}: ${nextVersion}`
    );
  }

  const lockJson = JSON.parse(await readFile(lockPath, "utf8"));
  if (
    lockJson.version !== currentVersion ||
    lockJson.packages?.[""]?.version !== currentVersion
  ) {
    throw new Error("package-lock.json version does not match package.json");
  }

  packageJson.version = nextVersion;
  lockJson.version = nextVersion;
  lockJson.packages[""].version = nextVersion;

  const source = replaceRequired(
    await readFile(sourcePath, "utf8"),
    `export const CCU_VERSION = "${currentVersion}";`,
    `export const CCU_VERSION = "${nextVersion}";`,
    "src/version.mjs"
  );
  const packageScript = replaceRequired(
    await readFile(packageScriptPath, "utf8"),
    `[string]$Version = '${currentVersion}'`,
    `[string]$Version = '${nextVersion}'`,
    "scripts/package-release.ps1"
  );
  const readmes = await Promise.all(
    readmePaths.map(async (path) => ({
      path,
      content: replaceRequired(
        await readFile(path, "utf8"),
        `v${currentVersion}`,
        `v${nextVersion}`,
        path
      )
    }))
  );

  await Promise.all([
    writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8"),
    writeFile(lockPath, `${JSON.stringify(lockJson, null, 2)}\n`, "utf8"),
    writeFile(sourcePath, source, "utf8"),
    writeFile(packageScriptPath, packageScript, "utf8"),
    ...readmes.map(({ path, content }) => writeFile(path, content, "utf8"))
  ]);

  return { currentVersion, nextVersion, tag: `v${nextVersion}` };
}
