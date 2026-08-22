import assert from "node:assert/strict";
import test from "node:test";

import {
  compareCcuVersions,
  compareStableVersions,
  resolveLatestCcuRelease,
  resolveLatestUpstreamRelease
} from "../../src/release/github-version.mjs";

function releaseResponse(tag, extra = {}) {
  return new Response(JSON.stringify({
    draft: false,
    prerelease: false,
    tag_name: tag,
    html_url: `https://github.com/example/releases/tag/${tag}`,
    ...extra
  }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("latest CCU and upstream releases enforce their tag contracts", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    return String(url).includes("codex-cli-ultra")
      ? releaseResponse("v0.1.3")
      : releaseResponse("rust-v0.144.7");
  };

  const ccu = await resolveLatestCcuRelease({ fetchImpl });
  const upstream = await resolveLatestUpstreamRelease({ fetchImpl });
  assert.equal(ccu.version, "0.1.3");
  assert.equal(upstream.version, "0.144.7");
  assert.match(requests[0].url, /Cec1c\/codex-cli-ultra\/releases\/latest$/);
  assert.match(requests[1].url, /openai\/codex\/releases\/latest$/);
  assert.equal(requests[0].options.redirect, "error");
});

test("latest release metadata rejects prereleases and unexpected tags", async () => {
  await assert.rejects(
    resolveLatestCcuRelease({
      fetchImpl: async () => releaseResponse("v0.1.3", { prerelease: true })
    }),
    /not stable/
  );
  await assert.rejects(
    resolveLatestUpstreamRelease({
      fetchImpl: async () => releaseResponse("v0.144.7")
    }),
    /tag does not match/
  );
});

test("an explicit CCU target resolves the exact Alpha prerelease", async () => {
  const requests = [];
  const release = await resolveLatestCcuRelease({
    releaseTag: "v0.2.0-alpha.3",
    fetchImpl: async (url) => {
      requests.push(String(url));
      return releaseResponse("v0.2.0-alpha.3", {
        prerelease: true,
        assets: [{
          name: "ccu-update-manifest.json",
          browser_download_url: "https://example.test/ccu-update-manifest.json"
        }]
      });
    }
  });

  assert.equal(release.version, "0.2.0-alpha.3");
  assert.equal(
    release.updateManifestUrl,
    "https://example.test/ccu-update-manifest.json"
  );
  assert.match(requests[0], /releases\/tags\/v0\.2\.0-alpha\.3$/);
  await assert.rejects(
    resolveLatestCcuRelease({
      releaseTag: "v0.2.0-alpha.3",
      fetchImpl: async () => releaseResponse("v0.2.0-alpha.3")
    }),
    /prerelease state/
  );
});

test("stable version comparison is numeric", () => {
  assert.equal(compareStableVersions("0.1.2", "0.1.10"), -1);
  assert.equal(compareStableVersions("0.144.6", "0.144.6"), 0);
  assert.equal(compareStableVersions("1.0.0", "0.999.999"), 1);
});

test("CCU version comparison orders Alpha builds without downgrading them", () => {
  assert.equal(compareCcuVersions("0.1.8-alpha.1", "0.1.8-alpha.2"), -1);
  assert.equal(compareCcuVersions("0.1.8-alpha.2", "0.1.8"), -1);
  assert.equal(compareCcuVersions("0.1.8-alpha.1", "0.1.7"), 1);
  assert.equal(compareCcuVersions("0.1.8", "0.1.8"), 0);
});
