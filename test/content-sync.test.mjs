import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import yauzl from "yauzl";

import { syncBundledContent } from "../src/content/sync.mjs";
import { RUNTIME_PLATFORM } from "../src/config/constants.mjs";
import { forkManifestName } from "../src/release/fork-manifest.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

async function contentFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "ccu-content-languages-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const contentRoot = join(root, "source");
  const languagesRoot = join(contentRoot, "packages", "languages");
  const catalogRoot = join(contentRoot, "research", "codex-0.144.5");
  const templateRoot = join(contentRoot, "templates", "languages");
  await Promise.all([
    mkdir(languagesRoot, { recursive: true }),
    mkdir(catalogRoot, { recursive: true }),
    mkdir(templateRoot, { recursive: true }),
    cp(join(projectRoot, "packages", "themes"), join(contentRoot, "packages", "themes"), {
      recursive: true
    })
  ]);
  await writeFile(join(catalogRoot, "tui-messages.jsonl"), JSON.stringify({
    catalogVersion: 1,
    id: "fixture.greeting",
    ftlKey: "fixture-greeting",
    mvpStatus: "wired",
    args: [{ name: "name", sample: "Ihering" }]
  }) + "\n");
  await writeFile(join(templateRoot, "messages.en-US.ftl"), "fixture-greeting = Hello { $name }!\n");
  async function language(locale, greeting) {
    const packRoot = join(languagesRoot, locale);
    const messages = `fixture-greeting = ${greeting} { $name }!\n`;
    await mkdir(packRoot, { recursive: true });
    await writeFile(join(packRoot, "messages.ftl"), messages);
    await writeFile(join(packRoot, "manifest.json"), JSON.stringify({
      schemaVersion: 1,
      type: "language",
      id: `fixture.${locale}`,
      locale,
      license: "MIT",
      i18nApi: { min: 1, max: 1 },
      catalogVersion: 1,
      fallbackLocales: ["en-US"],
      resources: [{
        path: "messages.ftl",
        sha256: `sha256:${createHash("sha256").update(messages).digest("hex")}`
      }]
    }));
    return messages;
  }
  await language("zh-CN", "你好");
  await language("pt-BR", "Olá");
  return { root, contentRoot, languagesRoot, language };
}

test("content sync installs, caches and updates every bundled locale without changing user choices", async (t) => {
  const { root, contentRoot, language } = await contentFixture(t);
  const installRoot = join(root, "install");
  const codexHome = join(root, "codex-home");
  const externalPack = join(installRoot, "languages", "es-ES", "messages.ftl");
  await Promise.all([
    mkdir(codexHome, { recursive: true }),
    mkdir(dirname(externalPack), { recursive: true })
  ]);
  await writeFile(join(codexHome, "ui-language"), "pt-BR\n");
  await writeFile(externalPack, "user-owned language pack\n");
  const options = { contentRoot, installRoot, env: { CODEX_HOME: codexHome } };
  const result = await syncBundledContent(options);
  assert.deepEqual(result.language, { locale: "zh-CN", messages: 1 });
  for (const locale of ["zh-CN", "pt-BR"]) {
    const installed = await readFile(join(installRoot, "languages", locale, "messages.ftl"), "utf8");
    assert.equal(installed, await readFile(join(contentRoot, "packages", "languages", locale, "messages.ftl"), "utf8"));
    assert.equal(installed, await readFile(join(result.contentRoot, "languages", locale, "messages.ftl"), "utf8"));
  }
  const updated = await language("pt-BR", "Bem-vindo");
  await syncBundledContent(options);
  const installedPortuguese = join(installRoot, "languages", "pt-BR", "messages.ftl");
  assert.equal(await readFile(installedPortuguese, "utf8"), updated);
  await rm(join(installRoot, "languages", "pt-BR"), { recursive: true });
  await syncBundledContent({ ...options, contentRoot: result.contentRoot });
  assert.equal(await readFile(installedPortuguese, "utf8"), updated);
  assert.equal(await readFile(join(codexHome, "ui-language"), "utf8"), "pt-BR\n");
  assert.equal(await readFile(externalPack, "utf8"), "user-owned language pack\n");
});

test("content sync rejects an invalid bundled locale before replacing any installed pack", async (t) => {
  const { root, contentRoot, languagesRoot } = await contentFixture(t);
  const installRoot = join(root, "install");
  const existingPack = join(installRoot, "languages", "pt-BR", "messages.ftl");
  await mkdir(dirname(existingPack), { recursive: true });
  await writeFile(existingPack, "preserve installed content\n");
  await writeFile(join(languagesRoot, "zh-CN", "messages.ftl"), "broken hash\n");
  await assert.rejects(syncBundledContent({
    contentRoot,
    installRoot,
    env: { CODEX_HOME: join(root, "codex-home") }
  }), /resource hash mismatch/);
  assert.equal(await readFile(existingPack, "utf8"), "preserve installed content\n");
  await assert.rejects(readFile(join(installRoot, "content", "languages", "pt-BR", "manifest.json")), {
    code: "ENOENT"
  });
});

