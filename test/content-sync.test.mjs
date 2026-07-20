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
  assert.equal(result.language.messages, 1396);
  assert.equal(result.contentRoot, join(installRoot, "content"));
  assert.equal(await readFile(join(codexHome, "ui-language"), "utf8"), "zh-CN\n");
  assert.equal(await readFile(join(codexHome, "ui-theme"), "utf8"), "my.custom.theme\n");
  await assert.rejects(
    readFile(join(codexHome, "ui-statusline-preset"), "utf8"),
    (error) => error?.code === "ENOENT"
  );
  assert.match(
    await readFile(join(installRoot, "languages", "zh-CN", "messages.ftl"), "utf8"),
    /session-card-yolo-mode = YOLO 模式/
  );
  assert.equal(
    await readFile(join(installRoot, "content", "languages", "zh-CN", "messages.ftl"), "utf8"),
    await readFile(join(installRoot, "languages", "zh-CN", "messages.ftl"), "utf8")
  );
  assert.match(
    await readFile(join(installRoot, "content", "catalog", "messages.en-US.ftl"), "utf8"),
    /status-line-item-context-tokens-description = Current tokens used/
  );
  const theme = JSON.parse(
    await readFile(join(installRoot, "themes", "ccu.hermes", "theme.json"), "utf8")
  );
  assert.equal(theme.statusLine.separator, " │ ");
  assert.equal(theme.statusLine.modelReasoningStyle, "bracketed");
  assert.equal(theme.statusLine.modelEmojis.length, 20);
  assert.equal(theme.statusLine.palette.length, 10);
  const quotaExample = JSON.parse(
    await readFile(join(installRoot, "quota.example.json"), "utf8")
  );
  assert.deepEqual(
    quotaExample.accounts.map(({ balance, currency }) => ({ balance, currency })),
    [
      { balance: 5.96, currency: "CNY" },
      { balance: 12, currency: "CNY" }
    ]
  );

  const cachedResult = await syncBundledContent({
    contentRoot: join(installRoot, "content"),
    installRoot,
    env: { CODEX_HOME: codexHome }
  });
  assert.equal(cachedResult.language.messages, 1396);
  assert.equal(cachedResult.contentRoot, join(installRoot, "content"));

  const originalConfig = [
    "[tui]",
    "status_line = []",
    "status_line_use_colors = false",
    "theme = \"catppuccin-macchiato\"",
    ""
  ].join("\n");
  await writeFile(join(codexHome, "config.toml"), originalConfig, "utf8");
  const themedResult = await syncBundledContent({
    contentRoot: join(installRoot, "content"),
    installRoot,
    statusLinePreset: "ccu.hermes",
    env: { CODEX_HOME: codexHome }
  });
  assert.equal(themedResult.theme.statusLinePresetEnabled, true);
  assert.equal(
    await readFile(join(codexHome, "ui-statusline-preset"), "utf8"),
    "ccu.hermes\n"
  );
  assert.match(
    await readFile(join(codexHome, "config.toml"), "utf8"),
    /status_line = \[\n  "model-with-reasoning",[\s\S]*"session-timing",\n\]/
  );
  assert.match(
    await readFile(join(codexHome, "config.toml"), "utf8"),
    /status_line_use_colors = true/
  );

  const disabledResult = await syncBundledContent({
    contentRoot: join(installRoot, "content"),
    installRoot,
    statusLinePreset: null,
    env: { CODEX_HOME: codexHome }
  });
  assert.equal(disabledResult.theme.statusLinePresetEnabled, false);
  await assert.rejects(
    readFile(join(codexHome, "ui-statusline-preset"), "utf8"),
    (error) => error?.code === "ENOENT"
  );
  assert.equal(await readFile(join(codexHome, "config.toml"), "utf8"), originalConfig);
});

test("installer guards recursive content replacement with an absolute child-path check", async () => {
  const source = await readFile(join(projectRoot, "install.ps1"), "utf8");
  const packager = await readFile(join(projectRoot, "scripts", "package-release.ps1"), "utf8");
  assert.match(source, /function Assert-ChildPath/);
  assert.match(source, /StartsWith\(\$rootPrefix, \[System\.StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(source, /InstallRoot must not be the installer source directory/);
  assert.match(packager, /Release staging directory/);
  assert.match(packager, /Release ZIP/);
  assert.match(source, /messages\.en-US\.ftl/);
  assert.match(packager, /messages\.en-US\.ftl/);
  assert.match(source, /fork-release/);
  assert.match(source, /--enable-statusline/);
  assert.match(source, /--disable-statusline/);
  assert.match(source, /function Invoke-CheckedCommand/);
  assert.match(source, /function Invoke-CcuInstall/);
  assert.match(source, /function Test-NetworkFailureText/);
  assert.match(source, /function Test-NodeDependencies/);
  assert.match(source, /Node 依赖缺失或与 package\.json 不一致/);
  assert.match(source, /CCU Node dependency installation failed/);
  assert.match(source, /CCU Node manager build failed/);
  assert.match(source, /CCU Rust manager build failed/);
  assert.match(source, /'build', '--release', '--locked'/);
  assert.match(source, /Required build output was not created/);
  assert.match(source, /你的网络跳起来没够到墙/);
  assert.match(source, /codex-cli-ultra\/releases/);
  assert.match(source, /安装程序提桶跑路/);
  assert.match(packager, /ForkReleaseDir is required/);
  assert.match(packager, /ccu-fork-manifest\.json/);
  assert.match(packager, /uninstall\.cmd/);
});

test("content sync migrates the legacy DeepSeek preset and applies Hermes config", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ccu-content-legacy-theme-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = join(root, "codex-home");
  const installRoot = join(root, "install");
  await writeFile(join(root, "placeholder"), "", "utf8");
  await syncBundledContent({
    contentRoot: projectRoot,
    installRoot,
    env: { CODEX_HOME: codexHome }
  });
  await Promise.all([
    writeFile(join(codexHome, "ui-theme"), "ccu.deepseek\n", "utf8"),
    writeFile(join(codexHome, "ui-statusline-preset"), "ccu.deepseek\n", "utf8"),
    writeFile(join(codexHome, "config.toml"), "[tui]\nstatus_line = []\n", "utf8")
  ]);

  const result = await syncBundledContent({
    contentRoot: join(installRoot, "content"),
    installRoot,
    env: { CODEX_HOME: codexHome }
  });
  assert.equal(await readFile(join(codexHome, "ui-theme"), "utf8"), "ccu.hermes\n");
  assert.equal(
    await readFile(join(codexHome, "ui-statusline-preset"), "utf8"),
    "ccu.hermes\n"
  );
  assert.equal(result.theme.statusLinePresetEnabled, true);
  assert.match(
    await readFile(join(codexHome, "config.toml"), "utf8"),
    /"context-progress"/
  );
});

test("PowerShell installer lets the core claim ownership before copying local payloads", async () => {
  const source = await readFile(join(projectRoot, "install.ps1"), "utf8");
  const installCall = source.lastIndexOf("Invoke-CcuInstall");
  const managerCopy = source.indexOf("Copy-Item -LiteralPath $managerExecutable");
  const contentCopy = source.indexOf("Copy-Item -LiteralPath $contentSource -Destination $content -Recurse");

  assert.ok(installCall >= 0, "core install invocation must exist");
  assert.ok(managerCopy > installCall, "manager executable must be copied after ownership");
  assert.ok(contentCopy > installCall, "bundled content must be copied after ownership");
  assert.match(source, /\$env:CODEX_CCU_CONTENT_ROOT = \$contentSource/);
  assert.match(source, /Temporary content directory/);
});
