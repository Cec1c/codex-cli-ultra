import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { buildExecutors } from "../../scripts/build-executor.mjs";

const execFileAsync = promisify(execFile);

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

  const isolatedRoot = join(outdir, "install-root");
  const management = await execFileAsync(
    process.execPath,
    [join(outdir, "codex-ultra.mjs"), "version"],
    {
      env: {
        ...process.env,
        CODEX_ULTRA_HOME: isolatedRoot
      },
      windowsHide: true
    }
  );
  assert.match(management.stdout, /codex-cli-ultra 0\.1\.2/);
});
