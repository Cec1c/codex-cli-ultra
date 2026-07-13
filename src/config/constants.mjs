import { join, resolve, win32 } from "node:path";

export const STATE_SCHEMA_VERSION = 1;
export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;
export const LANGUAGE_SCHEMA_VERSION = 1;
export const I18N_API_VERSION = 1;
export const CATALOG_VERSION = 1;
export const PLATFORM = "x86_64-pc-windows-msvc";

export function isAbsoluteLocalWindowsPath(value) {
  return (
    typeof value === "string" &&
    !value.includes("\0") &&
    /^[A-Za-z]:[\\/]/.test(value) &&
    win32.isAbsolute(value)
  );
}

export function resolveInstallRoot(env = process.env) {
  let root;
  if (env.CODEX_ULTRA_HOME) {
    root = resolve(env.CODEX_ULTRA_HOME);
  } else {
    if (!env.LOCALAPPDATA) {
      throw new Error("LOCALAPPDATA is required on Windows");
    }
    root = join(env.LOCALAPPDATA, "codex-cli-ultra");
  }
  if (!isAbsoluteLocalWindowsPath(root)) {
    throw new Error("install root must be on a local Windows drive");
  }
  return root;
}
