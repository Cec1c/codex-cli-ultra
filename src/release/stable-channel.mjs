const CHANNEL_IDENTITY = Object.freeze({
  schemaVersion: 1,
  channel: "stable",
  source: "Cec1c/codex"
});

function sameRelease(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function buildStableChannel({ latestManifest, existingChannel, now }) {
  if (
    existingChannel?.schemaVersion === CHANNEL_IDENTITY.schemaVersion &&
    existingChannel.channel === CHANNEL_IDENTITY.channel &&
    existingChannel.source === CHANNEL_IDENTITY.source &&
    typeof existingChannel.syncedAt === "string" &&
    sameRelease(existingChannel.release, latestManifest)
  ) {
    return existingChannel;
  }

  return {
    ...CHANNEL_IDENTITY,
    syncedAt: now.toISOString(),
    release: latestManifest
  };
}
