import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateLanguagePack } from "../src/language/validate.mjs";

const WIRED_RECORDS = [
  {
    catalogVersion: 1,
    id: "tui.history.worked-for",
    ftlKey: "history-worked-for",
    args: [{ name: "duration", type: "string", sample: "7m 57s" }],
    mvpStatus: "wired"
  },
  {
    catalogVersion: 1,
    id: "tui.status-line.setup.apply-theme-colors",
    ftlKey: "status-line-apply-theme-colors",
    args: [],
    mvpStatus: "wired"
  },
  {
    catalogVersion: 1,
    id: "tui.status-line.setup.configure-title",
    ftlKey: "status-line-configure-title",
    args: [],
    mvpStatus: "wired"
  },
  {
    catalogVersion: 1,
    id: "tui.status-line.setup.select-items-description",
    ftlKey: "status-line-select-items-description",
    args: [],
    mvpStatus: "wired"
  },
  {
    catalogVersion: 1,
    id: "tui.status-line.setup.use-theme-colors",
    ftlKey: "status-line-use-theme-colors",
    args: [],
    mvpStatus: "wired"
  }
];

const ONBOARDING_WIRED_RECORDS = [
  "api-key-billing-intro",
  "api-key-disabled-workspace",
  "paid-plan-intro",
  "pay-for-usage",
  "provide-api-key",
  "sign-in-chatgpt"
].map((name) => ({
  catalogVersion: 1,
  id: `tui.onboarding.auth.${name}`,
  ftlKey: `onboarding-${name}`,
  args: [],
  mvpStatus: "wired"
}));

const ALL_RECORDS = [...WIRED_RECORDS, ...ONBOARDING_WIRED_RECORDS];

const VALID_FTL = [
  "status-line-use-theme-colors = 使用主题颜色",
  "status-line-apply-theme-colors = 应用当前 /theme 的颜色",
  "status-line-configure-title = 配置状态栏",
  "status-line-select-items-description = 选择要显示在状态栏中的项目。",
  "onboarding-paid-plan-intro = 登录 ChatGPT，将 Codex 作为付费方案的一部分使用",
  "onboarding-api-key-billing-intro = 或连接 API 密钥，按使用量计费",
  "onboarding-sign-in-chatgpt = 登录 ChatGPT",
  "onboarding-provide-api-key = 提供您自己的 API 密钥",
  "onboarding-pay-for-usage = 按使用量付费",
  "onboarding-api-key-disabled-workspace = 此工作区已禁用 API 密钥登录。请登录 ChatGPT 以继续。",
  "history-worked-for = 工作了 { $duration }",
  ""
].join("\n");

const VALID_TEMPLATE_FTL = [
  "status-line-use-theme-colors = Use theme colors",
  "status-line-apply-theme-colors = Apply colors from the active /theme",
  "status-line-configure-title = Configure Status Line",
  "status-line-select-items-description = Select which items to display in the status line.",
  "onboarding-paid-plan-intro = Sign in with ChatGPT to use Codex as part of your paid plan",
  "onboarding-api-key-billing-intro = or connect an API key for usage-based billing",
  "onboarding-sign-in-chatgpt = Sign in with ChatGPT",
  "onboarding-provide-api-key = Provide your own API key",
  "onboarding-pay-for-usage = Pay for what you use",
  "onboarding-api-key-disabled-workspace = API key login is disabled by this workspace.",
  "history-worked-for = Worked for { $duration }",
  ""
].join("\n");

function createManifest(ftl) {
  const hash = createHash("sha256").update(ftl).digest("hex");
  return {
    schemaVersion: 1,
    type: "language",
    id: "codex-cli-ultra.zh-CN",
    locale: "zh-CN",
    license: "GPL-3.0-only",
    i18nApi: { min: 1, max: 1 },
    catalogVersion: 1,
    fallbackLocales: [],
    resources: [
      { path: "messages.ftl", sha256: `sha256:${hash}` }
    ]
  };
}

