import { FluentBundle, FluentResource } from "@fluent/bundle";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function parseJson(source, message) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(message, { cause: error });
  }
}

function canonicalLocale(locale, label) {
  if (typeof locale !== "string" || locale.length === 0) {
    throw new Error(`${label} must be a non-empty locale string`);
  }
  let canonical;
  try {
    [canonical] = Intl.getCanonicalLocales(locale);
  } catch (error) {
    throw new Error(`${label} ${locale} is not a valid locale`, {
      cause: error
    });
  }
  if (canonical !== locale) {
    throw new Error(`${label} ${locale} must be canonical as ${canonical}`);
  }
  return canonical;
}

function validateManifest(manifest) {
  if (
    !manifest ||
    typeof manifest !== "object" ||
    Array.isArray(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.type !== "language" ||
    typeof manifest.id !== "string" ||
    manifest.id.length === 0 ||
    typeof manifest.license !== "string" ||
    manifest.license.length === 0 ||
    manifest.i18nApi?.min !== 1 ||
    manifest.i18nApi?.max !== 1 ||
    manifest.catalogVersion !== 1 ||
    !Array.isArray(manifest.fallbackLocales) ||
    !Array.isArray(manifest.resources) ||
    manifest.resources.length !== 1
  ) {
    throw new Error("invalid language pack manifest");
  }

  const locale = canonicalLocale(manifest.locale, "pack locale");
  const seenFallbacks = new Set();
  for (const fallback of manifest.fallbackLocales) {
    const canonical = canonicalLocale(fallback, "fallback locale");
    if (canonical === locale) {
      throw new Error(`fallback locale ${fallback} must not equal pack locale`);
    }
    if (seenFallbacks.has(canonical)) {
      throw new Error(`duplicate fallback locale ${canonical}`);
    }
    seenFallbacks.add(canonical);
  }

  const [resource] = manifest.resources;
  if (
    !resource ||
    typeof resource !== "object" ||
    Array.isArray(resource) ||
    resource.path !== "messages.ftl" ||
    !/^sha256:[a-f0-9]{64}$/.test(resource.sha256)
  ) {
    throw new Error(
      "manifest must declare messages.ftl with a sha256:<64 lowercase hex> hash"
    );
  }

  return { locale, resource };
}

function parseCatalog(source) {
  const records = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      throw new Error(`invalid catalog JSON on line ${index + 1}`, {
        cause: error
      });
    }
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`invalid catalog record on line ${index + 1}`);
    }
    records.push(record);
  }
  return records;
}

function assertFtlParsed(source, resource) {
  const declaredIds = [];
  let hasEntry = false;
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    if (/^[ \t]/.test(line)) {
      if (!hasEntry) {
        throw new Error(`FTL parse error on line ${index + 1}`);
      }
      continue;
    }
    const match = /^(-?[a-zA-Z][\w-]*)\s*=/.exec(line);
    if (!match) {
      throw new Error(`FTL parse error on line ${index + 1}`);
    }
    declaredIds.push(match[1]);
    hasEntry = true;
  }

  const parsedIds = resource.body.map((entry) => entry.id);
  if (
    declaredIds.length !== parsedIds.length ||
    declaredIds.some((id, index) => id !== parsedIds[index])
  ) {
    throw new Error("FTL parse error: one or more entries are malformed");
  }
}

function collectVariables(value, names = new Set()) {
  if (!value || typeof value !== "object") {
    return names;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectVariables(item, names);
    }
    return names;
  }
  if (value.type === "var" && typeof value.name === "string") {
    names.add(value.name);
  }
  for (const nested of Object.values(value)) {
    collectVariables(nested, names);
  }
  return names;
}

