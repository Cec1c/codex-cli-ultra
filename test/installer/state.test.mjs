import assert from "node:assert/strict";
import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  PLATFORM,
  resolveInstallRoot
} from "../../src/config/constants.mjs";
import { validateState } from "../../src/state/schema.mjs";
import { readState, writeStateAtomic } from "../../src/state/store.mjs";

const validBuild = {
  releaseId: "0.144.1-ultra.1",
  upstreamVersion: "0.144.1",
  ultraRevision: 1,
  platform: "x86_64-pc-windows-msvc",
  binaryPath:
    "C:\\Users\\me\\AppData\\Local\\codex-cli-ultra\\releases\\0.144.1-ultra.1\\x86_64-pc-windows-msvc\\package\\bin\\codex.exe",
  size: 341000000,
  mtimeMs: 123456789,
  sha256: `sha256:${"a".repeat(64)}`
};

const validLocale = {
  id: "zh-CN",
  manifestPath:
    "C:\\Users\\me\\AppData\\Local\\codex-cli-ultra\\languages\\zh-CN\\manifest.json",
  resourcePath:
    "C:\\Users\\me\\AppData\\Local\\codex-cli-ultra\\languages\\zh-CN\\messages.ftl",
  size: 300,
  mtimeMs: 123456790,
  sha256: `sha256:${"b".repeat(64)}`
};

const validState = {
  schemaVersion: 1,
  official: {
    version: "0.144.1",
    packageJsonPath:
      "C:\\npm\\node_modules\\@openai\\codex\\package.json",
    platformPackageVersion: "0.144.1-win32-x64",
    platformPackageJsonPath:
      "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\package.json",
    binaryPath:
      "C:\\npm\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"
  },
  active: validBuild,
  locale: validLocale,
  lastKnownGood: null
};

function cloneState() {
  return structuredClone(validState);
}

test("install root prefers CODEX_ULTRA_HOME and otherwise uses LOCALAPPDATA", () => {
  assert.equal(
    resolveInstallRoot({ CODEX_ULTRA_HOME: ".\\custom-ultra" }),
    resolve(".\\custom-ultra")
  );
  assert.equal(
    resolveInstallRoot({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }),
    join("C:\\Users\\me\\AppData\\Local", "codex-cli-ultra")
  );
  assert.throws(() => resolveInstallRoot({}), /LOCALAPPDATA is required/);
});

test("install root rejects UNC and Windows device paths", () => {
  for (const root of [
    "\\\\server\\share\\codex-cli-ultra",
    "\\\\?\\UNC\\server\\share\\codex-cli-ultra",
    "\\\\?\\C:\\codex-cli-ultra"
  ]) {
    assert.throws(
      () => resolveInstallRoot({ CODEX_ULTRA_HOME: root }),
      /install root must be on a local Windows drive/
    );
  }
  assert.throws(
    () => resolveInstallRoot({ LOCALAPPDATA: "\\\\server\\share" }),
    /install root must be on a local Windows drive/
  );
});

test("valid state preserves only launch-stable facts in a deep clone", () => {
  const result = validateState(validState);
  assert.deepEqual(result, validState);
  assert.notEqual(result, validState);
  assert.notEqual(result.official, validState.official);
  assert.notEqual(result.active, validState.active);
  assert.notEqual(result.locale, validState.locale);

  result.active.releaseId = "changed";
  assert.equal(validState.active.releaseId, "0.144.1-ultra.1");
});

test("nullable active and locale plus an exact last-known-good pair are accepted", () => {
  const inactive = validateState({
    ...cloneState(),
    active: null,
    locale: null
  });
  assert.equal(inactive.active, null);
  assert.equal(inactive.locale, null);

  const lastKnownGood = validateState({
    ...cloneState(),
    lastKnownGood: {
      build: validBuild,
      locale: null
    }
  });
  assert.deepEqual(lastKnownGood.lastKnownGood, {
    build: validBuild,
    locale: null
  });
  assert.notEqual(lastKnownGood.lastKnownGood.build, validBuild);
});

