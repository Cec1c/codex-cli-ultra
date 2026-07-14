import { execFile as execFileCallback } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import {
  delimiter,
  dirname,
  join,
  resolve
} from "node:path";
import { promisify } from "node:util";

import {
  isAbsoluteLocalWindowsPath,
  isWindowsPathInside,
  resolveInstallRoot
} from "../config/constants.mjs";

const execFilePromise = promisify(execFileCallback);
const PLATFORM_PACKAGE = "@openai/codex-win32-x64";
const PLATFORM_SUFFIX = "win32-x64";
const TARGET = "x86_64-pc-windows-msvc";

function parsePackageJson(source, label) {
  let value;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  if (typeof value.version !== "string" || value.version.length === 0) {
    throw new Error(`${label} has no version`);
  }
  return value;
}

function assertOutsideInstallRoot(installRoot, candidate) {
  if (isWindowsPathInside(installRoot, candidate)) {
    throw new Error(
      `official Codex path is inside the Codex Ultra install root: ${candidate}`
    );
  }
}

async function resolveExistingFile(path, label, realpathFile) {
  let canonical;
  try {
    canonical = resolve(await realpathFile(path));
  } catch (error) {
    throw new Error(`${label} is unavailable`, { cause: error });
  }
  if (!isAbsoluteLocalWindowsPath(canonical)) {
    throw new Error(`${label} resolved outside a local Windows drive`);
  }
  return canonical;
}

async function canonicalizeInstallRoot(path, realpathFile) {
  const resolved = resolve(path);
  let canonical;
  try {
    canonical = resolve(await realpathFile(resolved));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return resolved;
    }
    throw new Error("Codex Ultra install root is unsafe", { cause: error });
  }
  if (!isAbsoluteLocalWindowsPath(canonical)) {
    throw new Error("Codex Ultra install root resolved outside a local Windows drive");
  }
  return canonical;
}

function sanitizeExecEnvironment(env, installRoot) {
  const result = {};
  let pathValue;
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() === "path") {
      pathValue = String(value);
    } else {
      result[key] = value;
    }
  }
  if (pathValue !== undefined) {
    const seen = new Set();
    const localEntries = pathValue
      .split(delimiter)
      .map((entry) => entry.trim().replace(/^"(.*)"$/, "$1"))
      .filter((entry) => {
        if (
          !isAbsoluteLocalWindowsPath(entry) ||
          isWindowsPathInside(installRoot, entry)
        ) {
          return false;
        }
        const identity = entry.toLowerCase();
        if (seen.has(identity)) {
          return false;
        }
        seen.add(identity);
        return true;
      })
      .map((entry) => resolve(entry));
    result.PATH = localEntries.join(delimiter);
  }
  return result;
}

async function resolveTrustedNpmCommand({
  env,
  installRoot,
  realpathFile,
  statFile
}) {
  const pathValue = env.PATH ?? "";
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, "npm.cmd");
    if (/[%!^&|<>"\r\n]/.test(candidate)) continue;
    let npmCommand;
    let nodePath;
    let npmCliPath;
    try {
      npmCommand = resolve(await realpathFile(candidate));
      if (
        !isAbsoluteLocalWindowsPath(npmCommand) ||
        isWindowsPathInside(installRoot, npmCommand)
      ) {
        continue;
      }
      const npmDirectory = dirname(npmCommand);
      nodePath = resolve(await realpathFile(join(npmDirectory, "node.exe")));
      npmCliPath = resolve(
        await realpathFile(
          join(npmDirectory, "node_modules", "npm", "bin", "npm-cli.js")
        )
      );
      if (
        !isAbsoluteLocalWindowsPath(nodePath) ||
        !isAbsoluteLocalWindowsPath(npmCliPath) ||
        isWindowsPathInside(installRoot, nodePath) ||
        isWindowsPathInside(installRoot, npmCliPath)
      ) {
        continue;
      }
      const [npmStats, nodeStats, cliStats] = await Promise.all([
        statFile(npmCommand),
        statFile(nodePath),
        statFile(npmCliPath)
      ]);
      if (
        [npmStats, nodeStats, cliStats].some(
          (metadata) =>
            !metadata ||
            (typeof metadata.isFile === "function" && !metadata.isFile()) ||
            (typeof metadata.size === "number" && metadata.size <= 0)
        )
      ) {
        continue;
      }
    } catch {
      continue;
    }
    return { npmCommand, nodePath, npmCliPath };
  }
  throw new Error("no trusted npm.cmd found on the local PATH");
}

