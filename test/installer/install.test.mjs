import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  INSTALL_STAGES,
  installFromProvider,
  runBinarySmokeChecks
} from "../../src/installer/install.mjs";
import { readState } from "../../src/state/store.mjs";

const PROJECT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const CATALOG_PATH = join(
  PROJECT_ROOT,
  "research/codex-0.144.1/tui-messages.jsonl"
);
const LANGUAGE_ROOT = join(PROJECT_ROOT, "packages/languages/zh-CN");
const FAKE_CODEX = join(PROJECT_ROOT, "test/fixtures/fake-codex.mjs");

const OFFICIAL = {
  version: "0.144.1",
  packageJsonPath: "C:\\npm\\node_modules\\@openai\\codex\\package.json",
  platformPackageVersion: "0.144.1-win32-x64",
  platformPackageJsonPath:
    "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\package.json",
  binaryPath:
    "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"
};

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function releaseManifest({ revision = 1, ultraBytes, languageBytes }) {
  return {
    schemaVersion: 1,
    upstreamVersion: "0.144.1",
    upstreamTag: "rust-v0.144.1",
    upstreamCommit: "44918ea10c0f99151c6710411b4322c2f5c96bea",
    ultraRevision: revision,
    i18nApiVersion: 1,
    catalogVersion: 1,
    platform: "x86_64-pc-windows-msvc",
    executor: {
      name: "codex-ultra-executor-0.1.0.mjs",
      size: 1,
      sha256: `sha256:${"d".repeat(64)}`
    },
    asset: {
      name: `codex-ultra-0.144.1-u${revision}-windows-x64.zip`,
      size: ultraBytes.length,
      sha256: digest(ultraBytes)
    },
    language: {
      locale: "zh-CN",
      asset: "codex-ultra-language-zh-CN-v1.zip",
      size: languageBytes.length,
      sha256: digest(languageBytes)
    },
    sourceArchive: {
      name: `codex-ultra-0.144.1-u${revision}-source.tar.gz`,
      size: 1,
      sha256: `sha256:${"c".repeat(64)}`
    },
    signature: null
  };
}

function oldState(installRoot) {
  return {
    schemaVersion: 1,
    official: OFFICIAL,
    active: {
      releaseId: "0.144.1-ultra.0",
      upstreamVersion: "0.144.1",
      ultraRevision: 1,
      platform: "x86_64-pc-windows-msvc",
      binaryPath: join(
        installRoot,
        "releases/0.144.1-ultra.0/x86_64-pc-windows-msvc/package/bin/codex.exe"
      ),
      size: 10,
      mtimeMs: 1,
      sha256: `sha256:${"e".repeat(64)}`
    },
    locale: null,
    lastKnownGood: null
  };
}

async function createHarness({
  revision = 1,
  withOldState = false,
  installRoot: existingInstallRoot,
  pathEntries: existingPathEntries
} = {}) {
  const installRoot = existingInstallRoot ??
    await mkdtemp(join(tmpdir(), "codex-ultra-install-"));
  const ultraBytes = Buffer.from(`ultra-archive-${revision}`);
  const languageBytes = Buffer.from("language-archive");
  const manifest = releaseManifest({ revision, ultraBytes, languageBytes });
  const binaryBytes = Buffer.from(`binary-${revision}`);
  const pathEntries = existingPathEntries ?? new Set(["C:\\existing"]);
  const provider = {
    async readManifest() {
      return structuredClone(manifest);
    },
    async materializeAsset(name, destination) {
      if (name === manifest.asset.name) await writeFile(destination, ultraBytes);
      else if (name === manifest.language.asset) await writeFile(destination, languageBytes);
      else throw new Error(`unknown asset: ${name}`);
      return destination;
    }
  };
  const extractZipSecure = async (zipPath, destination) => {
    await mkdir(destination, { recursive: true });
    if (zipPath.endsWith(manifest.asset.name)) {
      const binary = join(destination, "package/bin/codex.exe");
      await mkdir(dirname(binary), { recursive: true });
      await writeFile(binary, binaryBytes);
    } else {
      await copyFile(join(LANGUAGE_ROOT, "manifest.json"), join(destination, "manifest.json"));
      await copyFile(join(LANGUAGE_ROOT, "messages.ftl"), join(destination, "messages.ftl"));
    }
    return destination;
  };
  if (withOldState) {
    await writeFile(
      join(installRoot, ".codex-cli-ultra-owned"),
      `${JSON.stringify({ schemaVersion: 1, root: installRoot }, null, 2)}\n`,
      "utf8"
    );
    await writeFile(
      join(installRoot, "state.json"),
      `${JSON.stringify(oldState(installRoot), null, 2)}\n`,
      "utf8"
    );
  }
  return {
    installRoot,
    manifest,
    binaryBytes,
    pathEntries,
    options: {
      provider,
      installRoot,
      catalogPath: CATALOG_PATH,
      discoverOfficialCodex: async () => structuredClone(OFFICIAL),
      extractZipSecure,
      smokeRunner: async () => ({ ok: true }),
      addPathEntry: async (entry) => {
        const changed = !pathEntries.has(entry);
        pathEntries.add(entry);
        return { changed, entry };
      },
      removePathEntry: async (entry) => {
        const changed = pathEntries.delete(entry);
        return { changed, entry };
      },
      locale: "zh-CN",
      systemLocale: "zh-CN"
    }
  };
}