test("unknown schemas and unknown keys are rejected at every state boundary", () => {
  assert.throws(
    () => validateState({ ...cloneState(), schemaVersion: 2 }),
    /unsupported state schema/
  );
  assert.throws(
    () => validateState({ ...cloneState(), extra: true }),
    /state must contain exactly/
  );
  assert.throws(
    () =>
      validateState({
        ...cloneState(),
        official: { ...validState.official, extra: true }
      }),
    /official must contain exactly/
  );
  assert.throws(
    () =>
      validateState({
        ...cloneState(),
        lastKnownGood: {
          build: validBuild,
          locale: validLocale,
          extra: true
        }
      }),
    /lastKnownGood must contain exactly/
  );

  const nestedCases = [
    {
      label: "active",
      state: { ...cloneState(), active: { ...validBuild, extra: true } }
    },
    {
      label: "locale",
      state: { ...cloneState(), locale: { ...validLocale, extra: true } }
    },
    {
      label: "lastKnownGood.build",
      state: {
        ...cloneState(),
        lastKnownGood: {
          build: { ...validBuild, extra: true },
          locale: validLocale
        }
      }
    },
    {
      label: "lastKnownGood.locale",
      state: {
        ...cloneState(),
        lastKnownGood: {
          build: validBuild,
          locale: { ...validLocale, extra: true }
        }
      }
    }
  ];
  for (const { label, state } of nestedCases) {
    assert.throws(
      () => validateState(state),
      new RegExp(`${label.replaceAll(".", "\\.")} must contain exactly`)
    );
  }
});

test("every recorded file path must be on a local Windows drive", () => {
  const cases = [
    ["official.packageJsonPath", ["official", "packageJsonPath"]],
    [
      "official.platformPackageJsonPath",
      ["official", "platformPackageJsonPath"]
    ],
    ["official.binaryPath", ["official", "binaryPath"]],
    ["active.binaryPath", ["active", "binaryPath"]],
    ["locale.manifestPath", ["locale", "manifestPath"]],
    ["locale.resourcePath", ["locale", "resourcePath"]]
  ];

  for (const [label, [section, key]] of cases) {
    const state = cloneState();
    state[section][key] = ".\\relative";
    assert.throws(
      () => validateState(state),
      new RegExp(
        `${label.replaceAll(".", "\\.")} must be an absolute local Windows drive path`
      )
    );
  }

  for (const unsafePath of [
    "\\\\server\\share\\codex.exe",
    "\\\\?\\UNC\\server\\share\\codex.exe",
    "\\\\?\\C:\\codex.exe"
  ]) {
    for (const [label, [section, key]] of cases) {
      const state = cloneState();
      state[section][key] = unsafePath;
      assert.throws(
        () => validateState(state),
        new RegExp(
          `${label.replaceAll(".", "\\.")} must be an absolute local Windows drive path`
        )
      );
    }
  }
});

test("build and locale metadata reject unsafe values", () => {
  for (const size of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () =>
        validateState({
          ...cloneState(),
          active: { ...validBuild, size }
        }),
      /active.size must be a positive safe integer/
    );
  }
  for (const mtimeMs of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    assert.throws(
      () =>
        validateState({
          ...cloneState(),
          locale: { ...validLocale, mtimeMs }
        }),
      /locale.mtimeMs must be a finite non-negative number/
    );
  }
  for (const sha256 of [
    "a".repeat(64),
    `sha256:${"A".repeat(64)}`,
    `sha256:${"a".repeat(63)}`
  ]) {
    assert.throws(
      () =>
        validateState({
          ...cloneState(),
          active: { ...validBuild, sha256 }
        }),
      /active.sha256 must be canonical SHA-256/
    );
  }
  assert.throws(
    () =>
      validateState({
        ...cloneState(),
        active: { ...validBuild, ultraRevision: 0 }
      }),
    /active.ultraRevision must be a positive safe integer/
  );
  assert.throws(
    () =>
      validateState({
        ...cloneState(),
        active: { ...validBuild, platform: "aarch64-pc-windows-msvc" }
      }),
    new RegExp(`active.platform must equal ${PLATFORM}`)
  );
});

test("lastKnownGood must be the exact non-null build and nullable locale pair", () => {
  assert.throws(
    () =>
      validateState({
        ...cloneState(),
        lastKnownGood: { build: null, locale: null }
      }),
    /lastKnownGood.build must be an object/
  );
  assert.throws(
    () =>
      validateState({
        ...cloneState(),
        lastKnownGood: { build: validBuild }
      }),
    /lastKnownGood must contain exactly/
  );
});

