import { posix, win32 } from "node:path";

const DEFINITIONS = new Map([
  [
    "win32:x64",
    {
      id: "windows-x64",
      nodePlatform: "win32",
      arch: "x64",
      target: "x86_64-pc-windows-msvc",
      officialTarget: "x86_64-pc-windows-msvc",
      npmPackage: "@openai/codex-win32-x64",
      npmSuffix: "win32-x64",
      binaryName: "codex.exe",
      managerName: "ccu-manager.exe",
      installerName: "install.ps1",
      uninstallerName: "uninstall.ps1",
      isWindows: true
    }
  ],
  [
    "linux:x64",
    {
      id: "linux-x64",
      nodePlatform: "linux",
      arch: "x64",
      target: "x86_64-unknown-linux-gnu",
      officialTarget: "x86_64-unknown-linux-musl",
      npmPackage: "@openai/codex-linux-x64",
      npmSuffix: "linux-x64",
      binaryName: "codex",
      managerName: "ccu-manager",
      installerName: "install.sh",
      uninstallerName: "uninstall.sh",
      isWindows: false
    }
  ],
  [
    "linux:arm64",
    {
      id: "linux-arm64",
      nodePlatform: "linux",
      arch: "arm64",
      target: "aarch64-unknown-linux-gnu",
      officialTarget: "aarch64-unknown-linux-musl",
      npmPackage: "@openai/codex-linux-arm64",
      npmSuffix: "linux-arm64",
      binaryName: "codex",
      managerName: "ccu-manager",
      installerName: "install.sh",
      uninstallerName: "uninstall.sh",
      isWindows: false
    }
  ],
  [
    "darwin:x64",
    {
      id: "macos-x64",
      nodePlatform: "darwin",
      arch: "x64",
      target: "x86_64-apple-darwin",
      officialTarget: "x86_64-apple-darwin",
      npmPackage: "@openai/codex-darwin-x64",
      npmSuffix: "darwin-x64",
      binaryName: "codex",
      managerName: "ccu-manager",
      installerName: "install.sh",
      uninstallerName: "uninstall.sh",
      isWindows: false
    }
  ],
  [
    "darwin:arm64",
    {
      id: "macos-arm64",
      nodePlatform: "darwin",
      arch: "arm64",
      target: "aarch64-apple-darwin",
      officialTarget: "aarch64-apple-darwin",
      npmPackage: "@openai/codex-darwin-arm64",
      npmSuffix: "darwin-arm64",
      binaryName: "codex",
      managerName: "ccu-manager",
      installerName: "install.sh",
      uninstallerName: "uninstall.sh",
      isWindows: false
    }
  ]
]);

export function resolveRuntimePlatform(options = {}) {
  const nodePlatform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const definition = DEFINITIONS.get(`${nodePlatform}:${arch}`);
  if (!definition) {
    throw new Error(`unsupported platform: ${nodePlatform} (${arch})`);
  }
  return Object.freeze({ ...definition });
}

export const RUNTIME_PLATFORM = resolveRuntimePlatform();

export function pathApiFor(runtime = RUNTIME_PLATFORM) {
  return runtime.isWindows ? win32 : posix;
}

export function isAbsoluteLocalPath(value, runtime = RUNTIME_PLATFORM) {
  if (typeof value !== "string" || value.includes("\0")) return false;
  if (runtime.isWindows) {
    return /^[A-Za-z]:[\\/]/.test(value) && win32.isAbsolute(value);
  }
  return posix.isAbsolute(value);
}

export function pathIdentity(value, runtime = RUNTIME_PLATFORM) {
  const identity = pathApiFor(runtime).resolve(value);
  return runtime.isWindows ? identity.toLowerCase() : identity;
}

export function pathsEqual(left, right, runtime = RUNTIME_PLATFORM) {
  return pathIdentity(left, runtime) === pathIdentity(right, runtime);
}

export function isPathInside(root, candidate, runtime = RUNTIME_PLATFORM) {
  const pathApi = pathApiFor(runtime);
  const relation = pathApi.relative(
    pathApi.resolve(root),
    pathApi.resolve(candidate)
  );
  return (
    relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relation))
  );
}

function requireHome(env, runtime) {
  const home = env.HOME;
  if (!isAbsoluteLocalPath(home, runtime)) {
    throw new Error("HOME must be an absolute local path");
  }
  return pathApiFor(runtime).resolve(home);
}

export function resolvePlatformInstallRoot(
  env = process.env,
  runtime = RUNTIME_PLATFORM
) {
  const pathApi = pathApiFor(runtime);
  let root;
  if (env.CODEX_ULTRA_HOME) {
    root = pathApi.resolve(env.CODEX_ULTRA_HOME);
  } else if (runtime.isWindows) {
    if (!env.LOCALAPPDATA) {
      throw new Error("LOCALAPPDATA is required on Windows");
    }
    root = pathApi.join(env.LOCALAPPDATA, "codex-cli-ultra");
  } else if (runtime.nodePlatform === "darwin") {
    root = pathApi.join(
      requireHome(env, runtime),
      "Library",
      "Application Support",
      "codex-cli-ultra"
    );
  } else {
    const dataHome = env.XDG_DATA_HOME;
    const base = dataHome
      ? pathApi.resolve(dataHome)
      : pathApi.join(requireHome(env, runtime), ".local", "share");
    root = pathApi.join(base, "codex-cli-ultra");
  }
  if (!isAbsoluteLocalPath(root, runtime)) {
    throw new Error(
      runtime.isWindows
        ? "install root must be on a local Windows drive"
        : "install root must be an absolute local path"
    );
  }
  return pathApi.resolve(root);
}
