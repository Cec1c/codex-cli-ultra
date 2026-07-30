import { execFile as execFileCallback } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import {
  RUNTIME_PLATFORM,
  isAbsoluteLocalPath,
  isPathInside,
  resolveInstallRoot
} from "../config/constants.mjs";
import { pathApiFor } from "../platform/runtime.mjs";
import { promisify } from "node:util";

const execFilePromise = promisify(execFileCallback);

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

function assertOutsideInstallRoot(installRoot, candidate, runtime) {
  if (isPathInside(installRoot, candidate, runtime)) {
    throw new Error(
      `official Codex path is inside the Codex Ultra install root: ${candidate}`
    );
  }
}

async function resolveExistingFile(path, label, realpathFile, runtime) {
  const pathApi = pathApiFor(runtime);
  let canonical;
  try {
    canonical = pathApi.resolve(await realpathFile(path));
  } catch (error) {
    throw new Error(`${label} is unavailable`, { cause: error });
  }
  if (!isAbsoluteLocalPath(canonical, runtime)) {
    throw new Error(
      runtime.isWindows
        ? `${label} resolved outside a local Windows drive`
        : `${label} resolved outside an absolute local path`
    );
  }
  return canonical;
}

async function canonicalizeInstallRoot(path, realpathFile, runtime) {
  const pathApi = pathApiFor(runtime);
  const resolved = pathApi.resolve(path);
  let canonical;
  try {
    canonical = pathApi.resolve(await realpathFile(resolved));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return resolved;
    }
    throw new Error("Codex Ultra install root is unsafe", { cause: error });
  }
  if (!isAbsoluteLocalPath(canonical, runtime)) {
    throw new Error(
      runtime.isWindows
        ? "Codex Ultra install root resolved outside a local Windows drive"
        : "Codex Ultra install root resolved outside an absolute local path"
    );
  }
  return canonical;
}

function sanitizeExecEnvironment(env, installRoot, runtime) {
  const pathApi = pathApiFor(runtime);
  const delimiter = runtime.isWindows ? ";" : ":";
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
          !isAbsoluteLocalPath(entry, runtime) ||
          isPathInside(installRoot, entry, runtime)
        ) {
          return false;
        }
        const identity = runtime.isWindows ? entry.toLowerCase() : entry;
        if (seen.has(identity)) {
          return false;
        }
        seen.add(identity);
        return true;
      })
      .map((entry) => pathApi.resolve(entry));
    result.PATH = localEntries.join(delimiter);
  }
  return result;
}