async function resolveNpmRoot({
  npmRoot,
  execFile,
  env,
  installRoot,
  realpathFile,
  statFile
}) {
  if (npmRoot !== undefined) {
    return resolve(npmRoot);
  }
  const npm = await resolveTrustedNpmCommand({
    env,
    installRoot,
    realpathFile,
    statFile
  });
  const execEnv = { ...env, PATH: dirname(npm.nodePath) };
  const result = await execFile(
    npm.nodePath,
    [npm.npmCliPath, "root", "-g"],
    {
      env: execEnv,
      encoding: "utf8",
      windowsHide: true
    }
  );
  const stdout =
    typeof result === "string" ? result : String(result?.stdout ?? "");
  const discovered = stdout.trim();
  if (!discovered) {
    throw new Error("npm.cmd root -g returned an empty path");
  }
  return resolve(discovered);
}

export async function discoverOfficialCodex(options = {}) {
  const env = options.env ?? process.env;
  const runExecFile = options.execFile ?? execFilePromise;
  const readFileImpl = options.readFile ?? readFile;
  const realpathImpl = options.realpath ?? realpath;
  const statImpl = options.stat ?? stat;
  const installRoot = await canonicalizeInstallRoot(
    options.installRoot ?? resolveInstallRoot(env),
    realpathImpl
  );
  const npmRoot = await resolveNpmRoot({
    npmRoot: options.npmRoot,
    execFile: runExecFile,
    env: sanitizeExecEnvironment(env, installRoot),
    installRoot,
    realpathFile: realpathImpl,
    statFile: statImpl
  });

  if (!isAbsoluteLocalWindowsPath(installRoot)) {
    throw new Error("install root must be on a local Windows drive");
  }
  if (!isAbsoluteLocalWindowsPath(npmRoot)) {
    throw new Error("npm root must be on a local Windows drive");
  }

  const packageJsonPath = await resolveExistingFile(
    join(npmRoot, "@openai", "codex", "package.json"),
    "official Codex package.json",
    realpathImpl
  );
  assertOutsideInstallRoot(installRoot, packageJsonPath);
  const manifest = parsePackageJson(
    await readFileImpl(packageJsonPath, "utf8"),
    "official Codex package.json"
  );
  if (manifest.name !== "@openai/codex") {
    throw new Error("official Codex package has an unexpected name");
  }
  const expectedPlatformVersion = `${manifest.version}-${PLATFORM_SUFFIX}`;
  const expectedDependency = `npm:@openai/codex@${expectedPlatformVersion}`;
  if (manifest.optionalDependencies?.[PLATFORM_PACKAGE] !== expectedDependency) {
    throw new Error(
      "official package does not declare the exact Windows platform dependency"
    );
  }

  const platformPackageJsonPath = await resolveExistingFile(
    join(
      dirname(packageJsonPath),
      "node_modules",
      "@openai",
      "codex-win32-x64",
      "package.json"
    ),
    "official Windows platform package.json",
    realpathImpl
  );
  assertOutsideInstallRoot(installRoot, platformPackageJsonPath);
  const platformManifest = parsePackageJson(
    await readFileImpl(platformPackageJsonPath, "utf8"),
    "official Windows platform package.json"
  );
  if (platformManifest.name !== "@openai/codex") {
    throw new Error("official Windows platform package has an unexpected name");
  }
  if (platformManifest.version !== expectedPlatformVersion) {
    throw new Error("official Windows platform package version does not match");
  }

  const expectedBinaryPath = join(
    dirname(platformPackageJsonPath),
    "vendor",
    TARGET,
    "bin",
    "codex.exe"
  );
  let binaryPath;
  let binaryStats;
  try {
    binaryPath = resolve(await realpathImpl(expectedBinaryPath));
    if (!isAbsoluteLocalWindowsPath(binaryPath)) {
      throw new Error("binary resolved outside a local Windows drive");
    }
    binaryStats = await statImpl(binaryPath);
  } catch (error) {
    throw new Error("official Codex binary is missing", { cause: error });
  }
  if (
    !binaryStats ||
    (typeof binaryStats.isFile === "function" && !binaryStats.isFile()) ||
    (typeof binaryStats.size === "number" && binaryStats.size <= 0)
  ) {
    throw new Error("official Codex binary is missing");
  }
  assertOutsideInstallRoot(installRoot, binaryPath);

  return {
    version: manifest.version,
    packageJsonPath,
    platformPackageVersion: platformManifest.version,
    platformPackageJsonPath,
    binaryPath
  };
}
