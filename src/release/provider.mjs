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
import { pipeline } from "node:stream/promises";

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

async function writeReadableExclusive(readable, destination) {
  const target = resolve(destination);
  let handle = null;
  try {
    handle = await open(target, "wx");
    const output = handle.createWriteStream();
    await pipeline(readable, output);
  } catch (error) {
    if (handle !== null) {
      await handle.close().catch(() => {});
      await rm(target, { force: true }).catch(() => {});
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

  async materializeAsset(name, destination) {
    const source = await this.#resolveSource(name, "release asset");
    return await writeReadableExclusive(createReadStream(source), destination);
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

  #requestHeaders(url) {
    const headers = new Headers(this.headers);
    if (!AUTHORIZATION_HOSTS.has(url.hostname.toLowerCase())) {
      headers.delete("authorization");
    }
    return headers;
  }

  async #fetch(url, timeoutMs) {
    let current = validateHttpsGitHubUrl(url, "request URL");
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await this.fetchImpl(current, {
        method: "GET",
        headers: this.#requestHeaders(current),
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
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_MANIFEST_BYTES) {
      throw new Error("release manifest exceeds the manifest size limit");
    }
    return await parseManifestText(
      await readManifestResponse(response),
      "release manifest"
    );
  }

  async materializeAsset(name, destination) {
    const basename = validateAssetName(name);
    const assetUrl = new URL(
      encodeURIComponent(basename),
      new URL(".", this.manifestUrl)
    );
    const response = await this.#fetch(assetUrl, this.assetTimeoutMs);
    if (response.body === null) {
      throw new Error("HTTP response has no body");
    }
    return await writeReadableExclusive(
      Readable.fromWeb(response.body),
      destination
    );
  }
}
