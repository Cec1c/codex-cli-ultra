import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stable channel workflow commits a newly created untracked manifest", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/sync-fork-channel.yml", import.meta.url),
    "utf8"
  );

  assert.match(workflow, /node scripts\/sync-fork-channel\.mjs --write/);
  assert.match(
    workflow,
    /git status --short -- release-channels\/stable\.json/
  );
  assert.match(workflow, /git add release-channels\/stable\.json/);
  assert.doesNotMatch(
    workflow,
    /git diff --quiet -- release-channels\/stable\.json/
  );
});
