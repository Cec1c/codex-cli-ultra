import { readFile, realpath, stat } from "node:fs/promises";
import { win32 } from "node:path";

import {
  isAbsoluteLocalWindowsPath,
  isWindowsPathInside,
  PLATFORM,
  windowsPathsEqual
} from "../config/constants.mjs";
import { validateState } from "../state/schema.mjs";

const MANAGED_ENV_KEYS = new Set([
  "codex_ccu_language_pack_root",
  "codex_ultra_locale",
  "codex_ultra_ftl_path",
  "codex_ultra_language_preference_path"
]);

function result(kind, path, reason, notice = null, env = {}) {
  return { kind, path, env: { ...env }, reason, notice };
}

export function buildLaunchEnvironment(baseEnv = {}, selectionEnv = {}) {
  const combined = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!MANAGED_ENV_KEYS.has(key.toLowerCase())) {
      combined[key] = value;
    }
  }
  for (const [key, value] of Object.entries(selectionEnv)) {
    for (const existing of Object.keys(combined)) {
      if (existing.toLowerCase() === key.toLowerCase()) {
        delete combined[existing];
      }
    }
    combined[key] = value;
  }
  return combined;
}

async function defaultReadPackageVersion(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (typeof value?.version !== "string" || value.version.length === 0) {
    throw new Error(`package has no version: ${path}`);
  }
  return value.version;
}

async function readVersion(path, readPackageVersion) {
  try {
    const version = await readPackageVersion(path);
    return typeof version === "string" && version.length > 0
      ? version
      : null;
  } catch {
    return null;
  }
}