async function resolveTrustedNpmCommand({
  env,
  installRoot,
  allowMissing,
  realpathFile,
  statFile,
  runtime
}) {
  const pathApi = pathApiFor(runtime);
  const delimiter = runtime.isWindows ? ";" : ":";
  const pathValue = env.PATH ?? "";
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = pathApi.join(directory, runtime.isWindows ? "npm.cmd" : "npm");
    if (/[%!^&|<>"\r\n]/.test(candidate)) continue;
    let npmCommand;
    let nodePath;
    let npmCliPath;
    try {
      npmCommand = pathApi.resolve(await realpathFile(candidate));
      if (
        !isAbsoluteLocalPath(npmCommand, runtime) ||
        isPathInside(installRoot, npmCommand, runtime)
      ) {
        continue;
      }
      if (runtime.isWindows) {
        const npmDirectory = pathApi.dirname(npmCommand);
        nodePath = pathApi.resolve(
          await realpathFile(pathApi.join(npmDirectory, "node.exe"))
        );
        npmCliPath = pathApi.resolve(
          await realpathFile(
            pathApi.join(npmDirectory, "node_modules", "npm", "bin", "npm-cli.js")
          )
        );
        if (
          !isAbsoluteLocalPath(nodePath, runtime) ||
          !isAbsoluteLocalPath(npmCliPath, runtime) ||
          isPathInside(installRoot, nodePath, runtime) ||
          isPathInside(installRoot, npmCliPath, runtime)
        ) {
          continue;
        }
      }
      const paths = runtime.isWindows
        ? [npmCommand, nodePath, npmCliPath]
        : [npmCommand];
      const metadataList = await Promise.all(paths.map((path) => statFile(path)));
      if (
        metadataList.some(
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
  if (allowMissing) return null;
  throw new Error(
    runtime.isWindows
      ? "no trusted npm.cmd found on the local PATH"
      : "no trusted npm found on PATH"
  );
}

async function resolveNpmRoot({
  npmRoot,
  execFile,
  env,
  installRoot,
  allowMissing,
  realpathFile,
  statFile,
  runtime
}) {
  const pathApi = pathApiFor(runtime);
  if (npmRoot !== undefined) {
    return pathApi.resolve(npmRoot);
  }
  const npm = await resolveTrustedNpmCommand({
    env,
    installRoot,
    allowMissing,
    realpathFile,
    statFile,
    runtime
  });
  if (npm === null) return null;
  const executable = runtime.isWindows ? npm.nodePath : npm.npmCommand;
  const args = runtime.isWindows ? [npm.npmCliPath, "root", "-g"] : ["root", "-g"];
  const execEnv = runtime.isWindows
    ? { ...env, PATH: pathApi.dirname(npm.nodePath) }
    : env;
  const result = await execFile(
    executable,
    args,
    {
      env: execEnv,
      encoding: "utf8",
      windowsHide: runtime.isWindows
    }
  );
  const stdout =
    typeof result === "string" ? result : String(result?.stdout ?? "");
  const discovered = stdout.trim();
  if (!discovered) {
    throw new Error("npm root -g returned an empty path");
  }
  return pathApi.resolve(discovered);
}

export async function discoverOfficialCodex(options = {}) {
  const runtime = options.runtime ?? RUNTIME_PLATFORM;
  const pathApi = pathApiFor(runtime);
  const env = options.env ?? process.env;
  const runExecFile = options.execFile ?? execFilePromise;
  const readFileImpl = options.readFile ?? readFile;
  const realpathImpl = options.realpath ?? realpath;
  const statImpl = options.stat ?? stat;
  const installRoot = await canonicalizeInstallRoot(
    options.installRoot ?? resolveInstallRoot(env, runtime),
    realpathImpl,
    runtime
  );
  if (!isAbsoluteLocalPath(installRoot, runtime)) {
    throw new Error("install root must be an absolute local path");
  }
  const npmRoot = await resolveNpmRoot({
    npmRoot: options.npmRoot,
    execFile: runExecFile,
    env: sanitizeExecEnvironment(env, installRoot, runtime),
    installRoot,
    allowMissing: options.allowMissing === true,
    realpathFile: realpathImpl,
    statFile: statImpl,
    runtime
  });

  if (npmRoot === null) return null;

  if (!isAbsoluteLocalPath(npmRoot, runtime)) {
    throw new Error("npm root must be an absolute local path");
  }

  let packageJsonPath;
  try {
    packageJsonPath = await resolveExistingFile(
      pathApi.join(npmRoot, "@openai", "codex", "package.json"),
      "official Codex package.json",
      realpathImpl,
      runtime
    );
  } catch (error) {
    if (options.allowMissing === true && error?.cause?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  assertOutsideInstallRoot(installRoot, packageJsonPath, runtime);
  const manifest = parsePackageJson(
    await readFileImpl(packageJsonPath, "utf8"),
    "official Codex package.json"
  );
  if (manifest.name !== "@openai/codex") {
    throw new Error("official Codex package has an unexpected name");
  }
  const expectedPlatformVersion = `${manifest.version}-${runtime.npmSuffix}`;
  const expectedDependency = `npm:@openai/codex@${expectedPlatformVersion}`;
  if (manifest.optionalDependencies?.[runtime.npmPackage] !== expectedDependency) {
    throw new Error(
      runtime.isWindows
        ? "official package does not declare the exact Windows platform dependency"
        : `official package does not declare the exact ${runtime.id} platform dependency`
    );
  }

  const platformPackageJsonPath = await resolveExistingFile(
    pathApi.join(
      pathApi.dirname(packageJsonPath),
      "node_modules",
      ...runtime.npmPackage.split("/"),
      "package.json"
    ),
    `official ${runtime.id} platform package.json`,
    realpathImpl,
    runtime
  );
  assertOutsideInstallRoot(installRoot, platformPackageJsonPath, runtime);
  const platformManifest = parsePackageJson(
    await readFileImpl(platformPackageJsonPath, "utf8"),
    `official ${runtime.id} platform package.json`
  );
  if (platformManifest.name !== "@openai/codex") {
    throw new Error(`official ${runtime.id} platform package has an unexpected name`);
  }
  if (platformManifest.version !== expectedPlatformVersion) {
    throw new Error(`official ${runtime.id} platform package version does not match`);
  }

  const expectedBinaryPath = pathApi.join(
    pathApi.dirname(platformPackageJsonPath),
    "vendor",
    runtime.officialTarget,
    "bin",
    runtime.binaryName
  );
  let binaryPath;
  let binaryStats;
  try {
    binaryPath = pathApi.resolve(await realpathImpl(expectedBinaryPath));
    if (!isAbsoluteLocalPath(binaryPath, runtime)) {
      throw new Error("binary resolved outside an absolute local path");
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
  assertOutsideInstallRoot(installRoot, binaryPath, runtime);

  return {
    version: manifest.version,
    packageJsonPath,
    platformPackageVersion: platformManifest.version,
    platformPackageJsonPath,
    binaryPath
  };
}

export async function discoverOptionalOfficialCodex(options = {}) {
  return await discoverOfficialCodex({ ...options, allowMissing: true });
}
