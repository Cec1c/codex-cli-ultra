import { readFile, realpath, stat } from "node:fs/promises";

import {
  RUNTIME_PLATFORM,
  isAbsoluteLocalPath,
  isPathInside,
  pathsEqual
} from "../config/constants.mjs";
import { pathApiFor } from "../platform/runtime.mjs";
import { validateState } from "../state/schema.mjs";

const MANAGED_ENV_KEYS = new Set([
  "codex_ccu_language_pack_root",
  "codex_ccu_theme_pack_root",
  "codex_ccu_quota_path",
  "codex_ccu_managed",
  "codex_ccu_manager_path",
  "codex_ccu_manager_version",
  "codex_ccu_update_cache_path",
  "codex_ccu_update_dismissals_dir",
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

async function canonicalizeLocalPath(path, realpathFile, runtime) {
  const pathApi = pathApiFor(runtime);
  if (!isAbsoluteLocalPath(path, runtime)) {
    return { kind: "untrusted", path: null };
  }
  let canonical;
  try {
    canonical = await realpathFile(path);
  } catch {
    return { kind: "missing", path: null };
  }
  if (!isAbsoluteLocalPath(canonical, runtime)) {
    return { kind: "untrusted", path: null };
  }
  return { kind: "ok", path: pathApi.resolve(canonical) };
}

async function canonicalizeInstallRoot(path, realpathFile, runtime) {
  const pathApi = pathApiFor(runtime);
  if (!isAbsoluteLocalPath(path, runtime)) {
    return { kind: "untrusted", path: null };
  }
  try {
    const canonical = await realpathFile(path);
    if (!isAbsoluteLocalPath(canonical, runtime)) {
      return { kind: "untrusted", path: null };
    }
    return { kind: "ok", path: pathApi.resolve(canonical) };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { kind: "missing", path: pathApi.resolve(path) };
    }
    return { kind: "untrusted", path: null };
  }
}

function expectedOfficialPaths(packageJsonPath, runtime) {
  const pathApi = pathApiFor(runtime);
  const platformPackageJsonPath = pathApi.join(
    pathApi.dirname(packageJsonPath),
    "node_modules",
    ...runtime.npmPackage.split("/"),
    "package.json"
  );
  return {
    platformPackageJsonPath,
    binaryPath: pathApi.join(
      pathApi.dirname(platformPackageJsonPath),
      "vendor",
      runtime.target,
      "bin",
      runtime.binaryName
    )
  };
}

function officialLayoutIsSafe(official, installRoot, runtime) {
  if (!official || typeof official !== "object") {
    return false;
  }
  for (const path of [
    official.packageJsonPath,
    official.platformPackageJsonPath,
    official.binaryPath
  ]) {
    if (
      !isAbsoluteLocalPath(path, runtime) ||
      isPathInside(installRoot, path, runtime)
    ) {
      return false;
    }
  }
  const expected = expectedOfficialPaths(official.packageJsonPath, runtime);
  return (
    pathsEqual(
      official.platformPackageJsonPath,
      expected.platformPackageJsonPath,
      runtime
    ) && pathsEqual(official.binaryPath, expected.binaryPath, runtime)
  );
}

async function inspectOfficial({
  official,
  installRoot,
  readPackageVersion,
  realpathFile,
  statFile,
  runtime
}) {
  if (!officialLayoutIsSafe(official, installRoot, runtime)) {
    return {
      rootVersion: null,
      platformVersion: null,
      trusted: false,
      path: null
    };
  }

  const packagePath = await canonicalizeLocalPath(
    official.packageJsonPath,
    realpathFile,
    runtime
  );
  if (
    packagePath.kind !== "ok" ||
    isPathInside(installRoot, packagePath.path, runtime)
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
    realpathFile,
    runtime
  );
  if (platformPath.kind !== "ok") {
    return { rootVersion, platformVersion: null, trusted: false, path: null };
  }
  const canonicalExpected = expectedOfficialPaths(packagePath.path, runtime);
  if (
    !pathsEqual(
      platformPath.path,
      canonicalExpected.platformPackageJsonPath,
      runtime
    ) ||
    isPathInside(installRoot, platformPath.path, runtime)
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
  if (platformVersion !== `${rootVersion}-${runtime.npmSuffix}`) {
    return { rootVersion, platformVersion, trusted: false, path: null };
  }

  const binaryPath = await canonicalizeLocalPath(
    official.binaryPath,
    realpathFile,
    runtime
  );
  if (
    binaryPath.kind !== "ok" ||
    !pathsEqual(binaryPath.path, canonicalExpected.binaryPath, runtime) ||
    isPathInside(installRoot, binaryPath.path, runtime)
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

async function inspectUltra(active, installRoot, realpathFile, statFile, runtime) {
  const pathApi = pathApiFor(runtime);
  const expectedPath = pathApi.join(
    installRoot,
    "releases",
    active.releaseId,
    active.platform,
    "package",
    "bin",
    runtime.binaryName
  );
  if (!pathsEqual(active.binaryPath, expectedPath, runtime)) {
    return { valid: false, reason: "ultra-path-untrusted" };
  }
  const binaryPath = await canonicalizeLocalPath(
    active.binaryPath,
    realpathFile,
    runtime
  );
  if (binaryPath.kind === "missing") {
    return { valid: false, reason: "ultra-missing" };
  }
  if (
    binaryPath.kind !== "ok" ||
    !pathsEqual(binaryPath.path, expectedPath, runtime) ||
    !isPathInside(installRoot, binaryPath.path, runtime)
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

async function selectLanguageEnvironment({ installRoot, runtime }) {
  const pathApi = pathApiFor(runtime);
  return {
    env: {
      CODEX_CCU_LANGUAGE_PACK_ROOT: pathApi.join(installRoot, "languages"),
      CODEX_CCU_THEME_PACK_ROOT: pathApi.join(installRoot, "themes"),
      CODEX_CCU_QUOTA_PATH: pathApi.join(installRoot, "quota.json")
    },
    notice: null
  };
}

export async function selectLaunchTarget(options = {}) {
  const runtime = options.runtime ?? RUNTIME_PLATFORM;
  if (!isAbsoluteLocalPath(options.installRoot, runtime)) {
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
    realpathFile,
    runtime
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
      state = validateState(options.state, { runtime });
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
    statFile,
    runtime
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
    statFile,
    runtime
  );
  if (ultra.valid) {
    const language = await selectLanguageEnvironment({
      locale: state.locale,
      installRoot,
      env: options.env ?? process.env,
      realpathFile,
      statFile,
      runtime
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
