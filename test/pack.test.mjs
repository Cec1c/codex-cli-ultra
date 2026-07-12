import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { compileLanguagePack } from "../src/pack/compile.mjs";

const WIRED_RECORDS = [
  {
    id: "tui.status-line.setup.apply-theme-colors",
    ftlKey: "tui--status-line--setup--apply-theme-colors",
    mvpStatus: "wired"
  },
  {
    id: "tui.status-line.setup.configure-title",
    ftlKey: "tui--status-line--setup--configure-title",
    mvpStatus: "wired"
  },
  {
    id: "tui.status-line.setup.select-items-description",
    ftlKey: "tui--status-line--setup--select-items-description",
    mvpStatus: "wired"
  },
  {
    id: "tui.status-line.setup.use-theme-colors",
    ftlKey: "tui--status-line--setup--use-theme-colors",
    mvpStatus: "wired"
  },
  {
    id: "tui.onboarding.auth.sign-in-chatgpt",
    ftlKey: "tui--onboarding--auth--sign-in-chatgpt",
    mvpStatus: "catalogued"
  }
];

const VALID_FTL = [
  "tui--status-line--setup--use-theme-colors = 使用主题颜色",
  "tui--status-line--setup--apply-theme-colors = 应用当前 /theme 的颜色",
  "tui--status-line--setup--configure-title = 配置状态栏",
  "tui--status-line--setup--select-items-description = 选择要显示在状态栏中的项目。",
  ""
].join("\n");

async function createPackFixture({
  ftl = VALID_FTL,
  records = WIRED_RECORDS,
  hashOverride
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-pack-"));
  const packDir = join(root, "pack");
  const catalogPath = join(root, "catalog.jsonl");
  await mkdir(packDir, { recursive: true });
  const sha256 =
    hashOverride ??
    createHash("sha256").update(ftl).digest("hex");
  const manifest = {
    schemaVersion: 1,
    type: "language",
    id: "codex-cli-ultra.zh-CN",
    locale: "zh-CN",
    fallbackLocales: ["en-US"],
    codexVersionRange: "0.144.1",
    adapterVersion: "0.1.0",
    resources: [{ path: "messages.ftl", sha256 }]
  };
  await writeFile(
    catalogPath,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8"
  );
  await writeFile(
    join(packDir, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
  await writeFile(join(packDir, "messages.ftl"), ftl, "utf8");
  return { catalogPath, packDir };
}

test("compileLanguagePack emits all MVP-wired Chinese messages", async () => {
  const options = await createPackFixture();

  const compiled = await compileLanguagePack(options);

  assert.deepEqual(compiled.messages, {
    "tui.status-line.setup.apply-theme-colors": "应用当前 /theme 的颜色",
    "tui.status-line.setup.configure-title": "配置状态栏",
    "tui.status-line.setup.select-items-description":
      "选择要显示在状态栏中的项目。",
    "tui.status-line.setup.use-theme-colors": "使用主题颜色"
  });
  assert.equal(compiled.locale, "zh-CN");
  assert.match(compiled.sourceHash, /^sha256:[a-f0-9]{64}$/);
});

test("compileLanguagePack rejects a missing wired key", async () => {
  const options = await createPackFixture({
    ftl: VALID_FTL.replace(
      "tui--status-line--setup--configure-title = 配置状态栏\n",
      ""
    )
  });

  await assert.rejects(
    compileLanguagePack(options),
    /missing required key tui--status-line--setup--configure-title/
  );
});

test("compileLanguagePack rejects malformed FTL", async () => {
  const options = await createPackFixture({
    ftl: "tui--status-line--setup--configure-title = {\n"
  });

  await assert.rejects(compileLanguagePack(options), /FTL parse error/);
});

test("compileLanguagePack ignores catalogued but unwired messages", async () => {
  const options = await createPackFixture();

  const compiled = await compileLanguagePack(options);

  assert.equal(
    compiled.messages["tui.onboarding.auth.sign-in-chatgpt"],
    undefined
  );
});

test("compileLanguagePack rejects a resource hash mismatch", async () => {
  const options = await createPackFixture({ hashOverride: "0".repeat(64) });

  await assert.rejects(
    compileLanguagePack(options),
    /resource hash mismatch for messages\.ftl/
  );
});

test("compileLanguagePack rejects an empty formatted translation", async () => {
  const options = await createPackFixture({
    ftl: VALID_FTL.replace(
      "tui--status-line--setup--configure-title = 配置状态栏",
      'tui--status-line--setup--configure-title = { "" }'
    )
  });

  await assert.rejects(
    compileLanguagePack(options),
    /empty translation for tui--status-line--setup--configure-title/
  );
});
