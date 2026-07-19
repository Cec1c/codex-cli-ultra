import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { uninstallCcu } from "../../src/installer/uninstall.mjs";
import { readState, writeStateAtomic } from "../../src/state/store.mjs";

const official = {
  version: "0.144.6",
  packageJsonPath: "C:\\npm\\node_modules\\@openai\\codex\\package.json",
  platformPackageVersion: "0.144.6-win32-x64",
  platformPackageJsonPath:
    "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\package.json",
  binaryPath:
    "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"
};

test("uninstall removes CCU PATH and preferences before falling back to official Codex", async (t) => {
  const installRoot = await mkdtemp(join(tmpdir(), "ccu-uninstall-"));
  const codexHome = await mkdtemp(join(tmpdir(), "ccu-uninstall-home-"));
  t.after(() => rm(installRoot, { recursive: true, force: true }));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  await mkdir(join(installRoot, "bin"), { recursive: true });
  const statePath = join(installRoot, "state.json");
  await writeStateAtomic(statePath, {
    schemaVersion: 1,
    official,
    active: {
      releaseId: "0.144.6-ccu.i18n.1",
      upstreamVersion: "0.144.6",
      ultraRevision: 1,
      platform: "x86_64-pc-windows-msvc",
      binaryPath: join(
        installRoot,
        "releases",
        "0.144.6-ccu.i18n.1",
        "x86_64-pc-windows-msvc",
        "package",
        "bin",
        "codex.exe"
      ),
      size: 1,
      mtimeMs: 1,
      sha256: `sha256:${"a".repeat(64)}`
    },
    locale: null,
    lastKnownGood: null
  });
  await Promise.all([
    writeFile(join(codexHome, "ui-language"), "zh-CN\n", "utf8"),
    writeFile(join(codexHome, "ui-theme"), "ccu.deepseek\n", "utf8"),
    writeFile(
      join(codexHome, "ui-statusline-preset"),
      "ccu.deepseek\n",
      "utf8"
    )
  ]);
  let removedPath;

  const result = await uninstallCcu({
    installRoot,
    codexHome,
    removePathEntry: async (path) => {
      removedPath = path;
      return { changed: true };
    }
  });

  assert.equal(removedPath, join(installRoot, "bin"));
  assert.equal(result.pathRemoved, true);
  assert.deepEqual(result.removedPreferences.sort(), [
    "ui-language",
    "ui-statusline-preset",
    "ui-theme"
  ]);
  const state = await readState(statePath);
  assert.equal(state.active, null);
  assert.equal(state.official.version, "0.144.6");
  for (const name of result.removedPreferences) {
    await assert.rejects(
      readFile(join(codexHome, name), "utf8"),
      (error) => error?.code === "ENOENT"
    );
  }
});

test("uninstall preserves preferences not owned by CCU", async (t) => {
  const installRoot = await mkdtemp(join(tmpdir(), "ccu-uninstall-empty-"));
  const codexHome = await mkdtemp(join(tmpdir(), "ccu-uninstall-custom-home-"));
  t.after(() => rm(installRoot, { recursive: true, force: true }));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  await writeFile(join(codexHome, "ui-theme"), "my.custom.theme\n", "utf8");

  const result = await uninstallCcu({
    installRoot,
    codexHome,
    removePathEntry: async () => ({ changed: false })
  });

  assert.equal(result.changed, false);
  assert.equal(
    await readFile(join(codexHome, "ui-theme"), "utf8"),
    "my.custom.theme\n"
  );
});