test("readState parses and validates serialized state bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-state-read-"));
  const path = join(root, "state.json");
  await writeFile(path, JSON.stringify(validState), "utf8");

  const result = await readState(path);
  assert.deepEqual(result, validState);
  assert.notEqual(result, validState);

  await writeFile(path, JSON.stringify({ ...validState, extra: true }), "utf8");
  await assert.rejects(readState(path), /state must contain exactly/);
});

test("atomic write creates and replaces a flushed state file", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-state-write-"));
  const path = join(root, "state.json");

  await writeStateAtomic(path, validState);
  assert.deepEqual(await readState(path), validState);
  assert.match(await readFile(path, "utf8"), /\n$/);

  const updated = { ...cloneState(), locale: null };
  await writeStateAtomic(path, updated);
  assert.deepEqual(await readState(path), updated);
  assert.deepEqual(await readdir(root), ["state.json"]);
});

test("atomic write leaves the previous state readable when rename fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-state-failure-"));
  const path = join(root, "state.json");
  const previousBytes = `${JSON.stringify(validState)}\n`;
  await writeFile(path, previousBytes, "utf8");

  await assert.rejects(
    writeStateAtomic(
      path,
      { ...cloneState(), locale: null },
      {
        rename: async () => {
          throw new Error("injected rename failure");
        }
      }
    ),
    /injected rename failure/
  );

  assert.equal(await readFile(path, "utf8"), previousBytes);
  assert.deepEqual(await readState(path), validState);
  assert.deepEqual(await readdir(root), ["state.json"]);
});

test("file sync failure keeps the previous state and removes the temp file", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-state-sync-"));
  const path = join(root, "state.json");
  const previousBytes = `${JSON.stringify(validState)}\n`;
  await writeFile(path, previousBytes, "utf8");

  await assert.rejects(
    writeStateAtomic(
      path,
      { ...cloneState(), locale: null },
      {
        open: async (...arguments_) => {
          const handle = await open(...arguments_);
          return {
            writeFile: handle.writeFile.bind(handle),
            sync: async () => {
              throw new Error("injected file sync failure");
            },
            close: handle.close.bind(handle)
          };
        }
      }
    ),
    /injected file sync failure/
  );

  assert.equal(await readFile(path, "utf8"), previousBytes);
  assert.deepEqual(await readdir(root), ["state.json"]);
});

test("directory sync is best-effort after the atomic rename succeeds", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-state-dir-sync-"));
  const path = join(root, "state.json");
  let directoryClosed = false;

  await writeStateAtomic(path, validState, {
    openDirectory: async () => ({
      sync: async () => {
        throw new Error("injected directory sync failure");
      },
      close: async () => {
        directoryClosed = true;
      }
    })
  });

  assert.equal(directoryClosed, true);
  assert.deepEqual(await readState(path), validState);
});

test("temporary file cleanup failures remain observable", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-state-cleanup-"));
  const path = join(root, "state.json");
  const previousBytes = `${JSON.stringify(validState)}\n`;
  await writeFile(path, previousBytes, "utf8");

  try {
    await assert.rejects(
      writeStateAtomic(
        path,
        { ...cloneState(), locale: null },
        {
          rename: async () => {
            throw new Error("injected rename failure");
          },
          rm: async () => {
            throw new Error("injected cleanup failure");
          }
        }
      ),
      (error) => {
        assert.equal(error instanceof AggregateError, true);
        assert.match(
          error.message,
          /state write failed and temporary file cleanup failed/
        );
        assert.deepEqual(
          error.errors.map((item) => item.message),
          ["injected rename failure", "injected cleanup failure"]
        );
        return true;
      }
    );
    assert.equal(await readFile(path, "utf8"), previousBytes);
    assert.equal((await readdir(root)).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid state is rejected before any temporary file is created", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-state-invalid-"));
  const path = join(root, "state.json");

  await assert.rejects(
    writeStateAtomic(path, { ...cloneState(), extra: true }),
    /state must contain exactly/
  );
  assert.deepEqual(await readdir(root), []);
});
