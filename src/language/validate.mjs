import { FluentBundle, FluentResource } from "@fluent/bundle";
import { parse } from "@fluent/syntax";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";

const LOGICAL_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const FLUENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

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
    manifest.i18nApi?.min !== 1 ||
    manifest.i18nApi?.max !== 1 ||
    manifest.catalogVersion !== 1 ||
    !Array.isArray(manifest.fallbackLocales) ||
    !Array.isArray(manifest.resources) ||
    manifest.resources.length !== 1
  ) {
    throw new Error("invalid language pack manifest");
  }
  if (typeof manifest.license !== "string" || !manifest.license.trim()) {
    throw new Error("manifest license must be a non-empty string");
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

function validateCatalog(records, manifest) {
  const seenIds = new Set();
  const seenKeys = new Set();
  let wired = 0;

  for (const record of records) {
    if (record.catalogVersion !== 1 || record.catalogVersion !== manifest.catalogVersion) {
      throw new Error(
        `catalog record ${record.id ?? "<unknown>"} must use catalogVersion 1`
      );
    }
    if (record.mvpStatus !== "wired" && record.mvpStatus !== "catalogued") {
      throw new Error(`unknown mvpStatus ${record.mvpStatus ?? "<missing>"}`);
    }
    if (typeof record.id !== "string" || !LOGICAL_ID_PATTERN.test(record.id)) {
      throw new Error(`invalid logical message id ${record.id ?? "<missing>"}`);
    }
    if (
      typeof record.ftlKey !== "string" ||
      !FLUENT_ID_PATTERN.test(record.ftlKey)
    ) {
      throw new Error(
        `invalid Fluent message id ${record.ftlKey ?? "<missing>"}`
      );
    }
    if (seenIds.has(record.id)) {
      throw new Error(`duplicate catalog id ${record.id}`);
    }
    if (seenKeys.has(record.ftlKey)) {
      throw new Error(`duplicate catalog ftlKey ${record.ftlKey}`);
    }
    seenIds.add(record.id);
    seenKeys.add(record.ftlKey);
    if (record.mvpStatus === "wired") {
      wired += 1;
    }
  }

  if (records.length === 0 || wired === 0) {
    throw new Error("catalog must contain at least one wired record");
  }

  return records.filter((record) => record.mvpStatus === "wired");
}

function assertValidFtl(ftl) {
  let ast;
  try {
    ast = parse(ftl);
  } catch (error) {
    throw new Error(`FTL parse error: ${error.message}`, { cause: error });
  }
  const junk = ast.body.filter((entry) => entry.type === "Junk");
  if (junk.length === 0) {
    return;
  }
  const details = junk
    .flatMap((entry) => entry.annotations ?? [])
    .map((annotation) => annotation.message)
    .join("; ");
  throw new Error(`FTL parse error: ${details || "invalid syntax"}`);
}

function decodeFtl(buffer, label = "messages.ftl") {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new Error(`${label} must be valid UTF-8`, { cause: error });
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

function resourceEntriesById(resource, label) {
  const entries = new Map();
  for (const entry of resource.body) {
    if (typeof entry.id !== "string" || !FLUENT_ID_PATTERN.test(entry.id)) {
      throw new Error(
        `${label} contains invalid message id ${entry.id ?? "<missing>"}`
      );
    }
    if (entries.has(entry.id)) {
      throw new Error(`${label} contains duplicate message id ${entry.id}`);
    }
    if (entry.value == null) {
      throw new Error(`${label} message ${entry.id} must have a value`);
    }
    if (Object.keys(entry.attributes ?? {}).length > 0) {
      throw new Error(`${label} message ${entry.id} must not declare attributes`);
    }
    entries.set(entry.id, entry);
  }
  if (entries.size === 0) {
    throw new Error(`${label} must contain at least one message`);
  }
  return entries;
}

function sortedVariables(entry) {
  return [...collectVariables(entry.value)].sort();
}

function validateTemplateContract({
  templateSource,
  translationEntries,
  translationBundle
}) {
  assertValidFtl(templateSource);
  const templateResource = new FluentResource(templateSource);
  const templateBundle = new FluentBundle("en-US", { useIsolating: false });
  const templateErrors = templateBundle.addResource(templateResource);
  if (templateErrors.length > 0) {
    throw new Error(
      `FTL template resource error: ${templateErrors
        .map((error) => error.message)
        .join("; ")}`
    );
  }
  const templateEntries = resourceEntriesById(templateResource, "FTL template");

  for (const [id, templateEntry] of templateEntries) {
    const translationEntry = translationEntries.get(id);
    if (!translationEntry) {
      throw new Error(`translation is missing template key ${id}`);
    }
    const expectedVariables = sortedVariables(templateEntry);
    const actualVariables = sortedVariables(translationEntry);
    if (expectedVariables.join("\0") !== actualVariables.join("\0")) {
      throw new Error(
        `translation ${id} variables must be [${expectedVariables.join(", ")}], ` +
          `found [${actualVariables.join(", ")}]`
      );
    }
    const message = translationBundle.getMessage(id);
    const samples = Object.fromEntries(
      expectedVariables.map((name) => [name, `sample-${name}`])
    );
    const formatErrors = [];
    const value = translationBundle
      .formatPattern(message.value, samples, formatErrors)
      .trim();
    if (formatErrors.length > 0) {
      throw new Error(
        `failed to format template translation ${id}: ${formatErrors
          .map((error) => error.message)
          .join("; ")}`
      );
    }
    if (!value) {
      throw new Error(`empty template translation for ${id}`);
    }
  }

  for (const id of translationEntries.keys()) {
    if (!templateEntries.has(id)) {
      throw new Error(`translation contains key not declared by template: ${id}`);
    }
  }

  return templateEntries.size;
}

export async function validateLanguagePack({
  packRoot,
  catalogPath,
  templatePath,
  verifyHashes = true
}) {
  const [catalogSource, manifestSource, ftlBuffer, templateBuffer] =
    await Promise.all([
      readFile(catalogPath, "utf8"),
      readFile(join(packRoot, "manifest.json"), "utf8"),
      readFile(join(packRoot, "messages.ftl")),
      templatePath ? readFile(templatePath) : Promise.resolve(null)
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

  const records = parseCatalog(catalogSource);
  const wiredRecords = validateCatalog(records, manifest);
  const ftl = decodeFtl(ftlBuffer);
  assertValidFtl(ftl);
  const fluentResource = new FluentResource(ftl);
  const bundle = new FluentBundle(locale, { useIsolating: false });
  const resourceErrors = bundle.addResource(fluentResource);
  if (resourceErrors.length > 0) {
    throw new Error(
      `FTL resource error: ${resourceErrors
        .map((error) => error.message)
        .join("; ")}`
    );
  }

  const resourceEntries = resourceEntriesById(
    fluentResource,
    "translation resource"
  );
  const messageCount =
    templateBuffer === null
      ? resourceEntries.size
      : validateTemplateContract({
          templateSource: decodeFtl(templateBuffer, "FTL template"),
          translationEntries: resourceEntries,
          translationBundle: bundle
        });
  const messages = {};
  for (const record of wiredRecords) {
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

  const sourceHasher = createHash("sha256")
    .update(catalogSource)
    .update("\0")
    .update(manifestSource)
    .update("\0")
    .update(ftlBuffer);
  if (templateBuffer !== null) {
    sourceHasher.update("\0").update(templateBuffer);
  }
  const sourceHash = sourceHasher.digest("hex");

  return {
    locale,
    messages,
    messageCount,
    sourceHash: `sha256:${sourceHash}`
  };
}
