import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildLaunchEnvironment,
  selectLaunchTarget
} from "../../src/launcher/select-target.mjs";
import { writeNoticeOnce } from "../../src/notices/once.mjs";

const installRoot = "C:\\Users\\me\\AppData\\Local\\codex-cli-ultra";
const preferenceEnv = {
  CODEX_CCU_LANGUAGE_PACK_ROOT: `${installRoot}\\languages`,
  CODEX_CCU_THEME_PACK_ROOT: `${installRoot}\\themes`,
  CODEX_CCU_QUOTA_PATH: `${installRoot}\\quota.json`
};
const exactState = {
  schemaVersion: 1,
  official: {
    version: "0.144.4",
    packageJsonPath:
      "C:\\npm\\node_modules\\@openai\\codex\\package.json",
    platformPackageVersion: "0.144.4-win32-x64",
    platformPackageJsonPath:
      "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\package.json",
    binaryPath:
      "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"
  },
  active: {
    releaseId: "0.144.4-ultra.1",
    upstreamVersion: "0.144.4",
    ultraRevision: 1,
    platform: "x86_64-pc-windows-msvc",
    binaryPath:
      `${installRoot}\\releases\\0.144.4-ultra.1\\x86_64-pc-windows-msvc\\package\\bin\\codex.exe`,
    size: 341000000,
    mtimeMs: 123456789,
    sha256: `sha256:${"a".repeat(64)}`
  },
  locale: {
    id: "zh-CN",
    manifestPath: `${installRoot}\\languages\\zh-CN\\manifest.json`,
    resourcePath: `${installRoot}\\languages\\zh-CN\\messages.ftl`,
    size: 300,
    mtimeMs: 123456790,
    sha256: `sha256:${"b".repeat(64)}`
  },
  lastKnownGood: null
};

function fileStat(size, mtimeMs) {
  return { size, mtimeMs, isFile: () => true };
}

function missingPath(message = "missing") {
  return Object.assign(new Error(message), { code: "ENOENT" });
}

function createReaders({
  officialVersion = "0.144.4",
  platformVersion = `${officialVersion}-win32-x64`,
  officialStat = fileStat(100, 1),
  ultraStat = fileStat(exactState.active.size, exactState.active.mtimeMs),
  localeStat = fileStat(exactState.locale.size, exactState.locale.mtimeMs)
} = {}) {
  const calls = [];
  return {
    calls,
    readPackageVersion: async (path) => {
      calls.push(`read:${path}`);
      if (path === exactState.official.packageJsonPath) {
        if (officialVersion === null) throw missingPath("official root missing");
        return officialVersion;
      }
      if (path === exactState.official.platformPackageJsonPath) {
        if (platformVersion === null) {
          throw missingPath("platform package missing");
        }
        return platformVersion;
      }
      throw missingPath("unknown package path");
    },
    statFile: async (path) => {
      calls.push(`stat:${path}`);
      let value;
      if (path === exactState.official.binaryPath) value = officialStat;
      if (path === exactState.active?.binaryPath) value = ultraStat;
      if (path === exactState.locale?.resourcePath) value = localeStat;
      if (value === null || value === undefined) throw missingPath();
      return value;
    }
  };
}

async function select({
  state = structuredClone(exactState),
  recoveredOfficial = state === null ? exactState.official : undefined,
  env = {},
  readers = createReaders(),
  realpathFile = async (path) => path
} = {}) {
  let networkCalls = 0;
  const result = await selectLaunchTarget({
    state,
    recoveredOfficial,
    installRoot,
    env,
    readPackageVersion: readers.readPackageVersion,
    realpathFile,
    statFile: readers.statFile,
    network: () => {
      networkCalls += 1;
      throw new Error("network must not run");
    },
    writeNotice: () => {
      throw new Error("notice must not influence selection");
    }
  });
  assert.equal(networkCalls, 0);
  return { result, calls: readers.calls };
}

