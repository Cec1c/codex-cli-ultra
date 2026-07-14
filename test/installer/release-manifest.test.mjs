import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256File } from "../../src/release/hash.mjs";
import { validateReleaseManifest } from "../../src/release/manifest.mjs";
import {
  DirectoryReleaseProvider,
  HttpReleaseProvider
} from "../../src/release/provider.mjs";

const manifest = {
  schemaVersion: 1,
  upstreamVersion: "0.144.1",
  upstreamTag: "rust-v0.144.1",
  upstreamCommit: "44918ea10c0f99151c6710411b4322c2f5c96bea",
  ultraRevision: 1,
  i18nApiVersion: 1,
  catalogVersion: 1,
  platform: "x86_64-pc-windows-msvc",
  executor: {
    name: "codex-ultra-executor-0.1.0.mjs",
    size: 2048,
    sha256: `sha256:${"d".repeat(64)}`
  },
  asset: {
    name: "codex-ultra-0.144.1-u1-windows-x64.zip",
    size: 1024,
    sha256: `sha256:${"a".repeat(64)}`
  },
  language: {
    locale: "zh-CN",
    asset: "codex-ultra-language-zh-CN-v1.zip",
    size: 512,
    sha256: `sha256:${"b".repeat(64)}`
  },
  sourceArchive: {
    name: "codex-ultra-0.144.1-u1-source.tar.gz",
    size: 4096,
    sha256: `sha256:${"c".repeat(64)}`
  },
  signature: null
};

const expected = {
  upstreamVersion: manifest.upstreamVersion,
  upstreamTag: manifest.upstreamTag,
  upstreamCommit: manifest.upstreamCommit,
  i18nApiVersion: manifest.i18nApiVersion,
  catalogVersion: manifest.catalogVersion,
  platform: manifest.platform
};

test("release manifest accepts the exact compatibility contract and returns a clone", () => {
  const value = validateReleaseManifest(manifest, expected);
  assert.deepEqual(value, manifest);
  assert.notEqual(value, manifest);
  assert.notEqual(value.asset, manifest.asset);
  value.asset.name = "changed.zip";
  assert.equal(manifest.asset.name, "codex-ultra-0.144.1-u1-windows-x64.zip");
});

test("release manifest rejects unknown keys and incompatible identity fields", () => {
  assert.throws(
    () => validateReleaseManifest({ ...manifest, extra: true }, expected),
    /release manifest must contain exactly/
  );
  assert.throws(
    () => validateReleaseManifest({ ...manifest, schemaVersion: 2 }, expected),
    /unsupported release manifest schema/
  );

  for (const [field, value] of [
    ["upstreamVersion", "0.145.0"],
    ["upstreamTag", "rust-v0.145.0"],
    ["upstreamCommit", "0".repeat(40)],
    ["i18nApiVersion", 2],
    ["catalogVersion", 2],
    ["platform", "aarch64-pc-windows-msvc"]
  ]) {
    assert.throws(
      () => validateReleaseManifest({ ...manifest, [field]: value }, expected),
      new RegExp(`${field}.*expected`)
    );
  }

  assert.throws(
    () => validateReleaseManifest({ ...manifest, ultraRevision: 0 }, expected),
    /ultraRevision must be a positive safe integer/
  );
  assert.throws(
    () => validateReleaseManifest({ ...manifest, signature: {} }, expected),
    /signature must be null/
  );
});

test("release manifest rejects unsafe asset records, sizes, hashes, and locale IDs", () => {
  const records = [
    ["executor", "name"],
    ["asset", "name"],
    ["language", "asset"],
    ["sourceArchive", "name"]
  ];
  for (const [record, field] of records) {
    for (const name of [
      "../escape.zip",
      "dir/file.zip",
      "dir\\file.zip",
      "C:evil.zip",
      "CON",
      "bad?.zip"
    ]) {
      assert.throws(
        () => validateReleaseManifest({
          ...manifest,
          [record]: { ...manifest[record], [field]: name }
        }, expected),
        /must be a safe basename/
      );
    }
  }

  assert.throws(
    () => validateReleaseManifest({
      ...manifest,
      asset: { ...manifest.asset, extra: true }
    }, expected),
    /asset must contain exactly/
  );
  assert.throws(
    () => validateReleaseManifest({
      ...manifest,
      asset: { ...manifest.asset, size: -1 }
    }, expected),
    /asset.size must be a positive safe integer/
  );
  assert.throws(
    () => validateReleaseManifest({
      ...manifest,
      asset: { ...manifest.asset, sha256: "sha256:ABC" }
    }, expected),
    /asset.sha256 must be canonical SHA-256/
  );
  assert.throws(
    () => validateReleaseManifest({
      ...manifest,
      language: { ...manifest.language, locale: "zh_cn" }
    }, expected),
    /language.locale must be a canonical locale/
  );
});

