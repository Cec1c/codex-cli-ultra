import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HttpReleaseProvider } from "../../src/release/provider.mjs";

test("HTTP provider emits real byte progress", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccu-provider-progress-"));
  const destination = join(root, "asset.zip");
  const progress = [];
  try {
    const provider = new HttpReleaseProvider({
      manifestUrl:
        "https://github.com/Cec1c/codex-cli-ultra/releases/download/v0.1.5/ccu-update-manifest.json",
      fetchImpl: async () => new Response(Buffer.from("abcdef"), {
        status: 200,
        headers: { "content-length": "6" }
      })
    });
    await provider.materializeAsset("asset.zip", destination, {
      expectedSize: 6,
      onProgress: (event) => progress.push(event)
    });
    assert.equal(await readFile(destination, "utf8"), "abcdef");
    assert.equal(progress.at(-1).transferredBytes, 6);
    assert.equal(progress.at(-1).percent, 100);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("HTTP provider resumes a partial download with a validated range", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccu-provider-resume-"));
  const destination = join(root, "asset.zip.part");
  try {
    await writeFile(destination, "abc");
    const provider = new HttpReleaseProvider({
      manifestUrl:
        "https://github.com/Cec1c/codex-cli-ultra/releases/download/v0.1.5/ccu-update-manifest.json",
      fetchImpl: async (_url, options) => {
        assert.equal(new Headers(options.headers).get("range"), "bytes=3-");
        return new Response(Buffer.from("def"), {
          status: 206,
          headers: {
            "content-length": "3",
            "content-range": "bytes 3-5/6"
          }
        });
      }
    });
    await provider.materializeAsset("asset.zip", destination, {
      expectedSize: 6,
      resume: true
    });
    assert.equal(await readFile(destination, "utf8"), "abcdef");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
