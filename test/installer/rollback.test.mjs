import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { rollback } from "../../src/installer/rollback.mjs";
import { writeStateAtomic, readState } from "../../src/state/store.mjs";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CATALOG_PATH = join(PROJECT_ROOT, "research/codex-0.144.1/tui-messages.jsonl");
const LANGUAGE_ROOT = join(PROJECT_ROOT, "packages/languages/zh-CN");
const OFFICIAL = {
  version: "0.144.1",
  packageJsonPath: "C:\\npm\\node_modules\\@openai\\codex\\package.json",
  platformPackageVersion: "0.144.1-win32-x64",
  platformPackageJsonPath:
    "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\package.json",
  binaryPath:
    "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"
};

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function buildRecord(installRoot, revision, bytes) {
  const releaseId = `0.144.1-ultra.${revision}`;
  const binaryPath = join(
    installRoot,
    `releases/${releaseId}/x86_64-pc-windows-msvc/package/bin/codex.exe`
  );
  await mkdir(dirname(binaryPath), { recursive: true });
  await writeFile(binaryPath, bytes);
  const metadata = await stat(binaryPath);
  return {
    releaseId,
    upstreamVersion: "0.144.1",
    ultraRevision: revision,
    platform: "x86_64-pc-windows-msvc",
    binaryPath,
    size: bytes.length,
    mtimeMs: metadata.mtimeMs,
    sha256: digest(bytes)
  };
}

async function localeRecord(installRoot) {
  const root = join(installRoot, "languages/zh-CN");
  await mkdir(root, { recursive: true });
  await copyFile(join(LANGUAGE_ROOT, "manifest.json"), join(root, "manifest.json"));
  await copyFile(join(LANGUAGE_ROOT, "messages.ftl"), join(root, "messages.ftl"));
  const bytes = await readFile(join(root, "messages.ftl"));
  const metadata = await stat(join(root, "messages.ftl"));
  return {
    id: "zh-CN",
    manifestPath: join(root, "manifest.json"),
    resourcePath: join(root, "messages.ftl"),
    size: bytes.length,
    mtimeMs: metadata.mtimeMs,
    sha256: digest(bytes)
  };
}

async function fixture() {
  const installRoot = await mkdtemp(join(tmpdir(), "codex-ultra-rollback-"));
  const current = await buildRecord(installRoot, 2, Buffer.from("binary-2"));
  const previous = await buildRecord(installRoot, 1, Buffer.from("binary-1"));
  const locale = await localeRecord(installRoot);
  const state = {
    schemaVersion: 1,
    official: OFFICIAL,
    active: current,
    locale,
    lastKnownGood: { build: previous, locale }
  };
  await writeStateAtomic(join(installRoot, "state.json"), state);
  return { installRoot, current, previous, locale };
}

test("rollback verifies both builds and atomically swaps active and last-known-good", async () => {
  const value = await fixture();
  const next = await rollback({
    installRoot: value.installRoot,
    catalogPath: CATALOG_PATH
  });
  assert.equal(next.active.releaseId, value.previous.releaseId);
  assert.equal(next.locale.id, "zh-CN");
  assert.equal(next.lastKnownGood.build.releaseId, value.current.releaseId);
  assert.equal(
    (await readState(join(value.installRoot, "state.json"))).active.releaseId,
    value.previous.releaseId
  );
});

test("rollback restores English when the recorded language pack is damaged", async () => {
  const value = await fixture();
  await writeFile(value.locale.resourcePath, "damaged");
  const next = await rollback({
    installRoot: value.installRoot,
    catalogPath: CATALOG_PATH
  });
  assert.equal(next.active.releaseId, value.previous.releaseId);
  assert.equal(next.locale, null);
});

test("rollback rejects a changed last-known-good binary without rewriting state", async () => {
  const value = await fixture();
  const statePath = join(value.installRoot, "state.json");
  const before = await readFile(statePath);
  await writeFile(value.previous.binaryPath, "tampered");
  await assert.rejects(
    rollback({ installRoot: value.installRoot, catalogPath: CATALOG_PATH }),
    /installed build metadata changed/
  );
  assert.deepEqual(await readFile(statePath), before);
});
