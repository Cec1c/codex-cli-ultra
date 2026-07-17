import assert from "node:assert/strict";
import test from "node:test";

import {
  compareForkReleases,
  validateForkManifest
} from "../../src/release/fork-manifest.mjs";
import { resolveLatestForkRelease } from "../../src/release/github-fork.mjs";

function manifest(revision = 1, version = "0.144.5") {
  return {
    schemaVersion: 1,
    type: "codex-ccu-i18n-build",
    releaseTag: `ccu-rust-v${version}-r${revision}`,
    displayVersion: `${version}-ccu.i18n.${revision}`,
    upstreamVersion: version,
    upstreamTag: `rust-v${version}`,
    upstreamCommit: "a".repeat(40),
    forkCommit: "b".repeat(40),
    ultraRevision: revision,
    i18nApiVersion: 1,
    platform: "x86_64-pc-windows-msvc",
    asset: {
      name: `codex-${version}-r${revision}.zip`,
      size: 1024,
      sha256: `sha256:${"c".repeat(64)}`
    }
  };
}

test("fork manifest validates the release, display, upstream, and asset contract", () => {
  const value = manifest();
  const validated = validateForkManifest(value, {
    releaseTag: value.releaseTag
  });
  assert.deepEqual(validated, value);
  assert.notEqual(validated, value);

  for (const invalid of [
    { ...value, releaseTag: "rust-v0.144.5" },
    { ...value, displayVersion: "0.144.5" },
    { ...value, upstreamTag: "rust-v0.144.4" },
    { ...value, forkCommit: "ABC" },
    { ...value, i18nApiVersion: 2 },
    { ...value, platform: "aarch64-pc-windows-msvc" },
    { ...value, asset: { ...value.asset, name: "../codex.zip" } }
  ]) {
    assert.throws(() => validateForkManifest(invalid));
  }
});

test("fork release ordering handles a new upstream and same-upstream revisions", () => {
  assert.equal(compareForkReleases(manifest(1), manifest(2)), -1);
  assert.equal(compareForkReleases(manifest(2), manifest(1)), 1);
  assert.equal(compareForkReleases(manifest(1), manifest(1)), 0);
  assert.equal(
    compareForkReleases(manifest(9, "0.144.5"), manifest(1, "0.145.0")),
    -1
  );
});

test("latest fork release resolves the manifest asset and checks the GitHub tag", async () => {
  const value = manifest();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        draft: false,
        prerelease: false,
        tag_name: value.releaseTag,
        html_url: `https://github.com/Cec1c/codex/releases/tag/${value.releaseTag}`,
        assets: [{
          name: "ccu-fork-manifest.json",
          browser_download_url:
            `https://github.com/Cec1c/codex/releases/download/${value.releaseTag}/ccu-fork-manifest.json`
        }]
      }), { status: 200 });
    }
    return new Response(JSON.stringify(value), { status: 200 });
  };

  const latest = await resolveLatestForkRelease({ fetchImpl });
  assert.deepEqual(latest.manifest, value);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /api\.github\.com\/repos\/Cec1c\/codex\/releases\/latest/);
});