async function createPackFixture({
  ftl = VALID_FTL,
  ftlBytes,
  records = ALL_RECORDS,
  templateFtl,
  mutateManifest
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-language-"));
  const packRoot = join(root, "pack");
  const catalogPath = join(root, "catalog.jsonl");
  const templatePath = templateFtl === undefined
    ? undefined
    : join(root, "messages.en-US.ftl");
  await mkdir(packRoot, { recursive: true });
  const ftlSource = ftlBytes ?? ftl;
  const manifest = createManifest(ftlSource);
  mutateManifest?.(manifest);
  await writeFile(
    catalogPath,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8"
  );
  await writeFile(
    join(packRoot, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8"
  );
  await writeFile(join(packRoot, "messages.ftl"), ftlSource);
  if (templatePath) {
    await writeFile(templatePath, templateFtl, "utf8");
  }
  return { packRoot, catalogPath, templatePath };
}

test("validateLanguagePack formats all eleven wired messages with catalog samples", async () => {
  const { packRoot, catalogPath } = await createPackFixture();

  const result = await validateLanguagePack({ packRoot, catalogPath });
  assert.equal(result.locale, "zh-CN");
  assert.equal(Object.keys(result.messages).length, 11);
  assert.equal(result.messages["tui.history.worked-for"], "工作了 7m 57s");
  assert.equal(
    result.messages["tui.onboarding.auth.sign-in-chatgpt"],
    "登录 ChatGPT"
  );
  assert.match(result.sourceHash, /^sha256:[a-f0-9]{64}$/);
});

test("validateLanguagePack enforces an exact translator template contract", async () => {
  const { packRoot, catalogPath, templatePath } = await createPackFixture({
    templateFtl: VALID_TEMPLATE_FTL
  });

  const result = await validateLanguagePack({ packRoot, catalogPath, templatePath });
  assert.equal(result.messageCount, 11);
});

test("validateLanguagePack rejects a key missing from the translation template", async () => {
  const { packRoot, catalogPath, templatePath } = await createPackFixture({
    templateFtl: `${VALID_TEMPLATE_FTL}template-only = Template only\n`
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath, templatePath }),
    /translation is missing template key template-only/
  );
});

test("validateLanguagePack rejects a translation key outside the template", async () => {
  const { packRoot, catalogPath, templatePath } = await createPackFixture({
    ftl: `${VALID_FTL}translation-only = 仅翻译包存在\n`,
    templateFtl: VALID_TEMPLATE_FTL
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath, templatePath }),
    /translation contains key not declared by template: translation-only/
  );
});

test("validateLanguagePack requires the same variables as the template", async () => {
  const { packRoot, catalogPath, templatePath } = await createPackFixture({
    ftl: `${VALID_FTL}template-variable = 已用 { $actual }\n`,
    templateFtl: `${VALID_TEMPLATE_FTL}template-variable = Used { $expected }\n`
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath, templatePath }),
    /translation template-variable variables must be \[expected\], found \[actual\]/
  );
});

test("validateLanguagePack rejects a missing wired key", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    ftl: VALID_FTL.replace(
      "status-line-configure-title = 配置状态栏\n",
      ""
    )
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /missing required key status-line-configure-title/
  );
});

test("validateLanguagePack rejects malformed FTL", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    ftl: "history-worked-for = 工作了 { $duration\n"
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /FTL (?:parse|resource) error/
  );
});

test("validateLanguagePack rejects syntax accepted only by the permissive runtime parser", async () => {
  const records = structuredClone(ALL_RECORDS);
  records[0].args[0].sample = 7.95;
  const { packRoot, catalogPath } = await createPackFixture({
    records,
    ftl: VALID_FTL.replace(
      "history-worked-for = 工作了 { $duration }",
      "history-worked-for = { NUMBER($duration minimumFractionDigits: 2) }"
    )
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /FTL parse error/
  );
});

test("validateLanguagePack rejects a resource hash mismatch", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    mutateManifest(manifest) {
      manifest.resources[0].sha256 = `sha256:${"0".repeat(64)}`;
    }
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /resource hash mismatch for messages\.ftl/
  );
});

test("validateLanguagePack can explicitly skip resource hash verification", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    mutateManifest(manifest) {
      manifest.resources[0].sha256 = `sha256:${"0".repeat(64)}`;
    }
  });

  const result = await validateLanguagePack({
    packRoot,
    catalogPath,
    verifyHashes: false
  });

  assert.equal(Object.keys(result.messages).length, 11);
});

test("validateLanguagePack rejects an empty formatted translation", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    ftl: VALID_FTL.replace(
      "status-line-configure-title = 配置状态栏",
      'status-line-configure-title = { "" }'
    )
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /empty translation for status-line-configure-title/
  );
});

test("validateLanguagePack rejects a translation missing duration", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    ftl: VALID_FTL.replace(
      "history-worked-for = 工作了 { $duration }",
      "history-worked-for = 工作了"
    )
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /translation history-worked-for does not use argument duration/
  );
});

test("validateLanguagePack rejects a noncanonical fallback locale", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    mutateManifest(manifest) {
      manifest.fallbackLocales = ["EN-us"];
    }
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /fallback locale EN-us must be canonical as en-US/
  );
});

test("validateLanguagePack rejects a self fallback locale", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    mutateManifest(manifest) {
      manifest.fallbackLocales = ["zh-CN"];
    }
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /fallback locale zh-CN must not equal pack locale/
  );
});