test("target selection covers exact, upgraded, missing, changed, and removed binaries", async () => {
  const cases = [
    {
      name: "exact match selects Ultra",
      expectedKind: "ultra",
      expectedReason: "ultra-exact-match"
    },
    {
      name: "official upgrade keeps verified Ultra optimistically",
      readers: createReaders({ officialVersion: "0.145.0" }),
      expectedKind: "ultra",
      expectedReason: "ultra-optimistic-coexistence"
    },
    {
      name: "missing Ultra selects official",
      readers: createReaders({ ultraStat: null }),
      expectedKind: "official",
      expectedReason: "ultra-missing"
    },
    {
      name: "changed Ultra metadata selects official",
      readers: createReaders({ ultraStat: fileStat(1, 2) }),
      expectedKind: "official",
      expectedReason: "ultra-metadata-changed"
    },
    {
      name: "removed official keeps verified Ultra",
      readers: createReaders({
        officialVersion: null,
        platformVersion: null,
        officialStat: null
      }),
      expectedKind: "ultra",
      expectedReason: "official-unavailable-ultra-valid"
    },
    {
      name: "neither binary exists fails safely",
      state: { ...structuredClone(exactState), active: null, locale: null },
      readers: createReaders({
        officialVersion: null,
        platformVersion: null,
        officialStat: null,
        ultraStat: null,
        localeStat: null
      }),
      expectedKind: "error",
      expectedReason: "no-trusted-binary"
    }
  ];

  for (const item of cases) {
    await test(item.name, async () => {
      const { result } = await select(item);
      assert.equal(result.kind, item.expectedKind);
      assert.equal(result.reason, item.expectedReason);
      if (result.kind === "ultra") {
        assert.equal(result.path, exactState.active.binaryPath);
      } else if (result.kind === "official") {
        assert.equal(result.path, exactState.official.binaryPath);
        assert.deepEqual(result.env, {});
      } else {
        assert.equal(result.path, null);
        assert.deepEqual(result.env, {});
      }
    });
  }
});

test("selection checks local version sources before Ultra metadata", async () => {
  const readers = createReaders();
  const { result, calls } = await select({ readers });

  assert.equal(result.kind, "ultra");
  assert.deepEqual(calls, [
    `read:${exactState.official.packageJsonPath}`,
    `read:${exactState.official.platformPackageJsonPath}`,
    `stat:${exactState.official.binaryPath}`,
    `stat:${exactState.active.binaryPath}`
  ]);
});

test("an incomplete official upgrade keeps a verified Ultra available", async () => {
  const readers = createReaders({
    officialVersion: "0.145.0",
    platformVersion: null,
    officialStat: null
  });
  const { result, calls } = await select({ readers });

  assert.equal(result.kind, "ultra");
  assert.equal(result.reason, "official-unavailable-ultra-valid");
  assert.equal(calls.includes(`stat:${exactState.active.binaryPath}`), true);
  assert.match(result.notice, /official Codex is unavailable/i);
});

test("an official version change is disclosed as optimistic coexistence", async () => {
  const { result } = await select({
    readers: createReaders({ officialVersion: "0.145.0" })
  });

  assert.equal(result.kind, "ultra");
  assert.equal(result.reason, "ultra-optimistic-coexistence");
  assert.match(result.notice, /optimistic coexistence mode/i);
  assert.match(result.notice, /without claiming feature parity/i);
});

test("Ultra launch exposes the CCU language-pack directory to the fork", async () => {
  const { result } = await select();
  assert.equal(result.kind, "ultra");
  assert.deepEqual(result.env, preferenceEnv);
  assert.equal(result.notice, null);
});

test("launcher leaves language-pack validation to the fork runtime", async () => {
  for (const localeStat of [null, fileStat(1, 2)]) {
    const { result, calls } = await select({
      readers: createReaders({ localeStat })
    });
    assert.equal(result.kind, "ultra");
    assert.deepEqual(result.env, preferenceEnv);
    assert.equal(result.notice, null);
    assert.equal(calls.includes(`stat:${exactState.locale.resourcePath}`), false);
  }
});

