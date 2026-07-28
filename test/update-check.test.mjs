import assert from "node:assert/strict";
import test from "node:test";

import { defaultSettings } from "../src/settings/store.mjs";
import { checkForCcuUpdate } from "../src/update/check.mjs";

const manifest = {
  schemaVersion: 1,
  type: "codex-cli-ultra-update",
  ccuVersion: "0.1.5",
  releaseTag: "v0.1.5",
  platform: "windows-x64",
  minimumManagerVersion: "0.1.5",
  bundledFork: {
    releaseTag: "ccu-rust-v0.145.0-r2",
    displayVersion: "0.145.0-ccu.i18n.2",
    upstreamVersion: "0.145.0",
    i18nApiVersion: 1
  },
  asset: {
    name: "codex-cli-ultra-v0.1.5-windows-x64.zip",
    size: 123,
    sha256: `sha256:${"a".repeat(64)}`
  }
};

test("CCU update check falls back to the public latest manifest after API failure", async () => {
  const requests = [];
  let cached = null;
  const checked = await checkForCcuUpdate({
    installRoot: String.raw`C:\ccu`,
    settings: defaultSettings(),
    networkClient: {
      proxyEnabled: true,
      async fetch(url) {
        requests.push(String(url));
        return new Response(JSON.stringify(manifest), { status: 200 });
      }
    },
    resolveLatestCcuRelease: async () => {
      throw new Error("HTTP 403");
    },
    writeUpdateCacheAtomic: async (_installRoot, value) => {
      cached = value;
      return value;
    },
    now: new Date("2026-07-28T00:00:00.000Z")
  });

  assert.deepEqual(requests, [
    "https://github.com/Cec1c/codex-cli-ultra/releases/latest/download/ccu-update-manifest.json"
  ]);
  assert.equal(checked.latest.version, "0.1.5");
  assert.equal(checked.latest.tag, "v0.1.5");
  assert.equal(checked.manifest.ccuVersion, "0.1.5");
  assert.equal(cached.packageReady, true);
  assert.equal(cached.checkedWithProxy, true);
});
