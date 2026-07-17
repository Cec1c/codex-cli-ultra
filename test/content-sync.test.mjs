import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { syncBundledContent } from "../src/content/sync.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("content sync migrates the legacy zh-Hans preference and preserves the theme", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ccu-content-sync-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = join(root, "codex-home");
  const installRoot = join(root, "install");
  await writeFile(join(root, "placeholder"), "", "utf8");
  await syncBundledContent({
    contentRoot: projectRoot,
    installRoot,
    env: { CODEX_HOME: codexHome }
  });
  await writeFile(join(codexHome, "ui-language"), "zh-Hans\n", "utf8");
  await writeFile(join(codexHome, "ui-theme"), "my.custom.theme\n", "utf8");

  const result = await syncBundledContent({
    contentRoot: projectRoot,
    installRoot,
    env: { CODEX_HOME: codexHome }
  });

  assert.equal(result.language.locale, "zh-CN");
  assert.equal(await readFile(join(codexHome, "ui-language"), "utf8"), "zh-CN\n");
  assert.equal(await readFile(join(codexHome, "ui-theme"), "utf8"), "my.custom.theme\n");
  assert.match(
    await readFile(join(installRoot, "languages", "zh-CN", "messages.ftl"), "utf8"),
    /session-card-yolo-mode = YOLO 模式/
  );
});

test("installer guards recursive content replacement with an absolute child-path check", async () => {
  const source = await readFile(join(projectRoot, "install.ps1"), "utf8");
  const packager = await readFile(join(projectRoot, "scripts", "package-release.ps1"), "utf8");
  assert.match(source, /function Assert-ChildPath/);
  assert.match(source, /StartsWith\(\$rootPrefix, \[System\.StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(source, /InstallRoot must not be the installer source directory/);
  assert.match(packager, /Release staging directory/);
  assert.match(packager, /Release ZIP/);
});