test("release packaging includes every validated locale and rejects a corrupt pack", async (t) => {
  const { root, contentRoot, languagesRoot } = await contentFixture(t);
  const forkRoot = join(root, "fork-release");
  await Promise.all([
    cp(join(projectRoot, "src"), join(contentRoot, "src"), { recursive: true }),
    mkdir(join(contentRoot, "scripts"), { recursive: true }),
    mkdir(join(contentRoot, "dist"), { recursive: true }),
    mkdir(join(contentRoot, "tui", "target", "release"), { recursive: true }),
    mkdir(forkRoot, { recursive: true }),
    symlink(join(projectRoot, "node_modules"), join(contentRoot, "node_modules"), "junction")
  ]);
  await cp(join(projectRoot, "scripts", "package-release.mjs"), join(contentRoot, "scripts", "package-release.mjs"));
  await writeFile(join(contentRoot, "package.json"), JSON.stringify({ version: "0.1.27", type: "module" }));
  for (const path of [
    "dist/codex-ultra.mjs", "dist/launcher.mjs", "README.md", "README.en.md", "LICENSE",
    "install.sh", "uninstall.sh", "install.ps1", "install.cmd", "uninstall.ps1", "uninstall.cmd",
    `tui/target/release/${RUNTIME_PLATFORM.managerName}`, "packages/quota.example.json"
  ]) {
    await writeFile(join(contentRoot, path), "fixture\n");
  }
  const asset = Buffer.from("fixture fork asset\n");
  await writeFile(join(forkRoot, "codex.zip"), asset);
  await writeFile(join(forkRoot, forkManifestName()), JSON.stringify({
    schemaVersion: 1,
    type: "codex-ccu-i18n-build",
    releaseTag: "ccu-rust-v0.144.5-r1",
    displayVersion: "v0.144.5-CCU.R1",
    upstreamVersion: "0.144.5",
    upstreamTag: "rust-v0.144.5",
    upstreamCommit: "a".repeat(40),
    forkCommit: "b".repeat(40),
    ultraRevision: 1,
    i18nApiVersion: 1,
    platform: RUNTIME_PLATFORM.target,
    asset: { name: "codex.zip", size: asset.length, sha256: `sha256:${createHash("sha256").update(asset).digest("hex")}` }
  }));
  const run = () => promisify(execFile)(process.execPath, [
    join(contentRoot, "scripts", "package-release.mjs"),
    "--skip-build", "--fork-release-dir", forkRoot, "--output", join(root, "output")
  ]);
  const report = JSON.parse((await run()).stdout);
  const releaseArchive = await readFile(report.zip);
  const entries = await new Promise((resolvePromise, reject) => {
    yauzl.open(report.zip, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const names = [];
      zip.on("error", reject);
      zip.on("entry", (entry) => { names.push(entry.fileName); zip.readEntry(); });
      zip.on("end", () => resolvePromise(names));
      zip.readEntry();
    });
  });
  for (const locale of ["zh-CN", "pt-BR"]) {
    assert.ok(entries.some((path) => path.endsWith(`/content/languages/${locale}/messages.ftl`)));
  }
  await writeFile(join(languagesRoot, "pt-BR", "messages.ftl"), "invalid hash\n");
  await assert.rejects(run(), /resource hash mismatch/);
  assert.deepEqual(await readFile(report.zip), releaseArchive, "validation failure must preserve the previous release");
});

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
  assert.equal(result.language.messages, 1969);
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
    await readFile(join(installRoot, "themes", "rainbow_color", "theme.json"), "utf8")
  );
  assert.equal(theme.statusLine.separator, " │ ");
  assert.equal(theme.statusLine.modelReasoningStyle, "bracketed");
  assert.deepEqual(theme.statusLine.modelEmojis, ["🐱"]);
  assert.equal(theme.statusLine.palette.length, 0);
  assert.equal(theme.statusLine.randomizePalette, false);
  assert.equal(theme.statusLine.softenColors, false);
  assert.equal(theme.welcome.border, "#ED8796");
  assert.equal(theme.interface.layout, "claude");
  assert.equal(
    JSON.parse(
      await readFile(join(installRoot, "themes", "ccu.hermes", "theme.json"), "utf8")
    ).id,
    "ccu.hermes"
  );
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
  assert.equal(cachedResult.language.messages, 1969);
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
    statusLinePreset: "rainbow_color",
    env: { CODEX_HOME: codexHome }
  });
  assert.equal(themedResult.theme.statusLinePresetEnabled, true);
  assert.equal(
    await readFile(join(codexHome, "ui-statusline-preset"), "utf8"),
    "rainbow_color\n"
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
  assert.match(source, /packages\\themes\\rainbow_color/);
  assert.match(packager, /packages\\themes\\rainbow_color/);
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

test("content sync migrates the legacy DeepSeek preset and applies rainbow config", async (t) => {
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
  assert.equal(await readFile(join(codexHome, "ui-theme"), "utf8"), "rainbow_color\n");
  assert.equal(
    await readFile(join(codexHome, "ui-statusline-preset"), "utf8"),
    "rainbow_color\n"
  );
  assert.equal(result.theme.statusLinePresetEnabled, true);
  assert.match(
    await readFile(join(codexHome, "config.toml"), "utf8"),
    /"context-progress"/
  );
});

test("content sync migrates the owned ice theme and enables the rainbow status line", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ccu-content-ice-theme-"));
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
    writeFile(join(codexHome, "ui-theme"), "ccu.ice-banner\n", "utf8"),
    writeFile(join(codexHome, "config.toml"), "[tui]\nstatus_line = []\n", "utf8")
  ]);

  const result = await syncBundledContent({
    contentRoot: join(installRoot, "content"),
    installRoot,
    env: { CODEX_HOME: codexHome }
  });

  assert.equal(await readFile(join(codexHome, "ui-theme"), "utf8"), "rainbow_color\n");
  assert.equal(
    await readFile(join(codexHome, "ui-statusline-preset"), "utf8"),
    "rainbow_color\n"
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
