import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rm
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep
} from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

function unsafeEntry(message) {
  return new Error(`unsafe ZIP entry: ${message}`);
}

function normalizeEntryName(value) {
  if (typeof value !== "string") {
    throw unsafeEntry("filename is not text");
  }
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw unsafeEntry(value);
  }
  const directory = normalized.endsWith("/");
  const relativeName = directory ? normalized.slice(0, -1) : normalized;
  const segments = relativeName.split("/");
  if (
    relativeName.length === 0 ||
    segments.some((segment) => {
      if (
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        /[:\x00-\x1f]/.test(segment) ||
        /[. ]$/.test(segment)
      ) {
        return true;
      }
      const stem = segment.split(".", 1)[0].toUpperCase();
      return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem);
    })
  ) {
    throw unsafeEntry(value);
  }
  return { directory, relativeName, segments };
}

function isInside(root, candidate) {
  const relation = relative(root, candidate);
  return (
    relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${sep}`) &&
      !isAbsolute(relation))
  );
}

async function prepareDestination(destination) {
  const requested = resolve(destination);
  if (requested === parse(requested).root) {
    throw new Error("destination must not be a filesystem root");
  }
  let metadata;
  try {
    metadata = await lstat(requested);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (metadata) {
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("destination must be an empty directory or missing");
    }
    if ((await readdir(requested)).length !== 0) {
      throw new Error("destination must be an empty directory or missing");
    }
  } else {
    await mkdir(requested);
  }
  const canonical = resolve(await realpath(requested));
  if (canonical === parse(canonical).root) {
    throw new Error("destination must not resolve to a filesystem root");
  }
  return { requested, canonical };
}

function openZip(path) {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(
      path,
      {
        autoClose: false,
        decodeStrings: true,
        lazyEntries: true,
        strictFileNames: false,
        validateEntrySizes: true
      },
      (error, zip) => {
        if (error) reject(error);
        else resolvePromise(zip);
      }
    );
  });
}

function openEntryStream(zip, entry) {
  return new Promise((resolvePromise, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error) reject(error);
      else resolvePromise(stream);
    });
  });
}

async function writeEntry(zip, entry, root, seen) {
  const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
  if (mode === 0o120000) {
    throw new Error(`symlink ZIP entry is not allowed: ${entry.fileName}`);
  }
  const normalized = normalizeEntryName(entry.fileName);
  const identity = normalized.relativeName.toLowerCase();
  if (seen.has(identity)) {
    throw new Error(`duplicate ZIP entry after Windows case folding: ${entry.fileName}`);
  }
  seen.add(identity);

  const output = resolve(root, ...normalized.segments);
  if (!isInside(root, output)) {
    throw unsafeEntry(entry.fileName);
  }
  if (normalized.directory) {
    await mkdir(output, { recursive: true });
    return;
  }

  await mkdir(dirname(output), { recursive: true });
  const handle = await open(output, "wx");
  try {
    const input = await openEntryStream(zip, entry);
    const outputStream = handle.createWriteStream();
    await pipeline(input, outputStream);
  } finally {
    await handle.close().catch(() => {});
  }
}

function extractEntries(zip, root) {
  const seen = new Set();
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      zip.close();
      if (error) reject(error);
      else resolvePromise();
    };
    zip.on("error", (error) => finish(error));
    zip.on("end", () => finish());
    zip.on("entry", (entry) => {
      writeEntry(zip, entry, root, seen).then(
        () => zip.readEntry(),
        (error) => finish(error)
      );
    });
    zip.readEntry();
  });
}

export async function extractZipSecure(zipPath, destination) {
  const prepared = await prepareDestination(destination);
  try {
    const zip = await openZip(zipPath);
    await extractEntries(zip, prepared.canonical);
    return prepared.canonical;
  } catch (error) {
    await rm(prepared.requested, { recursive: true, force: true }).catch(() => {});
    if (
      error?.message?.startsWith("unsafe ZIP entry:") ||
      error?.message?.startsWith("duplicate ZIP entry") ||
      error?.message?.startsWith("symlink ZIP entry")
    ) {
      throw error;
    }
    throw new Error(`unsafe ZIP entry or invalid ZIP archive: ${error.message}`, {
      cause: error
    });
  }
}
