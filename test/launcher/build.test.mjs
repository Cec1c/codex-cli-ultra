import assert from "node:assert/strict";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildExecutors } from "../../scripts/build-executor.mjs";

test("build emits independent launcher and management bundles", async () => {
  const outdir = await mkdtemp(join(tmpdir(), "codex-ultra-bundle-"));
  const result = await buildExecutors({ outdir, logLevel: "silent" });
  assert.deepEqual((await readdir(outdir)).sort(), [
    "codex-ultra.mjs",
    "launcher.mjs"
  ]);

  const launcherOutput = Object.entries(result.metafile.outputs).find(
    ([path]) => path.replaceAll("\\", "/").endsWith("/launcher.mjs")
  );
  assert.ok(launcherOutput);
  const launcherInputs = Object.keys(launcherOutput[1].inputs).map((path) =>
    path.replaceAll("\\", "/")
  );
  for (const forbidden of [
    "/release/",
    "/installer/",
    "yauzl",
    "@fluent/",
    "http"
  ]) {
    assert.equal(
      launcherInputs.some((path) => path.includes(forbidden)),
      false,
      `launcher bundle contains forbidden input: ${forbidden}`
    );
  }
});
