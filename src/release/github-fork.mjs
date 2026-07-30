import {
  forkManifestName,
  validateForkManifest
} from "./fork-manifest.mjs";
import { RUNTIME_PLATFORM } from "../config/constants.mjs";
import { HttpReleaseProvider } from "./provider.mjs";

const DEFAULT_REPOSITORY = "Cec1c/codex";
const MAX_RELEASE_RESPONSE_BYTES = 1024 * 1024;
const RELEASE_TAG_PATTERN =
  /^ccu-rust-v[0-9]+\.[0-9]+\.[0-9]+-r[1-9][0-9]*(?:-alpha\.[1-9][0-9]*)?$/;

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
    throw new Error("fork repository must use owner/name syntax");
  }
  if (releaseTag !== undefined) {
    if (!RELEASE_TAG_PATTERN.test(releaseTag)) {
      throw new Error("fork release tag does not match the CCU release contract");
    }
    return `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`;
  }
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

export async function resolveLatestForkRelease(options = {}) {
  const runtime = options.runtime ?? RUNTIME_PLATFORM;
  const manifestName = options.manifestName ?? forkManifestName(runtime);
  const repository = options.repository ?? DEFAULT_REPOSITORY;
  const requestedReleaseTag = options.releaseTag;
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "codex-cli-ultra"
  });
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  const response = await (options.fetchImpl ?? fetch)(
    releaseApiUrl(repository, requestedReleaseTag),
    {
      method: "GET",
      headers,
      redirect: "error",
      signal: options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 15_000)
    }
  );
  if (!response.ok) {
    throw new Error(`GitHub fork release request failed with HTTP ${response.status}`);
  }
  const release = await readLimitedJson(response);
  if (
    release?.draft === true ||
    typeof release?.tag_name !== "string" ||
    !Array.isArray(release?.assets)
  ) {
    throw new Error("GitHub fork release metadata is invalid");
  }
  if (requestedReleaseTag === undefined && release.prerelease === true) {
    throw new Error("GitHub latest release is not a stable CCU fork release");
  }
  if (
    requestedReleaseTag !== undefined &&
    release.tag_name !== requestedReleaseTag
  ) {
    throw new Error("GitHub fork release tag does not match the requested tag");
  }
  if (requestedReleaseTag !== undefined) {
    const expectedPrerelease = requestedReleaseTag.includes("-alpha.");
    if (release.prerelease !== expectedPrerelease) {
      throw new Error("GitHub fork release prerelease state does not match its tag");
    }
  }
  const manifestAsset = release.assets.find(
    (asset) => asset?.name === manifestName
  );
  if (typeof manifestAsset?.browser_download_url !== "string") {
    throw new Error(`GitHub Release has no ${manifestName} asset`);
  }
  const provider = new HttpReleaseProvider({
    manifestUrl: manifestAsset.browser_download_url,
    fetchImpl: options.fetchImpl,
    headers
  });
  const manifest = validateForkManifest(await provider.readManifest(), {
    releaseTag: release.tag_name,
    platform: runtime.target
  });
  return {
    repository,
    releaseUrl: release.html_url ?? null,
    manifestUrl: manifestAsset.browser_download_url,
    manifest,
    provider
  };
}
