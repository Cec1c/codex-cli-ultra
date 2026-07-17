import {
  CATALOG_VERSION,
  I18N_API_VERSION,
  PLATFORM,
  RELEASE_MANIFEST_SCHEMA_VERSION
} from "../config/constants.mjs";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

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

function validatePositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function validateSha256(value, label) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be canonical SHA-256`);
  }
  return value;
}

function validateSafeBasename(value, label) {
  const name = validateNonEmptyString(value, label);
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

function validateAssetRecord(value, label, nameKey = "name") {
  assertRecord(value, label);
  assertExactKeys(value, [nameKey, "size", "sha256"], label);
  return {
    [nameKey]: validateSafeBasename(value[nameKey], `${label}.${nameKey}`),
    size: validatePositiveSafeInteger(value.size, `${label}.size`),
    sha256: validateSha256(value.sha256, `${label}.sha256`)
  };
}

function validateLocale(value, label) {
  const locale = validateNonEmptyString(value, label);
  let canonical;
  try {
    [canonical] = Intl.getCanonicalLocales(locale);
  } catch (error) {
    throw new Error(`${label} must be a canonical locale`, { cause: error });
  }
  if (canonical !== locale) {
    throw new Error(`${label} must be a canonical locale`);
  }
  return locale;
}

function expectedValue(expected, field, fallback) {
  const value = expected?.[field] ?? fallback;
  if (value === undefined) {
    throw new Error(`expected.${field} is required`);
  }
  return value;
}

function assertCompatibility(actual, expected, field) {
  if (actual !== expected) {
    throw new Error(
      `${field} ${JSON.stringify(actual)} did not match expected ${JSON.stringify(expected)}`
    );
  }
}

export function validateReleaseManifest(value, expected = {}) {
  assertRecord(value, "release manifest");
  assertExactKeys(
    value,
    [
      "schemaVersion",
      "upstreamVersion",
      "upstreamTag",
      "upstreamCommit",
      "ultraRevision",
      "i18nApiVersion",
      "catalogVersion",
      "platform",
      "executor",
      "asset",
      "language",
      "sourceArchive",
      "signature"
    ],
    "release manifest"
  );
  if (value.schemaVersion !== RELEASE_MANIFEST_SCHEMA_VERSION) {
    throw new Error("unsupported release manifest schema");
  }

  const upstreamVersion = validateNonEmptyString(
    value.upstreamVersion,
    "upstreamVersion"
  );
  const upstreamTag = validateNonEmptyString(value.upstreamTag, "upstreamTag");
  const upstreamCommit = validateNonEmptyString(
    value.upstreamCommit,
    "upstreamCommit"
  );
  if (!COMMIT_PATTERN.test(upstreamCommit)) {
    throw new Error("upstreamCommit must be a lowercase 40-character Git commit");
  }
  const ultraRevision = validatePositiveSafeInteger(
    value.ultraRevision,
    "ultraRevision"
  );
  const i18nApiVersion = validatePositiveSafeInteger(
    value.i18nApiVersion,
    "i18nApiVersion"
  );
  const catalogVersion = validatePositiveSafeInteger(
    value.catalogVersion,
    "catalogVersion"
  );
  const platform = validateNonEmptyString(value.platform, "platform");

  assertCompatibility(
    upstreamVersion,
    expectedValue(expected, "upstreamVersion"),
    "upstreamVersion"
  );
  assertCompatibility(
    upstreamTag,
    expectedValue(expected, "upstreamTag"),
    "upstreamTag"
  );
  assertCompatibility(
    upstreamCommit,
    expectedValue(expected, "upstreamCommit"),
    "upstreamCommit"
  );
  assertCompatibility(
    i18nApiVersion,
    expectedValue(expected, "i18nApiVersion", I18N_API_VERSION),
    "i18nApiVersion"
  );
  assertCompatibility(
    catalogVersion,
    expectedValue(expected, "catalogVersion", CATALOG_VERSION),
    "catalogVersion"
  );
  assertCompatibility(
    platform,
    expectedValue(expected, "platform", PLATFORM),
    "platform"
  );

  const executor = validateAssetRecord(value.executor, "executor");
  const asset = validateAssetRecord(value.asset, "asset");
  assertRecord(value.language, "language");
  assertExactKeys(value.language, ["locale", "asset", "size", "sha256"], "language");
  const language = {
    locale: validateLocale(value.language.locale, "language.locale"),
    ...validateAssetRecord(
      {
        asset: value.language.asset,
        size: value.language.size,
        sha256: value.language.sha256
      },
      "language",
      "asset"
    )
  };
  const sourceArchive = validateAssetRecord(
    value.sourceArchive,
    "sourceArchive"
  );
  if (value.signature !== null) {
    throw new Error("signature must be null for release manifest schema 1");
  }

  return {
    schemaVersion: RELEASE_MANIFEST_SCHEMA_VERSION,
    upstreamVersion,
    upstreamTag,
    upstreamCommit,
    ultraRevision,
    i18nApiVersion,
    catalogVersion,
    platform,
    executor,
    asset,
    language,
    sourceArchive,
    signature: null
  };
}
