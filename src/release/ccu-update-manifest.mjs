import { compareStableVersions } from "./github-version.mjs";

export const CCU_UPDATE_MANIFEST_NAME = "ccu-update-manifest.json";
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function string(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function safeName(value, label) {
  const name = string(value, label);
  if (name !== name.split(/[\\/]/).at(-1) || /[<>:"|?*\x00-\x1f]/.test(name)) {
    throw new Error(`${label} must be a safe basename`);
  }
  return name;
}

export function validateCcuUpdateManifest(value, expected = {}) {
  record(value, "CCU update manifest");
  if (value.schemaVersion !== 1 || value.type !== "codex-cli-ultra-update") {
    throw new Error("unsupported CCU update manifest");
  }
  const ccuVersion = string(value.ccuVersion, "ccuVersion");
  if (!VERSION_PATTERN.test(ccuVersion)) {
    throw new Error("ccuVersion must be a stable x.y.z version");
  }
  const releaseTag = string(value.releaseTag, "releaseTag");
  if (releaseTag !== `v${ccuVersion}`) {
    throw new Error("releaseTag does not match ccuVersion");
  }
  if (expected.releaseTag && expected.releaseTag !== releaseTag) {
    throw new Error("manifest releaseTag does not match GitHub Release");
  }
  if (value.platform !== "windows-x64") {
    throw new Error("unsupported CCU update platform");
  }
  const minimumManagerVersion = string(
    value.minimumManagerVersion,
    "minimumManagerVersion"
  );
  if (!VERSION_PATTERN.test(minimumManagerVersion)) {
    throw new Error("minimumManagerVersion must be a stable version");
  }
  const fork = record(value.bundledFork, "bundledFork");
  const asset = record(value.asset, "asset");
  const size = Number(asset.size);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("asset.size must be a positive safe integer");
  }
  const sha256 = string(asset.sha256, "asset.sha256");
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error("asset.sha256 must be canonical SHA-256");
  }
  return {
    schemaVersion: 1,
    type: "codex-cli-ultra-update",
    ccuVersion,
    releaseTag,
    platform: "windows-x64",
    minimumManagerVersion,
    bundledFork: {
      releaseTag: string(fork.releaseTag, "bundledFork.releaseTag"),
      displayVersion: string(fork.displayVersion, "bundledFork.displayVersion"),
      upstreamVersion: string(
        fork.upstreamVersion,
        "bundledFork.upstreamVersion"
      ),
      i18nApiVersion: Number(fork.i18nApiVersion)
    },
    asset: {
      name: safeName(asset.name, "asset.name"),
      size,
      sha256
    }
  };
}

export function managerCanApplyUpdate(currentVersion, manifest) {
  const value = validateCcuUpdateManifest(manifest);
  return compareStableVersions(currentVersion, value.minimumManagerVersion) >= 0;
}