test("validateLanguagePack rejects duplicate fallback locales", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    mutateManifest(manifest) {
      manifest.fallbackLocales = ["en-US", "en-US"];
    }
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /duplicate fallback locale en-US/
  );
});

test("validateLanguagePack rejects an invalid Fluent message ID", async () => {
  const records = structuredClone(ALL_RECORDS);
  const record = records.find(
    (item) => item.id === "tui.status-line.setup.configure-title"
  );
  record.ftlKey = "Status.Line";
  const { packRoot, catalogPath } = await createPackFixture({ records });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /invalid Fluent message id Status\.Line/
  );
});

test("validateLanguagePack rejects a noncanonical logical message ID", async () => {
  const records = structuredClone(ALL_RECORDS);
  records[5].id = "Tui.onboarding.auth.api-key-billing-intro";
  const { packRoot, catalogPath } = await createPackFixture({ records });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /invalid logical message id/
  );
});

test("validateLanguagePack rejects an unknown catalog MVP status", async () => {
  const records = structuredClone(ALL_RECORDS);
  records[5].mvpStatus = "wiredd";
  const { packRoot, catalogPath } = await createPackFixture({ records });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /unknown mvpStatus wiredd/
  );
});

test("validateLanguagePack does not require translations for catalogued records", async () => {
  const records = structuredClone(ALL_RECORDS);
  records[0].mvpStatus = "catalogued";
  const { packRoot, catalogPath } = await createPackFixture({ records });

  const result = await validateLanguagePack({ packRoot, catalogPath });
  assert.equal(Object.keys(result.messages).length, 10);
  assert.equal(result.messages[records[0].id], undefined);
});

test("validateLanguagePack rejects an extra catalog record", async () => {
  const records = structuredClone(ALL_RECORDS);
  records.push({
    catalogVersion: 1,
    id: "tui.extra.message",
    ftlKey: "extra-message",
    args: [],
    mvpStatus: "wired"
  });
  const { packRoot, catalogPath } = await createPackFixture({ records });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /missing required key extra-message/
  );
});

test("validateLanguagePack rejects duplicate IDs across catalog statuses", async () => {
  const records = structuredClone(ALL_RECORDS);
  records[5].id = records[0].id;
  records[5].ftlKey = records[0].ftlKey;
  const { packRoot, catalogPath } = await createPackFixture({ records });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /duplicate catalog id tui\.history\.worked-for/
  );
});

test("validateLanguagePack rejects a non-1 catalog version before filtering", async () => {
  const records = structuredClone(ALL_RECORDS);
  records[5].catalogVersion = 2;
  const { packRoot, catalogPath } = await createPackFixture({ records });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /catalogVersion 1/
  );
});

test("validateLanguagePack rejects messages.ftl bytes that are not valid UTF-8", async () => {
  const invalidFtl = Buffer.from(VALID_FTL);
  const invalidIndex = invalidFtl.indexOf(Buffer.from("使用"));
  assert.notEqual(invalidIndex, -1);
  invalidFtl[invalidIndex] = 0xff;
  const { packRoot, catalogPath } = await createPackFixture({
    ftlBytes: invalidFtl
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /messages\.ftl must be valid UTF-8/
  );
});

test("validateLanguagePack accepts a nonempty third-party SPDX license", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    mutateManifest(manifest) {
      manifest.license = "MIT";
    }
  });

  const result = await validateLanguagePack({ packRoot, catalogPath });

  assert.equal(Object.keys(result.messages).length, 11);
});

test("validateLanguagePack rejects an empty manifest license", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    mutateManifest(manifest) {
      manifest.license = "";
    }
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /manifest license must be a non-empty string/
  );
});

test("validateLanguagePack rejects a whitespace-only manifest license", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    mutateManifest(manifest) {
      manifest.license = "   ";
    }
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /manifest license must be a non-empty string/
  );
});

test("the zh-CN language pack manifest declares GPL-3.0-only", async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL("../packages/languages/zh-CN/manifest.json", import.meta.url),
      "utf8"
    )
  );

  assert.equal(manifest.license, "GPL-3.0-only");
});

test("validateLanguagePack rejects malformed catalog JSONL as data", async () => {
  const { packRoot, catalogPath } = await createPackFixture();
  await writeFile(catalogPath, "{ not json }\n", "utf8");

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /invalid catalog JSON on line 1/
  );
});

test("validateLanguagePack rejects malformed manifest JSON as data", async () => {
  const { packRoot, catalogPath } = await createPackFixture();
  await writeFile(join(packRoot, "manifest.json"), "{ not json }\n", "utf8");

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /invalid language pack manifest JSON/
  );
});

test("validateLanguagePack rejects an incompatible manifest contract", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    mutateManifest(manifest) {
      manifest.i18nApi.max = 2;
    }
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /invalid language pack manifest/
  );
});
