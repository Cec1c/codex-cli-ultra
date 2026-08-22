import { RUNTIME_PLATFORM } from "../config/constants.mjs";
import { ccuUpdateManifestName } from "./ccu-update-manifest.mjs";

const MAX_RELEASE_RESPONSE_BYTES = 1024 * 1024;

async function readLimitedJson(response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RELEASE_RESPONSE_BYTES
  ) {
    throw new Error("GitHub release response exceeds the size limit");
  }
  const source = await response.text();
  if (Buffer.byteLength(source, "utf8") > MAX_RELEASE_RESPONSE_BYTES) {
    throw new Error("GitHub release response exceeds the size limit");
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error("GitHub release response is not valid JSON", {
      cause: error
    });
  }
}

function releaseApiUrl(repository, releaseTag) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("repository must use owner/name syntax");
  }
  if (releaseTag !== undefined) {
    if (!isSafeReleaseTag(releaseTag)) {
      throw new Error("release tag contains unsupported characters");
    }
    return `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`;
  }
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

function isSafeReleaseTag(value) {
  return typeof value === "string" && /^v[A-Za-z0-9._-]+$/.test(value);
}

async function resolveLatestVersion(options) {
  if (
    options.releaseTag !== undefined &&
    !options.tagPattern.test(options.releaseTag)
  ) {
    throw new Error(`${options.repository} requested release tag does not match the expected contract`);
  }
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "codex-cli-ultra"
  });
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  const response = await (options.fetchImpl ?? fetch)(
    releaseApiUrl(options.repository, options.releaseTag),
    {
      method: "GET",
      headers,
      redirect: "error",
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 15_000)
    }
  );
  if (!response.ok) {
    throw new Error(
      `GitHub latest release request for ${options.repository} failed with HTTP ${response.status}`
    );
  }
  const release = await readLimitedJson(response);
  if (release?.draft === true || typeof release?.tag_name !== "string") {
    throw new Error(`${options.repository} release metadata is invalid`);
  }
  if (options.releaseTag === undefined && release?.prerelease === true) {
    throw new Error(`${options.repository} latest release is not stable`);
  }
  if (
    options.releaseTag !== undefined &&
    release.tag_name !== options.releaseTag
  ) {
    throw new Error(`${options.repository} release tag does not match the requested tag`);
  }
  if (options.releaseTag !== undefined) {
    const expectedPrerelease = options.releaseTag.includes("-alpha.");
    if (release.prerelease !== expectedPrerelease) {
      throw new Error(`${options.repository} release prerelease state does not match its tag`);
    }
  }
  const match = options.tagPattern.exec(release.tag_name);
  if (!match) {
    throw new Error(
      `${options.repository} latest release tag does not match the expected contract`
    );
  }
  return {
    repository: options.repository,
    tag: release.tag_name,
    version: match[1],
    url: release.html_url ?? null,
    assets: Array.isArray(release.assets) ? release.assets : []
  };
}

export async function resolveLatestCcuRelease(options = {}) {
  const runtime = options.runtime ?? RUNTIME_PLATFORM;
  const releaseTag = options.releaseTag;
  const result = await resolveLatestVersion({
    ...options,
    repository: options.repository ?? "Cec1c/codex-cli-ultra",
    releaseTag,
    tagPattern: releaseTag === undefined
      ? /^v([0-9]+\.[0-9]+\.[0-9]+)$/
      : /^v([0-9]+\.[0-9]+\.[0-9]+(?:-alpha\.[1-9]\d*)?)$/
  });
  const updateManifest = result.assets.find(
    (asset) => asset?.name === ccuUpdateManifestName(runtime)
  );
  return {
    repository: result.repository,
    tag: result.tag,
    version: result.version,
    url: result.url,
    updateManifestUrl:
      typeof updateManifest?.browser_download_url === "string"
        ? updateManifest.browser_download_url
        : null
  };
}

export async function resolveLatestUpstreamRelease(options = {}) {
  return await resolveLatestVersion({
    ...options,
    repository: options.repository ?? "openai/codex",
    tagPattern: /^rust-v([0-9]+\.[0-9]+\.[0-9]+)$/
  });
}

export function compareStableVersions(left, right) {
  const parse = (value) => {
    if (typeof value !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value)) {
      throw new Error(`invalid stable version: ${value}`);
    }
    return value.split(".").map(Number);
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

export function compareCcuVersions(left, right) {
  const parse = (value) => {
    if (typeof value !== "string") {
      throw new Error(`invalid CCU version: ${value}`);
    }
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-alpha\.([1-9]\d*))?$/.exec(value);
    if (!match) throw new Error(`invalid CCU version: ${value}`);
    return {
      core: match.slice(1, 4).map(Number),
      alpha: match[4] === undefined ? null : Number(match[4])
    };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) {
      return a.core[index] < b.core[index] ? -1 : 1;
    }
  }
  if (a.alpha === b.alpha) return 0;
  if (a.alpha === null) return 1;
  if (b.alpha === null) return -1;
  return a.alpha < b.alpha ? -1 : 1;
}
