import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const UPDATE_CACHE_SCHEMA_VERSION = 1;
const STABLE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export function updateCachePath(installRoot) {
  return join(installRoot, "update-cache.json");
}

export function dismissalsDirectory(installRoot) {
  return join(installRoot, "update-dismissals");
}

export function validateStableVersion(value, label = "version") {
  if (typeof value !== "string" || !STABLE_VERSION_PATTERN.test(value)) {
    throw new Error(`${label} must be a stable x.y.z version`);
  }
  return value;
}

export function validateUpdateCache(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("update cache must be an object");
  }
  if (value.schemaVersion !== UPDATE_CACHE_SCHEMA_VERSION) {
    throw new Error("unsupported update cache schema");
  }
  const checkedAt = new Date(value.checkedAt);
  if (!Number.isFinite(checkedAt.getTime())) {
    throw new Error("update cache checkedAt must be an ISO timestamp");
  }
  const latestCcuVersion = validateStableVersion(
    value.latestCcuVersion,
    "latestCcuVersion"
  );
  if (value.latestCcuTag !== `v${latestCcuVersion}`) {
    throw new Error("latestCcuTag does not match latestCcuVersion");
  }
  return {
    schemaVersion: UPDATE_CACHE_SCHEMA_VERSION,
    checkedAt: checkedAt.toISOString(),
    latestCcuVersion,
    latestCcuTag: value.latestCcuTag,
    packageReady: value.packageReady === true,
    releaseUrl: typeof value.releaseUrl === "string" ? value.releaseUrl : null,
    updateManifestUrl:
      typeof value.updateManifestUrl === "string"
        ? value.updateManifestUrl
        : null,
    bundledForkVersion:
      typeof value.bundledForkVersion === "string"
        ? value.bundledForkVersion
        : null,
    bundledUpstreamVersion:
      typeof value.bundledUpstreamVersion === "string"
        ? value.bundledUpstreamVersion
        : null,
    checkedWithProxy: value.checkedWithProxy === true
  };
}

export async function readUpdateCache(installRoot, fsOps = {}) {
  const read = fsOps.readFile ?? readFile;
  try {
    return validateUpdateCache(
      JSON.parse(await read(updateCachePath(installRoot), "utf8"))
    );
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeUpdateCacheAtomic(installRoot, value, fsOps = {}) {
  const cache = validateUpdateCache(value);
  const target = updateCachePath(installRoot);
  const temporary = `${target}.tmp-${randomUUID()}`;
  const makeDirectory = fsOps.mkdir ?? mkdir;
  const write = fsOps.writeFile ?? writeFile;
  const move = fsOps.rename ?? rename;
  const remove = fsOps.rm ?? rm;
  await makeDirectory(dirname(target), { recursive: true });
  try {
    await write(temporary, `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await move(temporary, target);
  } catch (error) {
    await remove(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return cache;
}

export function updateCheckIsDue(cache, settings, now = new Date()) {
  if (!settings.updates.checkOnStartup) return false;
  if (cache === null) return true;
  if (!cache.packageReady) return true;
  const intervalMs = settings.updates.checkIntervalHours * 60 * 60 * 1000;
  return now.getTime() - new Date(cache.checkedAt).getTime() >= intervalMs;
}

function dismissalPath(installRoot, version) {
  return join(
    dismissalsDirectory(installRoot),
    `${validateStableVersion(version)}.dismissed`
  );
}

export async function dismissUpdateVersion(installRoot, version, fsOps = {}) {
  const makeDirectory = fsOps.mkdir ?? mkdir;
  const openFile = fsOps.open ?? open;
  const directory = dismissalsDirectory(installRoot);
  await makeDirectory(directory, { recursive: true });
  try {
    const handle = await openFile(dismissalPath(installRoot, version), "wx");
    await handle.close();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return { version: validateStableVersion(version), dismissed: true };
}

export async function isUpdateVersionDismissed(installRoot, version, fsOps = {}) {
  const read = fsOps.readFile ?? readFile;
  try {
    await read(dismissalPath(installRoot, version));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
