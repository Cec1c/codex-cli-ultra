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

function releaseApiUrl(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("repository must use owner/name syntax");
  }
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

async function resolveLatestVersion(options) {
  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "codex-cli-ultra"
  });
  if (options.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }
  const response = await (options.fetchImpl ?? fetch)(
    releaseApiUrl(options.repository),
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
  if (
    release?.draft === true ||
    release?.prerelease === true ||
    typeof release?.tag_name !== "string"
  ) {
    throw new Error(`${options.repository} latest release is not stable`);
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
    url: release.html_url ?? null
  };
}

export async function resolveLatestCcuRelease(options = {}) {
  return await resolveLatestVersion({
    ...options,
    repository: options.repository ?? "Cec1c/codex-cli-ultra",
    tagPattern: /^v([0-9]+\.[0-9]+\.[0-9]+)$/
  });
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
