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
    ftlKey: "tui--history--worked-for",
    args: [{ name: "duration", type: "string", sample: "7m 57s" }],
    mvpStatus: "wired"
  },
  {
    catalogVersion: 1,
    id: "tui.status-line.setup.apply-theme-colors",
    ftlKey: "tui--status-line--setup--apply-theme-colors",
    args: [],
    mvpStatus: "wired"
  },
  {
    catalogVersion: 1,
    id: "tui.status-line.setup.configure-title",
    ftlKey: "tui--status-line--setup--configure-title",
    args: [],
    mvpStatus: "wired"
  },
  {
    catalogVersion: 1,
    id: "tui.status-line.setup.select-items-description",
    ftlKey: "tui--status-line--setup--select-items-description",
    args: [],
    mvpStatus: "wired"
  },
  {
    catalogVersion: 1,
    id: "tui.status-line.setup.use-theme-colors",
    ftlKey: "tui--status-line--setup--use-theme-colors",
    args: [],
    mvpStatus: "wired"
  }
];

const CATALOGUED_RECORDS = [
  "api-key-billing-intro",
  "api-key-disabled-workspace",
  "paid-plan-intro",
  "pay-for-usage",
  "provide-api-key",
  "sign-in-chatgpt"
].map((name) => ({
  catalogVersion: 1,
  id: `tui.onboarding.auth.${name}`,
  ftlKey: `tui--onboarding--auth--${name}`,
  args: [],
  mvpStatus: "catalogued"
}));

const ALL_RECORDS = [...WIRED_RECORDS, ...CATALOGUED_RECORDS];

const VALID_FTL = [
  "tui--status-line--setup--use-theme-colors = 使用主题颜色",
  "tui--status-line--setup--apply-theme-colors = 应用当前 /theme 的颜色",
  "tui--status-line--setup--configure-title = 配置状态栏",
  "tui--status-line--setup--select-items-description = 选择要显示在状态栏中的项目。",
  "tui--history--worked-for = 加班了 { $duration }",
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
  mutateManifest
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-language-"));
  const packRoot = join(root, "pack");
  const catalogPath = join(root, "catalog.jsonl");
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
  return { packRoot, catalogPath };
}

test("validateLanguagePack formats the five wired messages with catalog samples", async () => {
  const { packRoot, catalogPath } = await createPackFixture();

  const result = await validateLanguagePack({ packRoot, catalogPath });
  assert.equal(result.locale, "zh-CN");
  assert.equal(Object.keys(result.messages).length, 5);
  assert.equal(result.messages["tui.history.worked-for"], "加班了 7m 57s");
  assert.match(result.sourceHash, /^sha256:[a-f0-9]{64}$/);
});

test("validateLanguagePack does not require translations for catalogued records", async () => {
  const { packRoot, catalogPath } = await createPackFixture();

  const result = await validateLanguagePack({ packRoot, catalogPath });

  for (const record of CATALOGUED_RECORDS) {
    assert.equal(result.messages[record.id], undefined);
  }
});

test("validateLanguagePack rejects a missing wired key", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    ftl: VALID_FTL.replace(
      "tui--status-line--setup--configure-title = 配置状态栏\n",
      ""
    )
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /missing required key tui--status-line--setup--configure-title/
  );
});

test("validateLanguagePack rejects malformed FTL", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    ftl: "tui--history--worked-for = 加班了 { $duration\n"
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
      "tui--history--worked-for = 加班了 { $duration }",
      "tui--history--worked-for = { NUMBER($duration minimumFractionDigits: 2) }"
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

  assert.equal(Object.keys(result.messages).length, 5);
});

test("validateLanguagePack rejects an empty formatted translation", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    ftl: VALID_FTL.replace(
      "tui--status-line--setup--configure-title = 配置状态栏",
      'tui--status-line--setup--configure-title = { "" }'
    )
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /empty translation for tui--status-line--setup--configure-title/
  );
});

test("validateLanguagePack rejects a translation missing duration", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    ftl: VALID_FTL.replace(
      "tui--history--worked-for = 加班了 { $duration }",
      "tui--history--worked-for = 加班了"
    )
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /translation tui--history--worked-for does not use argument duration/
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

test("validateLanguagePack rejects a mismatched logical ID alias", async () => {
  const records = structuredClone(ALL_RECORDS);
  const record = records.find(
    (item) => item.id === "tui.status-line.setup.configure-title"
  );
  record.ftlKey = "tui--status-line--setup--configure-heading";
  const { packRoot, catalogPath } = await createPackFixture({
    records,
    ftl: VALID_FTL.replace(
      "tui--status-line--setup--configure-title = 配置状态栏",
      "tui--status-line--setup--configure-heading = 配置状态栏"
    )
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /ftlKey .* must equal tui--status-line--setup--configure-title/
  );
});

test("validateLanguagePack rejects a noncanonical logical message ID", async () => {
  const records = structuredClone(ALL_RECORDS);
  records[5].id = "Tui.onboarding.auth.api-key-billing-intro";
  records[5].ftlKey = records[5].id.replaceAll(".", "--");
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

test("validateLanguagePack rejects a catalog with only four wired records", async () => {
  const records = structuredClone(ALL_RECORDS);
  records[0].mvpStatus = "catalogued";
  const { packRoot, catalogPath } = await createPackFixture({ records });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /catalog must contain exactly 11 records: 5 wired and 6 catalogued/
  );
});

test("validateLanguagePack rejects an extra catalog record", async () => {
  const records = structuredClone(ALL_RECORDS);
  records.push({
    catalogVersion: 1,
    id: "tui.extra.message",
    ftlKey: "tui--extra--message",
    args: [],
    mvpStatus: "catalogued"
  });
  const { packRoot, catalogPath } = await createPackFixture({ records });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /catalog must contain exactly 11 records: 5 wired and 6 catalogued/
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

test("validateLanguagePack requires the GPL-3.0-only manifest license", async () => {
  const { packRoot, catalogPath } = await createPackFixture({
    mutateManifest(manifest) {
      manifest.license = "Apache-2.0";
    }
  });

  await assert.rejects(
    validateLanguagePack({ packRoot, catalogPath }),
    /manifest license must be GPL-3\.0-only/
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
