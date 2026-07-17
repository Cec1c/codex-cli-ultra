import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import yazl from "yazl";

import { extractZipSecure } from "../../src/release/archive.mjs";

async function zipBuffer(entries) {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    if (entry.directory) {
      zip.addEmptyDirectory(entry.name);
    } else {
      zip.addBuffer(Buffer.from(entry.content ?? entry.name), entry.name);
    }
  }
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function replaceZipEntryName(buffer, original, replacement) {
  const from = Buffer.from(original, "utf8");
  const to = Buffer.from(replacement, "utf8");
  assert.equal(to.length, from.length, "replacement ZIP name length must match");
  const result = Buffer.from(buffer);
  let count = 0;
  for (let offset = 0; offset <= result.length - from.length; offset += 1) {
    if (result.subarray(offset, offset + from.length).equals(from)) {
      to.copy(result, offset);
      count += 1;
      offset += from.length - 1;
    }
  }
  assert.equal(count, 2, "ZIP filename should occur in local and central headers");
  return result;
}

function patchZipEntryMode(buffer, filename, mode) {
  const result = Buffer.from(buffer);
  const name = Buffer.from(filename, "utf8");
  let offset = 0;
  while (offset <= result.length - 46) {
    if (result.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const nameLength = result.readUInt16LE(offset + 28);
    const extraLength = result.readUInt16LE(offset + 30);
    const commentLength = result.readUInt16LE(offset + 32);
    const current = result.subarray(offset + 46, offset + 46 + nameLength);
    if (current.equals(name)) {
      result.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, offset + 38);
      return result;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`central directory entry not found: ${filename}`);
}

async function writeZip(root, name, bytes) {
  const path = join(root, name);
  await writeFile(path, bytes);
  return path;
}

test("secure extraction preserves the expected Codex package layout", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-zip-good-"));
  const zipPath = await writeZip(root, "good.zip", await zipBuffer([
    { name: "package/codex-package.json", content: "{}" },
    { name: "package/bin/codex.exe", content: "binary" },
    { name: "package/codex-resources/", directory: true },
    { name: "package/codex-path/rg.exe", content: "rg" },
    { name: "LICENSES/NOTICE", content: "notice" }
  ]));
  const destination = join(root, "extract");

  await extractZipSecure(zipPath, destination);
  assert.equal(await readFile(join(destination, "package/bin/codex.exe"), "utf8"), "binary");
  assert.equal(await readFile(join(destination, "package/codex-path/rg.exe"), "utf8"), "rg");
  assert.equal(await readFile(join(destination, "LICENSES/NOTICE"), "utf8"), "notice");
  assert.deepEqual(await readdir(join(destination, "package/codex-resources")), []);
});

test("secure extraction rejects traversal, absolute, drive, and backslash escapes", async () => {
  const unsafeNames = [
    "../escape",
    "/absolute",
    "C:/drive",
    "dir/../../escape",
    "..\\escape",
    "C:\\drive",
    "\\\\server\\share",
    "package/file:stream",
    "package/CON",
    "package/trailing."
  ];
  for (const [index, unsafeName] of unsafeNames.entries()) {
    const root = await mkdtemp(join(tmpdir(), `codex-ultra-zip-escape-${index}-`));
    const placeholder = "x".repeat(Buffer.byteLength(unsafeName));
    const safeZip = await zipBuffer([{ name: placeholder, content: "escape" }]);
    const malicious = replaceZipEntryName(safeZip, placeholder, unsafeName);
    const zipPath = await writeZip(root, "malicious.zip", malicious);
    const destination = join(root, "extract");
    const outside = join(root, "escape");

    await assert.rejects(
      extractZipSecure(zipPath, destination),
      /unsafe ZIP entry/
    );
    await assert.rejects(readFile(outside), /ENOENT/);
    await assert.rejects(readdir(destination), /ENOENT/);
  }
});

test("secure extraction rejects case-folded duplicate Windows paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-zip-duplicate-"));
  const zipPath = await writeZip(root, "duplicate.zip", await zipBuffer([
    { name: "package/Bin/Codex.exe", content: "first" },
    { name: "package/bin/codex.EXE", content: "second" }
  ]));
  const destination = join(root, "extract");
  await assert.rejects(
    extractZipSecure(zipPath, destination),
    /duplicate ZIP entry/
  );
  await assert.rejects(readdir(destination), /ENOENT/);
});

test("secure extraction rejects Unix symlink entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-zip-symlink-"));
  const filename = "package/link";
  const regular = await zipBuffer([{ name: filename, content: "../outside" }]);
  const symlink = patchZipEntryMode(regular, filename, 0o120777);
  const zipPath = await writeZip(root, "symlink.zip", symlink);
  const destination = join(root, "extract");
  await assert.rejects(
    extractZipSecure(zipPath, destination),
    /symlink ZIP entry/
  );
  await assert.rejects(readdir(destination), /ENOENT/);
});

test("secure extraction refuses a pre-existing non-empty destination without deleting it", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-zip-existing-"));
  const zipPath = await writeZip(root, "good.zip", await zipBuffer([
    { name: "package/bin/codex.exe", content: "binary" }
  ]));
  const destination = join(root, "extract");
  await mkdir(destination);
  const sentinel = join(destination, "keep.txt");
  await writeFile(sentinel, "keep", "utf8");
  await assert.rejects(
    extractZipSecure(zipPath, destination),
    /destination must be an empty directory or missing/
  );
  assert.equal(await readFile(sentinel, "utf8"), "keep");
});