async function readFileStat(path, statFile) {
  try {
    const value = await statFile(path);
    if (!value || typeof value !== "object") {
      return null;
    }
    if (typeof value.isFile === "function" && !value.isFile()) {
      return null;
    }
    if (
      !Number.isSafeInteger(value.size) ||
      value.size <= 0 ||
      typeof value.mtimeMs !== "number" ||
      !Number.isFinite(value.mtimeMs) ||
      value.mtimeMs < 0
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

async function canonicalizeLocalPath(path, realpathFile) {
  if (!isAbsoluteLocalWindowsPath(path)) {
    return { kind: "untrusted", path: null };
  }
  let canonical;
  try {
    canonical = await realpathFile(path);
  } catch {
    return { kind: "missing", path: null };
  }
  if (!isAbsoluteLocalWindowsPath(canonical)) {
    return { kind: "untrusted", path: null };
  }
  return { kind: "ok", path: win32.resolve(canonical) };
}

async function canonicalizeInstallRoot(path, realpathFile) {
  if (!isAbsoluteLocalWindowsPath(path)) {
    return { kind: "untrusted", path: null };
  }
  try {
    const canonical = await realpathFile(path);
    if (!isAbsoluteLocalWindowsPath(canonical)) {
      return { kind: "untrusted", path: null };
    }
    return { kind: "ok", path: win32.resolve(canonical) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { kind: "missing", path: win32.resolve(path) };
    }
    return { kind: "untrusted", path: null };
  }
}

function expectedOfficialPaths(packageJsonPath) {
  const platformPackageJsonPath = win32.join(
    win32.dirname(packageJsonPath),
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "package.json"
  );
  return {
    platformPackageJsonPath,
    binaryPath: win32.join(
      win32.dirname(platformPackageJsonPath),
      "vendor",
      PLATFORM,
      "bin",
      "codex.exe"
    )
  };
}

function officialLayoutIsSafe(official, installRoot) {
  if (!official || typeof official !== "object") {
    return false;
  }
  for (const path of [
    official.packageJsonPath,
    official.platformPackageJsonPath,
    official.binaryPath
  ]) {
    if (
      !isAbsoluteLocalWindowsPath(path) ||
      isWindowsPathInside(installRoot, path)
    ) {
      return false;
    }
  }
  const expected = expectedOfficialPaths(official.packageJsonPath);
  return (
    windowsPathsEqual(
      official.platformPackageJsonPath,
      expected.platformPackageJsonPath
    ) && windowsPathsEqual(official.binaryPath, expected.binaryPath)
  );
}

async function inspectOfficial({
  official,
  installRoot,
  readPackageVersion,
  realpathFile,
  statFile
}) {
  if (!officialLayoutIsSafe(official, installRoot)) {
    return {
      rootVersion: null,
      platformVersion: null,
      trusted: false,
      path: null
    };
  }

  const packagePath = await canonicalizeLocalPath(
    official.packageJsonPath,
    realpathFile
  );
  if (
    packagePath.kind !== "ok" ||
    isWindowsPathInside(installRoot, packagePath.path)
  ) {
    return {
      rootVersion: null,
      platformVersion: null,
      trusted: false,
      path: null
    };
  }
  const rootVersion = await readVersion(
    packagePath.path,
    readPackageVersion
  );
  if (rootVersion === null) {
    return {
      rootVersion: null,
      platformVersion: null,
      trusted: false,
      path: null
    };
  }

  const platformPath = await canonicalizeLocalPath(
    official.platformPackageJsonPath,
    realpathFile
  );
  if (platformPath.kind !== "ok") {
    return { rootVersion, platformVersion: null, trusted: false, path: null };
  }
  const canonicalExpected = expectedOfficialPaths(packagePath.path);
  if (
    !windowsPathsEqual(
      platformPath.path,
      canonicalExpected.platformPackageJsonPath
    ) ||
    isWindowsPathInside(installRoot, platformPath.path)
  ) {
    return { rootVersion, platformVersion: null, trusted: false, path: null };
  }
  const platformVersion = await readVersion(
    platformPath.path,
    readPackageVersion
  );
  if (platformVersion === null) {
    return { rootVersion, platformVersion: null, trusted: false, path: null };
  }
  if (platformVersion !== `${rootVersion}-win32-x64`) {
    return { rootVersion, platformVersion, trusted: false, path: null };
  }

  const binaryPath = await canonicalizeLocalPath(
    official.binaryPath,
    realpathFile
  );
  if (
    binaryPath.kind !== "ok" ||
    !windowsPathsEqual(binaryPath.path, canonicalExpected.binaryPath) ||
    isWindowsPathInside(installRoot, binaryPath.path)
  ) {
    return { rootVersion, platformVersion, trusted: false, path: null };
  }
  const binaryStats = await readFileStat(binaryPath.path, statFile);
  return {
    rootVersion,
    platformVersion,
    trusted: binaryStats !== null,
    path: binaryStats === null ? null : binaryPath.path
  };
}

async function inspectUltra(active, installRoot, realpathFile, statFile) {
  const expectedPath = win32.join(
    installRoot,
    "releases",
    active.releaseId,
    active.platform,
    "package",
    "bin",
    "codex.exe"
  );
  if (!windowsPathsEqual(active.binaryPath, expectedPath)) {
    return { valid: false, reason: "ultra-path-untrusted" };
  }
  const binaryPath = await canonicalizeLocalPath(
    active.binaryPath,
    realpathFile
  );
  if (binaryPath.kind === "missing") {
    return { valid: false, reason: "ultra-missing" };
  }
  if (
    binaryPath.kind !== "ok" ||
    !windowsPathsEqual(binaryPath.path, expectedPath) ||
    !isWindowsPathInside(installRoot, binaryPath.path)
  ) {
    return { valid: false, reason: "ultra-path-untrusted" };
  }
  const metadata = await readFileStat(binaryPath.path, statFile);
  if (metadata === null) {
    return { valid: false, reason: "ultra-missing" };
  }
  if (metadata.size !== active.size || metadata.mtimeMs !== active.mtimeMs) {
    return { valid: false, reason: "ultra-metadata-changed" };
  }
  return { valid: true, reason: "ultra-exact-match", path: binaryPath.path };
}

function noticeForUltraFailure(reason, active) {
  if (reason === "ultra-not-installed") {
    return "Codex Ultra: no active Ultra build; run codex-ultra install.";
  }
  return `Codex Ultra: active build ${active.releaseId} is unavailable; run codex-ultra doctor.`;
}

function combineNotices(primary, secondary) {
  if (!primary) return secondary;
  if (!secondary) return primary;
  return `${primary} ${secondary.replace(/^Codex Ultra:\s*/, "")}`;
}

async function selectLanguageEnvironment({ installRoot }) {
  return {
    env: {
      CODEX_CCU_LANGUAGE_PACK_ROOT: win32.join(installRoot, "languages")
    },
    notice: null
  };
}

export async function selectLaunchTarget(options = {}) {
  if (!isAbsoluteLocalWindowsPath(options.installRoot)) {
    return result(
      "error",
      null,
      "no-trusted-binary",
      "Codex Ultra: no trusted Codex binary is available; run codex-ultra doctor."
    );
  }
  const realpathFile = options.realpathFile ?? realpath;
  const canonicalRoot = await canonicalizeInstallRoot(
    options.installRoot,
    realpathFile
  );
  if (canonicalRoot.kind === "untrusted") {
    return result(
      "error",
      null,
      "no-trusted-binary",
      "Codex Ultra: no trusted Codex binary is available; run codex-ultra doctor."
    );
  }
  const installRoot = canonicalRoot.path;

  let state = null;
  if (options.state !== null && options.state !== undefined) {
    try {
      state = validateState(options.state);
    } catch {
      state = null;
    }
  }
  const officialCandidate =
    state === null ? options.recoveredOfficial ?? null : state.official;
  const readPackageVersion =
    options.readPackageVersion ?? defaultReadPackageVersion;
  const statFile = options.statFile ?? stat;
  const official = await inspectOfficial({
    official: officialCandidate,
    installRoot,
    readPackageVersion,
    realpathFile,
    statFile
  });

  if (state === null) {
    if (official.trusted) {
      return result(
        "official",
        official.path,
        "state-unavailable",
        "Codex Ultra: state is unavailable; run codex-ultra doctor."
      );
    }
    return result(
      "error",
      null,
      "no-trusted-binary",
      "Codex Ultra: no trusted Codex binary is available; run codex-ultra doctor."
    );
  }

  const active = state.active;
  if (active === null) {
    if (official.trusted) {
      return result(
        "official",
        official.path,
        "ultra-not-installed",
        noticeForUltraFailure("ultra-not-installed", null)
      );
    }
    return result(
      "error",
      null,
      "no-trusted-binary",
      "Codex Ultra: no trusted Codex binary is available; run codex-ultra doctor."
    );
  }

  const ultra = await inspectUltra(
    active,
    installRoot,
    realpathFile,
    statFile
  );
  if (ultra.valid) {
    const language = await selectLanguageEnvironment({
      locale: state.locale,
      installRoot,
      env: options.env ?? process.env,
      realpathFile,
      statFile
    });
    const officialUnavailable = !official.trusted;
    const officialVersionChanged =
      official.rootVersion !== null &&
      official.rootVersion !== active.upstreamVersion;
    const officialNotice = officialUnavailable
      ? `Codex Ultra: official Codex is unavailable while using ${active.releaseId}; run codex-ultra doctor.`
      : officialVersionChanged
        ? `Codex Ultra: ${active.releaseId} is based on Codex ${active.upstreamVersion} while official Codex ${official.rootVersion} is installed; continuing in optimistic coexistence mode without claiming feature parity.`
      : null;
    return result(
      "ultra",
      ultra.path,
      officialUnavailable
        ? "official-unavailable-ultra-valid"
        : officialVersionChanged
          ? "ultra-optimistic-coexistence"
          : "ultra-exact-match",
      combineNotices(officialNotice, language.notice),
      language.env
    );
  }

  if (official.trusted) {
    return result(
      "official",
      official.path,
      ultra.reason,
      noticeForUltraFailure(ultra.reason, active)
    );
  }
  return result(
    "error",
    null,
    "no-trusted-binary",
    `Codex Ultra: no trusted Codex binary is available for ${active.releaseId}; run codex-ultra doctor.`
  );
}