test("binary smoke checks prove all five common Chinese texts and English fallback", async () => {
  const messages = {
    "tui.status-line.setup.use-theme-colors": "使用主题颜色",
    "tui.status-line.setup.apply-theme-colors": "应用当前 /theme 的颜色",
    "tui.status-line.setup.configure-title": "配置状态栏",
    "tui.status-line.setup.select-items-description": "选择要显示在状态栏中的项目。",
    "tui.history.worked-for": "加班了 7m 57s"
  };
  const result = await runBinarySmokeChecks({
    binaryPath: process.execPath,
    binaryArgsPrefix: [FAKE_CODEX],
    upstreamVersion: "0.144.1",
    language: { locale: "zh-CN", messages },
    resourcePath: join(LANGUAGE_ROOT, "messages.ftl"),
    timeoutMs: 10_000
  });
  assert.deepEqual(result.chinese.messages, messages);
  assert.equal(result.english.messages["tui.history.worked-for"], "Worked for 7m 57s");
  assert.equal(Object.keys(result.english.messages).length, 5);
});

test("every injected install stage failure preserves state bytes and PATH", async (t) => {
  for (const stage of INSTALL_STAGES) {
    await t.test(stage, async () => {
      const harness = await createHarness({ withOldState: true });
      const statePath = join(harness.installRoot, "state.json");
      const beforeState = await readFile(statePath);
      const beforePath = [...harness.pathEntries];
      await assert.rejects(
        installFromProvider({
          ...harness.options,
          onStage: async (current) => {
            if (current === stage) throw new Error(`injected ${stage}`);
          }
        }),
        new RegExp(`injected ${stage}`)
      );
      assert.deepEqual(await readFile(statePath), beforeState);
      assert.deepEqual([...harness.pathEntries], beforePath);
    });
  }
});

test("successful first install records official, build, locale, and five translations", async () => {
  const harness = await createHarness();
  const result = await installFromProvider(harness.options);
  const state = await readState(join(harness.installRoot, "state.json"));
  assert.equal(result.changed, true);
  assert.equal(state.official.binaryPath, OFFICIAL.binaryPath);
  assert.equal(state.active.releaseId, "0.144.1-ultra.1");
  assert.equal(state.locale.id, "zh-CN");
  assert.equal(state.lastKnownGood, null);
  assert.equal(Object.keys(result.languageMessages).length, 5);
  assert.equal(
    result.languageMessages["tui.status-line.setup.configure-title"],
    "配置状态栏"
  );
  assert.equal(
    result.languageMessages["tui.history.worked-for"],
    "加班了 7m 57s"
  );
  assert.equal(harness.pathEntries.has(join(harness.installRoot, "bin")), true);
  assert.equal(
    JSON.parse(await readFile(join(harness.installRoot, ".codex-cli-ultra-owned"), "utf8")).root,
    harness.installRoot
  );
});

test("repeated exact install is idempotent and does not rewrite immutable assets or state", async () => {
  const harness = await createHarness();
  await installFromProvider(harness.options);
  const statePath = join(harness.installRoot, "state.json");
  const binaryPath = join(
    harness.installRoot,
    "releases/0.144.1-ultra.1/x86_64-pc-windows-msvc/package/bin/codex.exe"
  );
  const beforeState = await readFile(statePath);
  const beforeMtime = (await stat(binaryPath)).mtimeMs;
  const second = await installFromProvider(harness.options);
  assert.equal(second.changed, false);
  assert.deepEqual(await readFile(statePath), beforeState);
  assert.equal((await stat(binaryPath)).mtimeMs, beforeMtime);
});

