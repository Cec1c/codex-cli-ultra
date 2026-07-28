import { createReadStream } from "node:fs";
import {
  open,
  readFile,
  realpath,
  rm,
  stat
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Readable } from "node:stream";

const MANIFEST_NAME = "release-manifest.json";
const MAX_REDIRECTS = 5;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const AUTHORIZATION_HOSTS = new Set(["github.com", "api.github.com"]);

function isAllowedGitHubHost(hostname) {
  return (
    AUTHORIZATION_HOSTS.has(hostname) ||
    hostname === "objects.githubusercontent.com" ||
    hostname === "githubusercontent.com" ||
    hostname.endsWith(".githubusercontent.com")
  );
}

function validateHttpsGitHubUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error(`${label} must be a valid HTTPS URL`, { cause: error });
  }
  if (url.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain URL credentials`);
  }
  if (url.port && url.port !== "443") {
    throw new Error(`${label} must use the default HTTPS port`);
  }
  if (!isAllowedGitHubHost(url.hostname.toLowerCase())) {
    throw new Error(`${label} host is not allowed`);
  }
  return url;
}

function validateAssetName(value) {
  const stem = typeof value === "string"
    ? value.split(".", 1)[0].toUpperCase()
    : "";
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    /[<>:"/\\|?*\x00-\x1f]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)
  ) {
    throw new Error("asset name must be a safe basename");
  }
  return value;
}

function isPathInside(root, candidate) {
  const relation = relative(root, candidate);
  return (
    relation === "" ||
    (relation !== ".." &&
      !relation.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(relation))
  );
}

function parseContentLength(headers) {
  const value = headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : null;
}

export function createDownloadProgressReporter(options = {}) {
  const startedAt = options.now?.() ?? Date.now();
  const now = options.now ?? Date.now;
  const onProgress = options.onProgress ?? (() => {});
  const totalBytes = Number.isSafeInteger(options.totalBytes)
    ? options.totalBytes
    : null;
  const initialBytes = options.initialBytes ?? 0;
  const samples = [{ at: startedAt, bytes: initialBytes }];
  let lastEmittedAt = 0;
  return (transferredBytes, force = false) => {
    const at = now();
    samples.push({ at, bytes: transferredBytes });
    while (samples.length > 2 && samples[0].at < at - 3_000) samples.shift();
    if (!force && at - lastEmittedAt < 150) return;
    lastEmittedAt = at;
    const window = samples.at(-1);
    const base = samples[0];
    const windowSeconds = Math.max((window.at - base.at) / 1_000, 0.001);
    const instantBytesPerSecond = Math.max(
      0,
      (window.bytes - base.bytes) / windowSeconds
    );
    const elapsedSeconds = Math.max((at - startedAt) / 1_000, 0.001);
    const averageBytesPerSecond = Math.max(
      0,
      (transferredBytes - initialBytes) / elapsedSeconds
    );
    const speed = instantBytesPerSecond || averageBytesPerSecond;
    const remaining = totalBytes === null
      ? null
      : Math.max(0, totalBytes - transferredBytes);
    onProgress({
      phase: "download",
      transferredBytes,
      totalBytes,
      percent:
        totalBytes === null
          ? null
          : Math.min(100, (transferredBytes / totalBytes) * 100),
      instantBytesPerSecond,
      averageBytesPerSecond,
      etaSeconds: remaining === null || speed <= 0 ? null : remaining / speed
    });
  };
}

async function writeReadable(readable, destination, options = {}) {
  const target = resolve(destination);
  let handle = null;
  try {
    handle = await open(target, options.append ? "a" : "wx");
    const report = createDownloadProgressReporter({
      totalBytes: options.totalBytes,
      initialBytes: options.initialBytes,
      onProgress: options.onProgress,
      now: options.now
    });
    let transferredBytes = options.initialBytes ?? 0;
    report(transferredBytes, true);
    for await (const chunk of readable) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      await handle.write(bytes);
      transferredBytes += bytes.length;
      if (
        Number.isSafeInteger(options.totalBytes) &&
        transferredBytes > options.totalBytes
      ) {
        throw new Error("download exceeded the expected asset size");
      }
      report(transferredBytes);
    }
    report(transferredBytes, true);
  } catch (error) {
    if (handle !== null) {
      await handle.close().catch(() => {});
      if (!options.keepPartial) {
        await rm(target, { force: true }).catch(() => {});
      }
    }
    throw error;
  }
  await handle.close().catch(() => {});
  return target;
}

async function parseManifestText(source, label) {
  if (Buffer.byteLength(source, "utf8") > MAX_MANIFEST_BYTES) {
    throw new Error(`${label} exceeds the manifest size limit`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

async function readManifestResponse(response) {
  if (response.body === null) {
    throw new Error("release manifest HTTP response has no body");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_MANIFEST_BYTES) {
      throw new Error("release manifest exceeds the manifest size limit");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export class DirectoryReleaseProvider {
  constructor(root, { manifestName = MANIFEST_NAME } = {}) {
    this.root = resolve(root);
    this.manifestName = validateAssetName(manifestName);
  }

  async #resolveSource(name, label) {
    const basename = validateAssetName(name);
    const canonicalRoot = resolve(await realpath(this.root));
    const candidate = resolve(await realpath(join(canonicalRoot, basename)));
    if (!isPathInside(canonicalRoot, candidate)) {
      throw new Error(`${label} resolved outside the release directory`);
    }
    const metadata = await stat(candidate);
    if (!metadata.isFile()) {
      throw new Error(`${label} must be a file`);
    }
    return candidate;
  }

  async readManifest() {
    const path = await this.#resolveSource(
      this.manifestName,
      "release manifest"
    );
    return await parseManifestText(
      await readFile(path, "utf8"),
      "release manifest"
    );
  }

  async materializeAsset(name, destination, options = {}) {
    const source = await this.#resolveSource(name, "release asset");
    const metadata = await stat(source);
    return await writeReadable(createReadStream(source), destination, {
      totalBytes: options.expectedSize ?? metadata.size,
      onProgress: options.onProgress,
      now: options.now
    });
  }
}

export class HttpReleaseProvider {
  constructor({
    manifestUrl,
    fetchImpl = fetch,
    headers = {},
    manifestTimeoutMs = 15_000,
    assetTimeoutMs = 300_000
  }) {
    this.manifestUrl = validateHttpsGitHubUrl(manifestUrl, "manifest URL");
    this.fetchImpl = fetchImpl;
    this.headers = new Headers(headers);
    this.manifestTimeoutMs = manifestTimeoutMs;
    this.assetTimeoutMs = assetTimeoutMs;
  }

  #requestHeaders(url, extraHeaders = {}) {
    const headers = new Headers(this.headers);
    for (const [key, value] of new Headers(extraHeaders)) {
      headers.set(key, value);
    }
    if (!AUTHORIZATION_HOSTS.has(url.hostname.toLowerCase())) {
      headers.delete("authorization");
    }
    return headers;
  }

  async #fetch(url, timeoutMs, extraHeaders = {}) {
    let current = validateHttpsGitHubUrl(url, "request URL");
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await this.fetchImpl(current, {
        method: "GET",
        headers: this.#requestHeaders(current, extraHeaders),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirectCount === MAX_REDIRECTS) {
          throw new Error("too many HTTP redirects");
        }
        const location = response.headers.get("location");
        if (!location) {
          throw new Error(`HTTP ${response.status} redirect has no Location`);
        }
        let next;
        try {
          next = new URL(location, current);
        } catch (error) {
          throw new Error("redirect URL is invalid", { cause: error });
        }
        if (next.protocol !== "https:") {
          throw new Error("redirect must use HTTPS");
        }
        if (
          next.username ||
          next.password ||
          (next.port && next.port !== "443") ||
          !isAllowedGitHubHost(next.hostname.toLowerCase())
        ) {
          throw new Error("redirect host is not allowed");
        }
        current = next;
        continue;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while fetching ${current}`);
      }
      return response;
    }
    throw new Error("too many HTTP redirects");
  }

  async readManifest() {
    const response = await this.#fetch(this.manifestUrl, this.manifestTimeoutMs);
    const declaredLength = parseContentLength(response.headers);
    if (declaredLength !== null && declaredLength > MAX_MANIFEST_BYTES) {
      throw new Error("release manifest exceeds the manifest size limit");
    }
    return await parseManifestText(
      await readManifestResponse(response),
      "release manifest"
    );
  }

  async materializeAsset(name, destination, options = {}) {
    const basename = validateAssetName(name);
    const assetUrl = new URL(
      encodeURIComponent(basename),
      new URL(".", this.manifestUrl)
    );
    let initialBytes = 0;
    if (options.resume) {
      try {
        const metadata = await stat(destination);
        if (!metadata.isFile()) throw new Error("partial download is not a file");
        initialBytes = metadata.size;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    if (
      Number.isSafeInteger(options.expectedSize) &&
      initialBytes === options.expectedSize
    ) {
      options.onProgress?.({
        phase: "download",
        transferredBytes: initialBytes,
        totalBytes: options.expectedSize,
        percent: 100,
        instantBytesPerSecond: 0,
        averageBytesPerSecond: 0,
        etaSeconds: 0
      });
      return resolve(destination);
    }
    const response = await this.#fetch(
      assetUrl,
      this.assetTimeoutMs,
      initialBytes > 0 ? { Range: `bytes=${initialBytes}-` } : {}
    );
    if (response.body === null) {
      throw new Error("HTTP response has no body");
    }
    let append = initialBytes > 0 && response.status === 206;
    if (append) {
      const range = response.headers.get("content-range");
      const match = /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(range ?? "");
      if (!match || Number(match[1]) !== initialBytes) {
        throw new Error("resume response has an invalid Content-Range");
      }
    } else if (initialBytes > 0) {
      await rm(destination, { force: true });
      initialBytes = 0;
      append = false;
    }
    const declaredLength = parseContentLength(response.headers);
    const totalBytes = Number.isSafeInteger(options.expectedSize)
      ? options.expectedSize
      : declaredLength !== null
        ? initialBytes + declaredLength
        : null;
    return await writeReadable(Readable.fromWeb(response.body), destination, {
      append,
      keepPartial: options.resume === true,
      initialBytes,
      totalBytes,
      onProgress: options.onProgress,
      now: options.now
    });
  }
}
