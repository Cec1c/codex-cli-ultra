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
  assert.match(workflow, /git add[\s\S]*release-channels\/stable\.json/);
  assert.doesNotMatch(
    workflow,
    /git diff --quiet -- release-channels\/stable\.json/
  );
  assert.match(workflow, /node scripts\/prepare-ccu-release\.mjs/);
  assert.match(workflow, /git tag "\$RELEASE_TAG"/);
  assert.match(workflow, /gh workflow run release\.yml/);
  assert.match(workflow, /Recover a pending CCU Release/);
  assert.match(workflow, /git diff --quiet "\$current_tag\.\.HEAD"/);
  assert.equal(
    (workflow.match(/-f "fork_tag=\$(?:fork_tag|FORK_TAG)"/g) ?? []).length,
    2,
    "both pending recovery and a new stable release must pin the fork tag"
  );
});

test("stable Release is the default and publishes a verified five-platform set", async () => {
  const [workflow, verifier] = await Promise.all([
    readFile(
      new URL("../.github/workflows/release.yml", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL("../scripts/verify-release-artifacts.mjs", import.meta.url),
      "utf8"
    )
  ]);

  assert.match(workflow, /gh release create[\s\S]*--verify-tag/);
  assert.match(workflow, /prerelease=false/);
  assert.match(workflow, /release_tier="Stable build"/);
  assert.match(workflow, /release_flags=\(--latest\)/);
  assert.match(workflow, /if \[\[ "\$PRERELEASE" == "true" \]\]/);
  assert.match(workflow, /!v\*-alpha\.\*/);
  assert.match(workflow, /Alpha CCU releases require an exact Alpha fork tag/);
  assert.match(workflow, /--prerelease/);
  assert.match(workflow, /needs:[\s\S]*- metadata[\s\S]*- build/);
  assert.match(workflow, /Verify complete release set[\s\S]*gh release create/);
  assert.match(workflow, /gh release download/);
  assert.match(workflow, /Published Release must not be a draft/);
  assert.doesNotMatch(workflow, /package-release\.ps1/);
  assert.match(workflow, /node scripts\/package-release\.mjs/);
  assert.match(workflow, /verify-release-artifacts\.mjs/);
  const platforms = [
    "windows-x64",
    "linux-x64",
    "linux-arm64",
    "macos-x64",
    "macos-arm64"
  ];
  assert.equal(
    (workflow.match(/^\s+- platform: /gm) ?? []).length,
    platforms.length,
    "the Release matrix must contain exactly five platforms"
  );
  for (const platform of platforms) {
    assert.match(workflow, new RegExp(platform));
  }
  assert.match(verifier, /const SUPPORTED_PLATFORMS = Object\.freeze/);
  for (const platform of platforms) {
    assert.match(verifier, new RegExp(`"${platform}"`));
  }
  assert.match(verifier, /sha256File/);
  assert.match(verifier, /SHA-256 sidecar does not match its archive/);
});
