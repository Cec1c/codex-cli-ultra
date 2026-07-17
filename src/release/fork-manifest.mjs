import { I18N_API_VERSION, PLATFORM } from "../config/constants.mjs";

export const FORK_MANIFEST_NAME = "ccu-fork-manifest.json";

const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;

function assertRecord(value, label) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, expected, label) {
  const actual = Reflect.ownKeys(value);
  const expectedSet = new Set(expected);
  if (
    actual.length !== expected.length ||
    actual.some((key) => typeof key !== "string" || !expectedSet.has(key))
  ) {
    throw new Error(`${label} must contain exactly ${expected.join(", ")}`);
  }
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function safeBasename(value, label) {
  const name = nonEmptyString(value, label);
  const stem = name.split(".", 1)[0].toUpperCase();
  if (
    name === "." ||
    name === ".." ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)
  ) {
    throw new Error(`${label} must be a safe basename`);
  }
  return name;
}

export function validateForkManifest(value, expected = {}) {
  assertRecord(value, "fork manifest");
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "type",
      "releaseTag",
      "displayVersion",
      "upstreamVersion",
      "upstreamTag",
      "upstreamCommit",
      "forkCommit",
      "ultraRevision",
      "i18nApiVersion",
      "platform",
      "asset"
    ],
    "fork manifest"
  );
  if (value.schemaVersion !== 1) {
    throw new Error("unsupported fork manifest schema");
  }
  if (value.type !== "codex-ccu-i18n-build") {
    throw new Error("fork manifest type is not codex-ccu-i18n-build");
  }

  const upstreamVersion = nonEmptyString(
    value.upstreamVersion,
    "upstreamVersion"
  );
  if (!VERSION_PATTERN.test(upstreamVersion)) {
    throw new Error("upstreamVersion must be a stable x.y.z version");
  }
  const ultraRevision = positiveInteger(value.ultraRevision, "ultraRevision");
  const upstreamTag = nonEmptyString(value.upstreamTag, "upstreamTag");
  const releaseTag = nonEmptyString(value.releaseTag, "releaseTag");
  const displayVersion = nonEmptyString(
    value.displayVersion,
    "displayVersion"
  );
  if (upstreamTag !== `rust-v${upstreamVersion}`) {
    throw new Error("upstreamTag does not match upstreamVersion");
  }
  if (releaseTag !== `ccu-rust-v${upstreamVersion}-r${ultraRevision}`) {
    throw new Error("releaseTag does not match the CCU release contract");
  }
  if (displayVersion !== `${upstreamVersion}-ccu.i18n.${ultraRevision}`) {
    throw new Error("displayVersion does not match the CCU version contract");
  }

  const upstreamCommit = nonEmptyString(
    value.upstreamCommit,
    "upstreamCommit"
  );
  const forkCommit = nonEmptyString(value.forkCommit, "forkCommit");
  if (!COMMIT_PATTERN.test(upstreamCommit)) {
    throw new Error("upstreamCommit must be a lowercase 40-character commit");
  }
  if (!COMMIT_PATTERN.test(forkCommit)) {
    throw new Error("forkCommit must be a lowercase 40-character commit");
  }

  const i18nApiVersion = positiveInteger(
    value.i18nApiVersion,
    "i18nApiVersion"
  );
  const platform = nonEmptyString(value.platform, "platform");
  if (i18nApiVersion !== (expected.i18nApiVersion ?? I18N_API_VERSION)) {
    throw new Error("i18nApiVersion is not supported by this CCU build");
  }
  if (platform !== (expected.platform ?? PLATFORM)) {
    throw new Error("platform is not supported by this CCU build");
  }
  if (expected.releaseTag !== undefined && releaseTag !== expected.releaseTag) {
    throw new Error("releaseTag did not match the GitHub Release tag");
  }

  assertRecord(value.asset, "asset");
  assertExactKeys(value.asset, ["name", "size", "sha256"], "asset");
  const asset = {
    name: safeBasename(value.asset.name, "asset.name"),
    size: positiveInteger(value.asset.size, "asset.size"),
    sha256: nonEmptyString(value.asset.sha256, "asset.sha256")
  };
  if (!SHA256_PATTERN.test(asset.sha256)) {
    throw new Error("asset.sha256 must be canonical SHA-256");
  }

  return {
    schemaVersion: 1,
    type: "codex-ccu-i18n-build",
    releaseTag,
    displayVersion,
    upstreamVersion,
    upstreamTag,
    upstreamCommit,
    forkCommit,
    ultraRevision,
    i18nApiVersion,
    platform,
    asset
  };
}

function versionTuple(version) {
  return version.split(".").map((part) => Number(part));
}

export function compareForkReleases(left, right) {
  const a = validateForkManifest(left);
  const b = validateForkManifest(right);
  const leftVersion = versionTuple(a.upstreamVersion);
  const rightVersion = versionTuple(b.upstreamVersion);
  for (let index = 0; index < 3; index += 1) {
    if (leftVersion[index] !== rightVersion[index]) {
      return leftVersion[index] < rightVersion[index] ? -1 : 1;
    }
  }
  return Math.sign(a.ultraRevision - b.ultraRevision);
}