test("legacy per-session locale variables cannot bypass the pack-root contract", async () => {
  const disabled = await select({
    env: {
      cOdEx_UlTrA_LoCaLe: "en-US",
      CODEX_ULTRA_FTL_PATH: "C:\\untrusted\\messages.ftl"
    }
  });
  assert.equal(disabled.result.kind, "ultra");
  assert.deepEqual(disabled.result.env, preferenceEnv);
  assert.equal(disabled.result.notice, null);
  assert.equal(disabled.calls.includes(`stat:${exactState.locale.resourcePath}`), false);

  const active = await select({
    env: { CODEX_ULTRA_LOCALE: "zh-CN" }
  });
  assert.deepEqual(active.result.env, preferenceEnv);

  const unavailable = await select({
    env: { CODEX_ULTRA_LOCALE: "fr-FR" }
  });
  assert.deepEqual(unavailable.result.env, preferenceEnv);
  assert.equal(unavailable.result.notice, null);
  assert.equal(
    unavailable.calls.includes(`stat:${exactState.locale.resourcePath}`),
    false
  );
  assert.equal(exactState.locale.id, "zh-CN");
});

test("canonical path escape never reaches stat or process selection", async () => {
  const readers = createReaders();
  const { result, calls } = await select({
    readers,
    realpathFile: async (path) =>
      path === exactState.active.binaryPath
        ? "\\\\server\\share\\codex.exe"
        : path
  });
  assert.equal(result.kind, "official");
  assert.equal(result.reason, "ultra-path-untrusted");
  assert.equal(calls.includes(`stat:${exactState.active.binaryPath}`), false);
});

test("a structurally tampered recovered official is never trusted", async () => {
  const tampered = {
    ...exactState.official,
    binaryPath: "C:\\evil\\codex.exe"
  };
  const readers = createReaders();
  const { result, calls } = await select({
    state: null,
    recoveredOfficial: tampered,
    readers
  });
  assert.equal(result.kind, "error");
  assert.equal(result.reason, "no-trusted-binary");
  assert.equal(calls.includes("stat:C:\\evil\\codex.exe"), false);
});

test("untrusted Ultra and locale paths never participate in local selection", async () => {
  const outsideState = structuredClone(exactState);
  outsideState.active.binaryPath = "C:\\other\\codex.exe";
  outsideState.locale.resourcePath = "C:\\other\\messages.ftl";
  outsideState.locale.manifestPath = "C:\\other\\manifest.json";
  const readers = createReaders();

  const { result, calls } = await select({
    state: outsideState,
    readers
  });
  assert.equal(result.kind, "official");
  assert.equal(result.reason, "ultra-path-untrusted");
  assert.equal(calls.includes("stat:C:\\other\\codex.exe"), false);
});

test("an untrusted legacy language path is ignored by the launcher", async () => {
  const outsideState = structuredClone(exactState);
  outsideState.locale.resourcePath = "C:\\other\\messages.ftl";
  outsideState.locale.manifestPath = "C:\\other\\manifest.json";
  const readers = createReaders();

  const { result, calls } = await select({
    state: outsideState,
    readers
  });
  assert.equal(result.kind, "ultra");
  assert.equal(result.reason, "ultra-exact-match");
  assert.deepEqual(result.env, preferenceEnv);
  assert.equal(result.notice, null);
  assert.equal(calls.includes("stat:C:\\other\\messages.ftl"), false);
});

test("an official candidate inside Ultra is never used as fallback", async () => {
  const packageJsonPath = `${installRoot}\\shadow\\node_modules\\@openai\\codex\\package.json`;
  const platformPackageJsonPath = `${installRoot}\\shadow\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\package.json`;
  const unsafeOfficial = {
    ...exactState.official,
    packageJsonPath,
    platformPackageJsonPath,
    binaryPath: `${installRoot}\\shadow\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe`
  };
  const state = structuredClone(exactState);
  state.official = unsafeOfficial;
  const readers = createReaders({ officialStat: null });
  const { result, calls } = await select({
    state,
    readers
  });
  assert.equal(result.kind, "ultra");
  assert.equal(result.reason, "official-unavailable-ultra-valid");
  assert.equal(calls.some((call) => call.includes("\\shadow\\")), false);
});

test("a discovered official installation can launch when state is unavailable", async () => {
  const readers = createReaders();
  const { result } = await select({
    state: null,
    recoveredOfficial: exactState.official,
    readers
  });
  assert.deepEqual(result, {
    kind: "official",
    path: exactState.official.binaryPath,
    env: {},
    reason: "state-unavailable",
    notice: "Codex Ultra: state is unavailable; run codex-ultra doctor."
  });
});

