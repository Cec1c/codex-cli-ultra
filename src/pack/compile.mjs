import { FluentBundle, FluentResource } from "@fluent/bundle";
import { parse } from "@fluent/syntax";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function parseCatalog(jsonl) {
  return jsonl
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function validateManifest(manifest) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.type !== "language" ||
    typeof manifest.locale !== "string" ||
    manifest.locale.length === 0
  ) {
    throw new Error("invalid language pack manifest");
  }
  const resource = manifest.resources?.find(
    (item) => item.path === "messages.ftl"
  );
  if (!resource || !/^[a-f0-9]{64}$/.test(resource.sha256)) {
    throw new Error("manifest must declare messages.ftl with a SHA-256 hash");
  }
  return resource;
}

function assertValidFtl(ftl) {
  const ast = parse(ftl);
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

export async function compileLanguagePack({ catalogPath, packDir }) {
  const [catalogSource, manifestSource, ftl] = await Promise.all([
    readFile(catalogPath, "utf8"),
    readFile(join(packDir, "manifest.json"), "utf8"),
    readFile(join(packDir, "messages.ftl"), "utf8")
  ]);
  const manifest = JSON.parse(manifestSource);
  const resource = validateManifest(manifest);
  const actualHash = createHash("sha256").update(ftl).digest("hex");
  if (actualHash !== resource.sha256) {
    throw new Error("resource hash mismatch for messages.ftl");
  }

  assertValidFtl(ftl);
  const bundle = new FluentBundle(manifest.locale, { useIsolating: false });
  const resourceErrors = bundle.addResource(new FluentResource(ftl));
  if (resourceErrors.length > 0) {
    throw new Error(
      `FTL resource error: ${resourceErrors.map((error) => error.message).join("; ")}`
    );
  }

  const wiredRecords = parseCatalog(catalogSource)
    .filter((record) => record.mvpStatus === "wired")
    .sort((left, right) => left.id.localeCompare(right.id));
  const messages = {};
  for (const record of wiredRecords) {
    const message = bundle.getMessage(record.ftlKey);
    if (!message?.value) {
      throw new Error(`missing required key ${record.ftlKey}`);
    }
    const formatErrors = [];
    const value = bundle.formatPattern(message.value, null, formatErrors).trim();
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
    .update(ftl)
    .digest("hex");

  return {
    schemaVersion: 1,
    locale: manifest.locale,
    sourceHash: `sha256:${sourceHash}`,
    messages
  };
}