test("sha256File streams bytes and returns exact size and canonical hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-hash-"));
  const path = join(root, "asset.bin");
  const content = Buffer.from("流式哈希\n".repeat(4096), "utf8");
  await writeFile(path, content);
  assert.deepEqual(await sha256File(path), {
    size: content.length,
    sha256: `sha256:${createHash("sha256").update(content).digest("hex")}`
  });
});

test("directory provider reads the manifest and materializes only basename assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-directory-provider-"));
  await writeFile(join(root, "release-manifest.json"), JSON.stringify(manifest), "utf8");
  await writeFile(join(root, manifest.asset.name), "asset-bytes", "utf8");
  const output = join(root, "download.tmp");
  const provider = new DirectoryReleaseProvider(root);

  assert.deepEqual(await provider.readManifest(), manifest);
  await provider.materializeAsset(manifest.asset.name, output);
  assert.equal(await readFile(output, "utf8"), "asset-bytes");
  await assert.rejects(
    provider.materializeAsset("../outside.zip", join(root, "outside.tmp")),
    /asset name must be a safe basename/
  );
});

test("HTTP provider follows only allowed HTTPS redirects and strips Authorization on CDN hosts", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-http-provider-"));
  const output = join(root, "asset.tmp");
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({
      url: String(url),
      authorization: new Headers(options.headers).get("authorization"),
      redirect: options.redirect
    });
    if (calls.length === 1) {
      return new Response(null, {
        status: 302,
        headers: {
          location: "https://objects.githubusercontent.com/releases/asset.zip"
        }
      });
    }
    return new Response("downloaded", { status: 200 });
  };
  const provider = new HttpReleaseProvider({
    manifestUrl: "https://github.com/example/release/release-manifest.json",
    headers: { Authorization: "Bearer secret" },
    fetchImpl
  });

  await provider.materializeAsset("asset.zip", output);
  assert.equal(await readFile(output, "utf8"), "downloaded");
  assert.deepEqual(calls, [
    {
      url: "https://github.com/example/release/asset.zip",
      authorization: "Bearer secret",
      redirect: "manual"
    },
    {
      url: "https://objects.githubusercontent.com/releases/asset.zip",
      authorization: null,
      redirect: "manual"
    }
  ]);
});

test("HTTP provider rejects HTTP, unapproved redirects, invalid JSON, and non-2xx responses", async () => {
  assert.throws(
    () => new HttpReleaseProvider({ manifestUrl: "http://github.com/release.json" }),
    /HTTPS/
  );
  assert.throws(
    () => new HttpReleaseProvider({
      manifestUrl: "https://user:secret@github.com/release.json"
    }),
    /must not contain URL credentials/
  );

  const evilRedirect = new HttpReleaseProvider({
    manifestUrl: "https://github.com/example/release/release-manifest.json",
    fetchImpl: async () => new Response(null, {
      status: 302,
      headers: { location: "https://example.com/asset.zip" }
    })
  });
  await assert.rejects(
    evilRedirect.materializeAsset("asset.zip", join(tmpdir(), `asset-${Date.now()}.tmp`)),
    /redirect host is not allowed/
  );

  const invalidManifest = new HttpReleaseProvider({
    manifestUrl: "https://github.com/example/release/release-manifest.json",
    fetchImpl: async () => new Response("not-json", { status: 200 })
  });
  await assert.rejects(invalidManifest.readManifest(), /valid JSON/);

  const missing = new HttpReleaseProvider({
    manifestUrl: "https://github.com/example/release/release-manifest.json",
    fetchImpl: async () => new Response("missing", { status: 404 })
  });
  await assert.rejects(
    missing.materializeAsset("asset.zip", join(tmpdir(), `missing-${Date.now()}.tmp`)),
    /HTTP 404/
  );

  const oversized = new HttpReleaseProvider({
    manifestUrl: "https://github.com/example/release/release-manifest.json",
    fetchImpl: async () => new Response("x".repeat(1024 * 1024 + 1), {
      status: 200
    })
  });
  await assert.rejects(oversized.readManifest(), /manifest size limit/);
});
