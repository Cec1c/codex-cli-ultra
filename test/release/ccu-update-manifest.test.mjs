import assert from "node:assert/strict";
import test from "node:test";

import {
  managerCanApplyUpdate,
  validateCcuUpdateManifest
} from "../../src/release/ccu-update-manifest.mjs";

function manifest() {
  return {
    schemaVersion: 1,
    type: "codex-cli-ultra-update",
    ccuVersion: "0.1.5",
    releaseTag: "v0.1.5",
    platform: "windows-x64",
    minimumManagerVersion: "0.1.5",
    bundledFork: {
      releaseTag: "ccu-rust-v0.146.0-r1",
      displayVersion: "0.146.0-ccu.i18n.1",
      upstreamVersion: "0.146.0",
      i18nApiVersion: 1
    },
    asset: {
      name: "codex-cli-ultra-v0.1.5-windows-x64.zip",
      size: 123,
      sha256: `sha256:${"a".repeat(64)}`
    }
  };
}

test("CCU update manifest binds the manager, fork, and package", () => {
  const value = manifest();
  assert.deepEqual(validateCcuUpdateManifest(value), value);
  assert.equal(managerCanApplyUpdate("0.1.5", value), true);
  assert.equal(managerCanApplyUpdate("0.1.4", value), false);
});

test("CCU update manifest rejects a mismatched release tag", () => {
  const value = manifest();
  value.releaseTag = "v0.1.6";
  assert.throws(() => validateCcuUpdateManifest(value), /does not match/);
});
