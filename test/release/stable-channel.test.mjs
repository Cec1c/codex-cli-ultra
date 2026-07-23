import assert from "node:assert/strict";
import test from "node:test";

import { buildStableChannel } from "../../src/release/stable-channel.mjs";

const manifest = Object.freeze({
  schemaVersion: 1,
  releaseTag: "ccu-rust-v0.145.0-r1"
});

test("stable channel preserves syncedAt when the fork release is unchanged", () => {
  const existingChannel = {
    schemaVersion: 1,
    channel: "stable",
    source: "Cec1c/codex",
    syncedAt: "2026-07-23T03:58:30.817Z",
    release: manifest
  };

  assert.equal(
    buildStableChannel({
      latestManifest: { ...manifest },
      existingChannel,
      now: new Date("2026-07-24T00:00:00.000Z")
    }),
    existingChannel
  );
});

test("stable channel advances syncedAt for a new fork release", () => {
  const channel = buildStableChannel({
    latestManifest: { ...manifest, releaseTag: "ccu-rust-v0.146.0-r1" },
    existingChannel: {
      schemaVersion: 1,
      channel: "stable",
      source: "Cec1c/codex",
      syncedAt: "2026-07-23T03:58:30.817Z",
      release: manifest
    },
    now: new Date("2026-07-24T00:00:00.000Z")
  });

  assert.equal(channel.syncedAt, "2026-07-24T00:00:00.000Z");
  assert.equal(channel.release.releaseTag, "ccu-rust-v0.146.0-r1");
});
