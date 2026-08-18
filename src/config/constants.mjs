import { win32 } from "node:path";

import {
  RUNTIME_PLATFORM,
  isAbsoluteLocalPath,
  isPathInside,
  pathIdentity,
  pathsEqual,
  resolvePlatformInstallRoot,
  resolveRuntimePlatform
} from "../platform/runtime.mjs";

export const STATE_SCHEMA_VERSION = 1;
export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;
export const LANGUAGE_SCHEMA_VERSION = 1;
export const I18N_API_VERSION = 1;
export const CATALOG_VERSION = 1;
export const PLATFORM = RUNTIME_PLATFORM.target;
export { RUNTIME_PLATFORM, isAbsoluteLocalPath, isPathInside, pathsEqual };

export function isAbsoluteLocalWindowsPath(value) {
  return (
    typeof value === "string" &&
    !value.includes("\0") &&
    /^[A-Za-z]:[\\/]/.test(value) &&
    win32.isAbsolute(value)
  );
}

export function windowsPathIdentity(value) {
  return pathIdentity(
    value,
    resolveRuntimePlatform({ platform: "win32", arch: "x64" })
  );
}

export function windowsPathsEqual(left, right) {
  return pathsEqual(
    left,
    right,
    resolveRuntimePlatform({ platform: "win32", arch: "x64" })
  );
}

export function isWindowsPathInside(root, candidate) {
  return isPathInside(
    root,
    candidate,
    resolveRuntimePlatform({ platform: "win32", arch: "x64" })
  );
}

export function resolveInstallRoot(env = process.env, runtime = RUNTIME_PLATFORM) {
  return resolvePlatformInstallRoot(env, runtime);
}
