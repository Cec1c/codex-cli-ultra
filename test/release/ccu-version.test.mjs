import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  nextPatchVersion,
  prepareCcuVersion
} from "../../src/release/ccu-version.mjs";

test("nextPatchVersion increments only the patch component", () => {
  assert.equal(nextPatchVersion("0.1.3"), "0.1.4");
  assert.equal(nextPatchVersion("2.9.99"), "2.9.100");
  assert.equal(nextPatchVersion("0.1.8-alpha.1"), "0.1.9");
});

test("repository release version surfaces match package.json", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const packageJson = JSON.parse(
    await readFile(join(root, "package.json"), "utf8")
  );
  const expectedVersion = `v${packageJson.version}`;
  const expectedMarker = `| CCU | \`${expectedVersion}\``;

  for (const path of ["README.md", "README.en.md"]) {
    const content = await readFile(join(root, path), "utf8");
    assert.ok(
      content.includes(expectedMarker),
      `${path} must contain ${expectedMarker}`
    );
  }
});

test("prepareCcuVersion updates the complete release version contract", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ccu-version-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "scripts"));
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "ccu", version: "0.1.3" }, null, 2)}\n`
  );
  await writeFile(
    join(root, "package-lock.json"),
    `${JSON.stringify(
      { name: "ccu", version: "0.1.3", packages: { "": { version: "0.1.3" } } },
      null,
      2
    )}\n`
  );
  await writeFile(
    join(root, "src/version.mjs"),
    'export const CCU_VERSION = "0.1.3";\n'
  );
  await writeFile(
    join(root, "scripts/package-release.ps1"),
    "param([string]$Version = '0.1.3')\n"
  );
  await writeFile(join(root, "README.md"), "Current: v0.1.3\n");
  await writeFile(join(root, "README.en.md"), "Current: v0.1.3\n");

  const result = await prepareCcuVersion({ root, nextVersion: "0.1.4" });

  assert.deepEqual(result, {
    currentVersion: "0.1.3",
    nextVersion: "0.1.4",
    tag: "v0.1.4"
  });
  assert.equal(JSON.parse(await readFile(join(root, "package.json"))).version, "0.1.4");
  assert.match(await readFile(join(root, "src/version.mjs"), "utf8"), /0\.1\.4/);
  assert.match(await readFile(join(root, "README.md"), "utf8"), /v0\.1\.4/);
  assert.match(await readFile(join(root, "README.en.md"), "utf8"), /v0\.1\.4/);
});