test("an existing immutable release with different binary content is rejected", async () => {
  const harness = await createHarness();
  await installFromProvider(harness.options);
  const binaryPath = join(
    harness.installRoot,
    "releases/0.144.1-ultra.1/x86_64-pc-windows-msvc/package/bin/codex.exe"
  );
  await writeFile(binaryPath, "tampered");
  const beforeState = await readFile(join(harness.installRoot, "state.json"));
  await assert.rejects(
    installFromProvider(harness.options),
    /immutable destination already exists with different content/
  );
  assert.deepEqual(
    await readFile(join(harness.installRoot, "state.json")),
    beforeState
  );
});

test("an incompatible official version leaves existing state untouched", async () => {
  const harness = await createHarness({ withOldState: true });
  const statePath = join(harness.installRoot, "state.json");
  const before = await readFile(statePath);
  await assert.rejects(
    installFromProvider({
      ...harness.options,
      discoverOfficialCodex: async () => ({
        ...OFFICIAL,
        version: "0.144.3",
        platformPackageVersion: "0.144.3-win32-x64"
      })
    }),
    /no compatible exact Ultra release is known/
  );
  assert.deepEqual(await readFile(statePath), before);
});

test("installer refuses to claim a non-empty directory without an ownership marker", async () => {
  const harness = await createHarness();
  const sentinel = join(harness.installRoot, "unrelated.txt");
  await writeFile(sentinel, "keep", "utf8");
  await assert.rejects(
    installFromProvider(harness.options),
    /install root is not empty and has no ownership marker/
  );
  assert.equal(await readFile(sentinel, "utf8"), "keep");
  await assert.rejects(
    readFile(join(harness.installRoot, ".codex-cli-ultra-owned")),
    /ENOENT/
  );
});

test("successful update records the previous build and locale as last-known-good", async () => {
  const first = await createHarness({ revision: 1 });
  await installFromProvider(first.options);
  const second = await createHarness({
    revision: 2,
    installRoot: first.installRoot,
    pathEntries: first.pathEntries
  });
  await installFromProvider(second.options);
  const state = await readState(join(first.installRoot, "state.json"));
  assert.equal(state.active.releaseId, "0.144.1-ultra.2");
  assert.equal(state.lastKnownGood.build.releaseId, "0.144.1-ultra.1");
  assert.equal(state.lastKnownGood.locale.id, "zh-CN");
});

test("a real state write failure rolls back only the PATH entry and preserves state bytes", async () => {
  const harness = await createHarness({ withOldState: true });
  const statePath = join(harness.installRoot, "state.json");
  const beforeState = await readFile(statePath);
  const beforePath = [...harness.pathEntries];
  await assert.rejects(
    installFromProvider({
      ...harness.options,
      writeStateAtomic: async () => {
        throw new Error("injected write failure");
      }
    }),
    /injected write failure/
  );
  assert.deepEqual(await readFile(statePath), beforeState);
  assert.deepEqual([...harness.pathEntries], beforePath);
});

test("a failed later update preserves installed language and last-known-good state", async () => {
  const first = await createHarness({ revision: 1 });
  await installFromProvider(first.options);
  const second = await createHarness({
    revision: 2,
    installRoot: first.installRoot,
    pathEntries: first.pathEntries
  });
  await installFromProvider(second.options);
  const statePath = join(first.installRoot, "state.json");
  const beforeState = await readFile(statePath);
  const languagePath = join(first.installRoot, "languages/zh-CN/messages.ftl");
  const beforeLanguage = await readFile(languagePath);
  const third = await createHarness({
    revision: 3,
    installRoot: first.installRoot,
    pathEntries: first.pathEntries
  });
  await assert.rejects(
    installFromProvider({
      ...third.options,
      smokeRunner: async ({ phases }) => {
        if (phases.includes("zh-CN")) throw new Error("injected smoke failure");
      }
    }),
    /injected smoke failure/
  );
  assert.deepEqual(await readFile(statePath), beforeState);
  assert.deepEqual(await readFile(languagePath), beforeLanguage);
  const state = await readState(statePath);
  assert.equal(state.active.releaseId, "0.144.1-ultra.2");
  assert.equal(state.lastKnownGood.build.releaseId, "0.144.1-ultra.1");
});
