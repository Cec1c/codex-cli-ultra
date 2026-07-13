import {
  isAbsoluteLocalWindowsPath,
  PLATFORM,
  STATE_SCHEMA_VERSION
} from "../config/constants.mjs";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;

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

function validateNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function validateAbsolutePath(value, label) {
  if (
    typeof value !== "string" ||
    !isAbsoluteLocalWindowsPath(value)
  ) {
    throw new Error(`${label} must be an absolute local Windows drive path`);
  }
  return value;
}

function validatePositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function validateMtime(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return value;
}

function validateSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be canonical SHA-256`);
  }
  return value;
}

function validateLocaleId(value, label) {
  const id = validateNonEmptyString(value, label);
  let canonical;
  try {
    [canonical] = Intl.getCanonicalLocales(id);
  } catch (error) {
    throw new Error(`${label} must be a canonical locale`, { cause: error });
  }
  if (canonical !== id) {
    throw new Error(`${label} must be a canonical locale`);
  }
  return id;
}

function validateOfficial(value) {
  assertRecord(value, "official");
  assertExactKeys(
    value,
    [
      "version",
      "packageJsonPath",
      "platformPackageVersion",
      "platformPackageJsonPath",
      "binaryPath"
    ],
    "official"
  );
  return {
    version: validateNonEmptyString(value.version, "official.version"),
    packageJsonPath: validateAbsolutePath(
      value.packageJsonPath,
      "official.packageJsonPath"
    ),
    platformPackageVersion: validateNonEmptyString(
      value.platformPackageVersion,
      "official.platformPackageVersion"
    ),
    platformPackageJsonPath: validateAbsolutePath(
      value.platformPackageJsonPath,
      "official.platformPackageJsonPath"
    ),
    binaryPath: validateAbsolutePath(
      value.binaryPath,
      "official.binaryPath"
    )
  };
}

function validateBuild(value, label) {
  assertRecord(value, label);
  assertExactKeys(
    value,
    [
      "releaseId",
      "upstreamVersion",
      "ultraRevision",
      "platform",
      "binaryPath",
      "size",
      "mtimeMs",
      "sha256"
    ],
    label
  );
  if (value.platform !== PLATFORM) {
    throw new Error(`${label}.platform must equal ${PLATFORM}`);
  }
  return {
    releaseId: validateNonEmptyString(
      value.releaseId,
      `${label}.releaseId`
    ),
    upstreamVersion: validateNonEmptyString(
      value.upstreamVersion,
      `${label}.upstreamVersion`
    ),
    ultraRevision: validatePositiveSafeInteger(
      value.ultraRevision,
      `${label}.ultraRevision`
    ),
    platform: PLATFORM,
    binaryPath: validateAbsolutePath(
      value.binaryPath,
      `${label}.binaryPath`
    ),
    size: validatePositiveSafeInteger(value.size, `${label}.size`),
    mtimeMs: validateMtime(value.mtimeMs, `${label}.mtimeMs`),
    sha256: validateSha256(value.sha256, `${label}.sha256`)
  };
}

function validateLocale(value, label = "locale") {
  assertRecord(value, label);
  assertExactKeys(
    value,
    ["id", "manifestPath", "resourcePath", "size", "mtimeMs", "sha256"],
    label
  );
  return {
    id: validateLocaleId(value.id, `${label}.id`),
    manifestPath: validateAbsolutePath(
      value.manifestPath,
      `${label}.manifestPath`
    ),
    resourcePath: validateAbsolutePath(
      value.resourcePath,
      `${label}.resourcePath`
    ),
    size: validatePositiveSafeInteger(value.size, `${label}.size`),
    mtimeMs: validateMtime(value.mtimeMs, `${label}.mtimeMs`),
    sha256: validateSha256(value.sha256, `${label}.sha256`)
  };
}

function validateLastKnownGood(value) {
  assertRecord(value, "lastKnownGood");
  assertExactKeys(value, ["build", "locale"], "lastKnownGood");
  return {
    build: validateBuild(value.build, "lastKnownGood.build"),
    locale:
      value.locale === null
        ? null
        : validateLocale(value.locale, "lastKnownGood.locale")
  };
}

export function validateState(value) {
  assertRecord(value, "state");
  assertExactKeys(
    value,
    ["schemaVersion", "official", "active", "locale", "lastKnownGood"],
    "state"
  );
  if (value.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new Error("unsupported state schema");
  }
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    official: validateOfficial(value.official),
    active: value.active === null ? null : validateBuild(value.active, "active"),
    locale: value.locale === null ? null : validateLocale(value.locale),
    lastKnownGood:
      value.lastKnownGood === null
        ? null
        : validateLastKnownGood(value.lastKnownGood)
  };
}
