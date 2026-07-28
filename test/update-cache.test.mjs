import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { defaultSettings } from "../src/settings/store.mjs";
import {
  dismissUpdateVersion,
  isUpdateVersionDismissed,
  readUpdateCache,
  updateCheckIsDue,
  writeUpdateCacheAtomic
} from "../src/update/cache.mjs";

test("update cache throttles checks and dismisses only the selected version", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccu-update-cache-"));
  try {
    const checkedAt = new Date("2026-07-27T00:00:00.000Z");
    const cache = await writeUpdateCacheAtomic(root, {
      schemaVersion: 1,
      checkedAt: checkedAt.toISOString(),
      latestCcuVersion: "0.1.5",
      latestCcuTag: "v0.1.5",
      packageReady: true,
      releaseUrl: "https://github.com/Cec1c/codex-cli-ultra/releases/tag/v0.1.5",
      updateManifestUrl: "https://github.com/Cec1c/codex-cli-ultra/releases/download/v0.1.5/ccu-update-manifest.json",
      bundledForkVersion: "0.146.0-ccu.i18n.1",
      bundledUpstreamVersion: "0.146.0",
      checkedWithProxy: false
    });
    assert.deepEqual(await readUpdateCache(root), cache);
    assert.equal(
      updateCheckIsDue(
        cache,
        defaultSettings(),
        new Date("2026-07-27T05:59:59.000Z")
      ),
      false
    );
    assert.equal(
      updateCheckIsDue(
        { ...cache, packageReady: false },
        defaultSettings(),
        new Date("2026-07-27T00:00:01.000Z")
      ),
      true
    );
    assert.equal(
      updateCheckIsDue(
        cache,
        defaultSettings(),
        new Date("2026-07-27T06:00:00.000Z")
      ),
      true
    );
    await dismissUpdateVersion(root, "0.1.5");
    assert.equal(await isUpdateVersionDismissed(root, "0.1.5"), true);
    assert.equal(await isUpdateVersionDismissed(root, "0.1.6"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