function sampleArguments(record) {
  if (!Array.isArray(record.args)) {
    throw new Error(`invalid args for catalog message ${record.id}`);
  }
  const samples = Object.create(null);
  for (const arg of record.args) {
    if (
      !arg ||
      typeof arg !== "object" ||
      Array.isArray(arg) ||
      typeof arg.name !== "string" ||
      arg.name.length === 0 ||
      !Object.hasOwn(arg, "sample")
    ) {
      throw new Error(`invalid args for catalog message ${record.id}`);
    }
    if (Object.hasOwn(samples, arg.name)) {
      throw new Error(`duplicate argument ${arg.name} for catalog message ${record.id}`);
    }
    samples[arg.name] = arg.sample;
  }
  return samples;
}

function validateWiredRecord(record, manifest) {
  if (
    record.catalogVersion !== manifest.catalogVersion ||
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    typeof record.ftlKey !== "string" ||
    record.ftlKey.length === 0
  ) {
    throw new Error(`invalid wired catalog record ${record.id ?? "<unknown>"}`);
  }
}

export async function validateLanguagePack({
  packRoot,
  catalogPath,
  verifyHashes = true
}) {
  const [catalogSource, manifestSource, ftlBuffer] = await Promise.all([
    readFile(catalogPath, "utf8"),
    readFile(join(packRoot, "manifest.json"), "utf8"),
    readFile(join(packRoot, "messages.ftl"))
  ]);
  const manifest = parseJson(
    manifestSource,
    "invalid language pack manifest JSON"
  );
  const { locale, resource: resourceRecord } = validateManifest(manifest);
  const actualResourceHash = `sha256:${createHash("sha256")
    .update(ftlBuffer)
    .digest("hex")}`;
  if (verifyHashes && actualResourceHash !== resourceRecord.sha256) {
    throw new Error("resource hash mismatch for messages.ftl");
  }

  const ftl = ftlBuffer.toString("utf8");
  const fluentResource = new FluentResource(ftl);
  assertFtlParsed(ftl, fluentResource);
  const bundle = new FluentBundle(locale, { useIsolating: false });
  const resourceErrors = bundle.addResource(fluentResource);
  if (resourceErrors.length > 0) {
    throw new Error(
      `FTL resource error: ${resourceErrors
        .map((error) => error.message)
        .join("; ")}`
    );
  }

  const records = parseCatalog(catalogSource);
  const wiredRecords = records.filter((record) => record.mvpStatus === "wired");
  const seenIds = new Set();
  const seenKeys = new Set();
  const resourceEntries = new Map(
    fluentResource.body.map((entry) => [entry.id, entry])
  );
  const messages = {};
  for (const record of wiredRecords) {
    validateWiredRecord(record, manifest);
    if (seenIds.has(record.id)) {
      throw new Error(`duplicate wired catalog id ${record.id}`);
    }
    if (seenKeys.has(record.ftlKey)) {
      throw new Error(`duplicate wired Fluent key ${record.ftlKey}`);
    }
    seenIds.add(record.id);
    seenKeys.add(record.ftlKey);

    const message = bundle.getMessage(record.ftlKey);
    if (message?.value == null) {
      throw new Error(`missing required key ${record.ftlKey}`);
    }
    const samples = sampleArguments(record);
    const variables = collectVariables(resourceEntries.get(record.ftlKey)?.value);
    for (const name of Object.keys(samples)) {
      if (!variables.has(name)) {
        throw new Error(
          `translation ${record.ftlKey} does not use argument ${name}`
        );
      }
    }

    const formatErrors = [];
    const value = bundle
      .formatPattern(message.value, samples, formatErrors)
      .trim();
    if (formatErrors.length > 0) {
      throw new Error(
        `failed to format ${record.ftlKey}: ${formatErrors
          .map((error) => error.message)
          .join("; ")}`
      );
    }
    if (!value) {
      throw new Error(`empty translation for ${record.ftlKey}`);
    }
    messages[record.id] = value;
  }

  const sourceHash = createHash("sha256")
    .update(catalogSource)
    .update("\0")
    .update(manifestSource)
    .update("\0")
    .update(ftlBuffer)
    .digest("hex");

  return { locale, messages, sourceHash: `sha256:${sourceHash}` };
}