test("a missing Ultra install root still falls back to discovered official Codex", async () => {
  const readers = createReaders();
  const { result } = await select({
    state: null,
    recoveredOfficial: exactState.official,
    readers,
    realpathFile: async (path) => {
      if (path === installRoot) throw missingPath("install root missing");
      return path;
    }
  });
  assert.equal(result.kind, "official");
  assert.equal(result.path, exactState.official.binaryPath);
  assert.equal(result.reason, "state-unavailable");
});

test("a null recovered official cannot override a valid state official", async () => {
  const { result } = await select({ recoveredOfficial: null });
  assert.equal(result.kind, "ultra");
  assert.equal(result.reason, "ultra-exact-match");
});

test("launch environment removes legacy language keys and owns the pack root", () => {
  assert.deepEqual(
    buildLaunchEnvironment(
      {
        PATH: "C:\\Windows",
        codex_ultra_locale: "fr-FR",
        CoDeX_UlTrA_FtL_pAtH: "C:\\untrusted\\messages.ftl",
        CODEX_ULTRA_LANGUAGE_PREFERENCE_PATH: "C:\\untrusted\\language.txt",
        codex_ccu_language_pack_root: "C:\\untrusted\\languages"
      },
      {}
    ),
    { PATH: "C:\\Windows" }
  );
  assert.deepEqual(
    buildLaunchEnvironment(
      {
        PATH: "C:\\Windows",
        CODEX_ULTRA_LOCALE: "fr-FR",
        codeX_ultra_ftl_path: "C:\\untrusted\\messages.ftl",
        codex_ultra_language_preference_path: "C:\\untrusted\\language.txt",
        CODEX_CCU_LANGUAGE_PACK_ROOT: "C:\\untrusted\\languages",
        CODEX_UI_LANGUAGE: "fr-FR"
      },
      preferenceEnv
    ),
    {
      PATH: "C:\\Windows",
      ...preferenceEnv,
      CODEX_UI_LANGUAGE: "fr-FR"
    }
  );
});

test("official failure notice is preserved while fork owns language diagnostics", async () => {
  const { result } = await select({
    readers: createReaders({
      officialVersion: null,
      platformVersion: null,
      officialStat: null,
      localeStat: null
    })
  });
  assert.equal(result.kind, "ultra");
  assert.match(result.notice, /official Codex is unavailable/i);
  assert.doesNotMatch(result.notice, /language pack/i);
});

test("notice markers are deterministic, first-writer-only, and best-effort", async () => {
  const noticesDirectory = await mkdtemp(
    join(tmpdir(), "codex-ultra-notices-")
  );
  const reason = "official-version-changed";
  const detail = "0.144.4\u00000.145.0";
  const expectedHash = createHash("sha256")
    .update(`${reason}\0${detail}`)
    .digest("hex");

  assert.equal(
    await writeNoticeOnce({ noticesDirectory, reason, detail }),
    true
  );
  assert.equal(
    await writeNoticeOnce({ noticesDirectory, reason, detail }),
    false
  );
  assert.deepEqual(await readdir(noticesDirectory), [
    `${expectedHash}.notice`
  ]);

  const nestedNoticesDirectory = join(noticesDirectory, "nested");
  assert.equal(
    await writeNoticeOnce({
      noticesDirectory: nestedNoticesDirectory,
      reason,
      detail
    }),
    true
  );
  assert.deepEqual(await readdir(nestedNoticesDirectory), [
    `${expectedHash}.notice`
  ]);

  assert.equal(
    await writeNoticeOnce({
      noticesDirectory,
      reason: "write-failure",
      detail: "ignored",
      openFile: async () => {
        throw Object.assign(new Error("access denied"), { code: "EACCES" });
      }
    }),
    false
  );

  let networkPathOpened = false;
  assert.equal(
    await writeNoticeOnce({
      noticesDirectory: "\\\\server\\share\\notices",
      reason: "network-path",
      detail: "must-not-open",
      openFile: async () => {
        networkPathOpened = true;
        throw new Error("must not open a network path");
      }
    }),
    false
  );
  assert.equal(networkPathOpened, false);

  assert.equal(
    await writeNoticeOnce({
      noticesDirectory,
      reason: "close-failure",
      detail: "first creator still wins",
      openFile: async () => ({
        close: async () => {
          throw new Error("close failed after create");
        }
      })
    }),
    true
  );
});
