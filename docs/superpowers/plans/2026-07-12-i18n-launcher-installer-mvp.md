# Side-by-Side Launcher and Installer MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 11 / PowerShell 7 上提供 JavaScript 执行器和本地快速启动器，把预编译 Codex Ultra、官方 Codex 与外部语言包并排安装，并在 Ultra、状态或语言资源异常时安全回退官方英文 Codex。

**Architecture:** `launcher.mjs` 是无网络依赖的最小本地快路径，只读取状态、轻量版本来源和文件元数据后选择绝对二进制。管理执行器负责 Release 与语言包验证、安全解压、事务安装、PATH、locale、doctor、更新、回滚和卸载；开发期通过 esbuild 产出两个独立 Node 24 bundle，最终 Release 由计划 3 发布。

**Tech Stack:** Node.js 24.15.0、npm 11.12.1、Node 内置测试运行器、esbuild 0.25.6、`@fluent/bundle` 0.19.1、yauzl 3.2.0、yazl 3.3.1、PowerShell 7.6.3、Windows 用户级 PATH。

## Global Constraints

- Stable target: Codex CLI `0.144.1`, upstream tag `rust-v0.144.1`, commit `44918ea10c0f99151c6710411b4322c2f5c96bea`, platform `x86_64-pc-windows-msvc`.
- 官方 npm Codex 与 Ultra 必须并排保留；不得覆盖、删除或修改官方 npm 包。
- 正常 `codex` 启动不得访问网络、下载更新、计算大型二进制 SHA-256 或改变活动安装状态。
- 官方回退只执行安装时记录或排除 Ultra PATH 后重新发现的绝对平台二进制，禁止再次解析裸 `codex`。
- Ultra 选择只接受官方版本精确匹配、活动目录存在且安装时记录的大小和修改时间未变化的构建。
- 语言包只包含声明式数据；启动时语言文件元数据异常时不传入语言环境变量，让 Ultra 使用编译内置英文。
- 安装、更新、回滚和 locale 状态写入采用同目录临时文件、flush、原子替换；失败不得暴露半写状态。
- 下载、解压、校验或冒烟测试失败时，活动状态和用户 PATH 不变。
- 解压拒绝绝对路径、盘符路径、父目录穿越、符号链接、大小写折叠后的重复目标和安装根外写入。
- 启动器故障 notice 每个指纹最多显示一次，notice 写入失败不得影响二进制选择和启动。
- 所有项目提交使用中文 Conventional Commit，例如 `feat: 添加并排 Codex 启动器`。

## Planned File Map

```text
src/config/constants.mjs             版本、平台、目录和状态常量
src/state/schema.mjs                 state.json 最小结构验证
src/state/store.mjs                  原子读取与写入
src/discovery/official-codex.mjs     排除 Ultra 后发现官方 npm 安装
src/launcher/select-target.mjs       纯本地目标选择状态机
src/launcher/process.mjs             参数、stdio、信号和退出码转发
src/launcher/main.mjs                launcher bundle 入口
src/notices/once.mjs                 按故障指纹去重提示
src/release/manifest.mjs             Release 清单和兼容性验证
src/release/archive.mjs              ZIP 安全解压
src/release/provider.mjs             本地目录和 HTTP 资产提供器
src/installer/install.mjs            事务安装与更新
src/installer/rollback.mjs           上一个最后已知可用版本恢复
src/commands/doctor.mjs              完整哈希和回退原因诊断
src/commands/locale.mjs              活动 locale 原子切换
src/commands/uninstall.mjs           安全卸载调度
src/windows/user-path.mjs            PowerShell 用户 PATH 适配器
src/manage-main.mjs                  codex-ultra 管理命令入口
scripts/build-executor.mjs           生成两个独立 bundle
scripts/install.ps1                  PowerShell 7 安装入口
scripts/uninstall.ps1                所有权校验和延迟清理
scripts/set-user-path.ps1            幂等增删用户 PATH
templates/bin/*.cmd                  cmd 包装器
templates/bin/*.ps1                  PowerShell 包装器
test/launcher/*.test.mjs             启动快速路径和进程测试
test/installer/*.test.mjs            安装、回滚、安全和故障注入测试
test/fixtures/                        假 Release 与假官方安装
dist/                                 构建产物，不提交
```

---

### Task 1: 建立安装路径、状态模式和原子状态存储

**Files:**
- Create: `src/config/constants.mjs`
- Create: `src/state/schema.mjs`
- Create: `src/state/store.mjs`
- Create: `test/installer/state.test.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `process.env`, explicit test install roots, serialized state bytes.
- Produces: `resolveInstallRoot(env)`, `validateState(value)`, `readState(path)`, and `writeStateAtomic(path, state, fsOps?)`.

- [ ] **Step 1: 写状态模式和原子写入 RED 测试**

Create `test/installer/state.test.mjs` with these cases:

```javascript
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateState } from "../../src/state/schema.mjs";
import { readState, writeStateAtomic } from "../../src/state/store.mjs";

const validState = {
  schemaVersion: 1,
  official: {
    version: "0.144.1",
    packageJsonPath: "C:\\npm\\node_modules\\@openai\\codex\\package.json",
    platformPackageVersion: "0.144.1-win32-x64",
    platformPackageJsonPath: "C:\\npm\\node_modules\\@openai\\codex\\node_modules\\@openai\\codex-win32-x64\\package.json",
    binaryPath: "C:\\npm\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe"
  },
  active: {
    releaseId: "0.144.1-ultra.1",
    upstreamVersion: "0.144.1",
    ultraRevision: 1,
    platform: "x86_64-pc-windows-msvc",
    binaryPath: "C:\\Users\\me\\AppData\\Local\\codex-cli-ultra\\releases\\0.144.1-ultra.1\\x86_64-pc-windows-msvc\\package\\bin\\codex.exe",
    size: 341000000,
    mtimeMs: 123456789,
    sha256: "sha256:" + "a".repeat(64)
  },
  locale: {
    id: "zh-CN",
    manifestPath: "C:\\Users\\me\\AppData\\Local\\codex-cli-ultra\\languages\\zh-CN\\manifest.json",
    resourcePath: "C:\\Users\\me\\AppData\\Local\\codex-cli-ultra\\languages\\zh-CN\\messages.ftl",
    size: 300,
    mtimeMs: 123456790,
    sha256: "sha256:" + "b".repeat(64)
  },
  lastKnownGood: null
};

test("valid state preserves only launch-stable facts", () => {
  assert.deepEqual(validateState(validState), validState);
});

test("unknown schema and relative binary paths are rejected", () => {
  assert.throws(() => validateState({ ...validState, schemaVersion: 2 }), /unsupported state schema/);
  assert.throws(
    () => validateState({ ...validState, official: { ...validState.official, binaryPath: ".\\codex.exe" } }),
    /official.binaryPath must be absolute/
  );
});

test("atomic write leaves the previous state readable when rename fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-state-"));
  const path = join(root, "state.json");
  await writeFile(path, JSON.stringify(validState), "utf8");
  await assert.rejects(
    writeStateAtomic(path, { ...validState, locale: null }, {
      rename: async () => { throw new Error("injected rename failure"); }
    }),
    /injected rename failure/
  );
  assert.deepEqual(await readState(path), validState);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node --test test/installer/state.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for the state modules.

- [ ] **Step 3: 实现常量和严格状态模式**

Create `src/config/constants.mjs`:

```javascript
import { join, resolve } from "node:path";

export const STATE_SCHEMA_VERSION = 1;
export const RELEASE_MANIFEST_SCHEMA_VERSION = 1;
export const LANGUAGE_SCHEMA_VERSION = 1;
export const I18N_API_VERSION = 1;
export const CATALOG_VERSION = 1;
export const PLATFORM = "x86_64-pc-windows-msvc";

export function resolveInstallRoot(env = process.env) {
  if (env.CODEX_ULTRA_HOME) return resolve(env.CODEX_ULTRA_HOME);
  if (!env.LOCALAPPDATA) throw new Error("LOCALAPPDATA is required on Windows");
  return join(env.LOCALAPPDATA, "codex-cli-ultra");
}
```

Create `src/state/schema.mjs`. `validateState` must reject unknown top-level keys, non-absolute paths, non-canonical SHA-256 strings, non-positive file sizes, non-finite `mtimeMs`, an active platform other than `x86_64-pc-windows-msvc`, and a `lastKnownGood` object that is not the exact `{ build, locale }` pair. It returns a deep clone containing exactly `schemaVersion`, `official`, `active`, `locale`, and `lastKnownGood`.

Use this exact shape checker boundary:

```javascript
export function validateState(value) {
  assertRecord(value, "state");
  assertExactKeys(value, ["schemaVersion", "official", "active", "locale", "lastKnownGood"], "state");
  if (value.schemaVersion !== 1) throw new Error("unsupported state schema");
  return {
    schemaVersion: 1,
    official: validateOfficial(value.official),
    active: value.active === null ? null : validateBuild(value.active, "active"),
    locale: value.locale === null ? null : validateLocale(value.locale),
    lastKnownGood: value.lastKnownGood === null
      ? null
      : validateLastKnownGood(value.lastKnownGood)
  };
}
```

- [ ] **Step 4: 实现可注入失败的原子存储**

Create `src/state/store.mjs`:

```javascript
import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import { validateState } from "./schema.mjs";

export async function readState(path) {
  return validateState(JSON.parse(await readFile(path, "utf8")));
}

export async function writeStateAtomic(path, state, fsOps = {}) {
  const value = validateState(state);
  const temp = `${path}.tmp-${randomUUID()}`;
  const renameFile = fsOps.rename ?? rename;
  const handle = await open(temp, "wx");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameFile(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  const directory = await open(dirname(path), "r").catch(() => null);
  if (directory) {
    try { await directory.sync(); } finally { await directory.close(); }
  }
}
```

If Windows refuses directory handles, the final directory `sync` is best-effort only; file `sync` and same-directory rename remain mandatory.

- [ ] **Step 5: 运行并提交状态基础**

```powershell
npm test
git add package.json package-lock.json .gitignore src/config src/state test/installer/state.test.mjs
git commit -m "feat: 添加安装状态原子存储"
```

Expected: all Node tests pass and `dist/` is ignored.

---

### Task 2: 发现官方 Codex 并实现纯本地目标选择

**Files:**
- Create: `src/discovery/official-codex.mjs`
- Create: `src/launcher/select-target.mjs`
- Create: `src/notices/once.mjs`
- Create: `test/launcher/discovery.test.mjs`
- Create: `test/launcher/select-target.test.mjs`

**Interfaces:**
- Consumes: npm global root, current PATH, install root, state, lightweight file stat and package version readers.
- Produces: `discoverOfficialCodex(options)`, `selectLaunchTarget(options)`, and `writeNoticeOnce(options)`.

- [ ] **Step 1: 写官方发现 RED 测试**

The discovery tests create a fake npm root containing:

```text
node_modules/@openai/codex/package.json
node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/package.json
node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe
```

Assert that `discoverOfficialCodex` returns absolute `packageJsonPath`, `platformPackageJsonPath`, `binaryPath`, official `version`, and platform-package `version`; rejects a missing executable; and never accepts a path under the supplied Ultra install root. Inject `npmRoot` in unit tests so no subprocess is required.

- [ ] **Step 2: 写目标选择矩阵 RED 测试**

Create table-driven cases in `test/launcher/select-target.test.mjs`:

```javascript
const cases = [
  ["exact match selects Ultra", exactState, official("0.144.1"), ultraStat(), "ultra"],
  ["official upgrade selects official", exactState, official("0.145.0"), ultraStat(), "official"],
  ["missing Ultra selects official", exactState, official("0.144.1"), null, "official"],
  ["changed Ultra metadata selects official", exactState, official("0.144.1"), { size: 1, mtimeMs: 2 }, "official"],
  ["removed official keeps verified Ultra", exactState, null, ultraStat(), "ultra"],
  ["neither binary exists fails safely", { ...exactState, active: null }, null, null, "error"]
];
```

Also assert:

- a valid language file adds only `CODEX_ULTRA_LOCALE` and `CODEX_ULTRA_FTL_PATH` to the Ultra environment;
- missing or changed language metadata still selects Ultra but omits both variables;
- caller `CODEX_ULTRA_LOCALE=en-US` disables the active translation for that session without changing state;
- a caller override equal to the validated active locale uses that pack, while an unavailable override runs compiled English instead of silently substituting a different locale;
- target selection never calls an injected `network()` function that throws;
- notices do not influence the selected target.

- [ ] **Step 3: 实现官方 npm 发现**

`discoverOfficialCodex({ npmRoot, execFile, env, installRoot })` uses an injected `npmRoot` when provided; otherwise it executes `npm.cmd root -g` locally with `windowsHide: true`. It reads `@openai/codex/package.json`, resolves the exact Windows platform package from `optionalDependencies`, then verifies the expected vendor binary with `stat`. Every returned path is resolved and rejected if `relative(installRoot, candidate)` does not begin with `..`.

The function returns:

```javascript
{
  version,
  packageJsonPath,
  platformPackageVersion,
  platformPackageJsonPath,
  binaryPath
}
```

- [ ] **Step 4: 实现无副作用选择状态机**

Create `src/launcher/select-target.mjs` with the exact return contract:

```javascript
{
  kind: "ultra" | "official" | "error",
  path: string | null,
  env: Record<string, string>,
  reason: string,
  notice: string | null
}
```

`selectLaunchTarget` performs checks in this order: official root and platform package version sources, active upstream exact match, Ultra existence, Ultra size/mtime, then language size/mtime. It may choose Ultra without an official installation only after Ultra metadata passes. It returns `error` when neither trusted path exists and never invents or scans arbitrary executables.

- [ ] **Step 5: 实现 notice 去重**

Create `src/notices/once.mjs`. Hash `${reason}\0${detail}` with SHA-256, create `notices/{sha256}.notice` using `open(..., "wx")`, and return `true` only for the first creator. `EEXIST` returns `false`; every other write error is swallowed and returns `false`. The launcher prints the concise repair command only when the return value is `true`.

- [ ] **Step 6: 运行并提交发现与选择**

```powershell
node --test test/launcher/discovery.test.mjs test/launcher/select-target.test.mjs
npm test
git add src/discovery src/launcher/select-target.mjs src/notices test/launcher
git commit -m "feat: 添加官方发现与启动目标选择"
```

Expected: the complete selection matrix passes without network access.

---

### Task 3: 构建透明进程启动器和 Windows 包装器

**Files:**
- Create: `src/launcher/process.mjs`
- Create: `src/launcher/main.mjs`
- Create: `test/launcher/process.test.mjs`
- Create: `test/fixtures/echo-child.mjs`
- Create: `templates/bin/codex.cmd`
- Create: `templates/bin/codex.ps1`
- Create: `templates/bin/codex-ultra.cmd`
- Create: `templates/bin/codex-ultra.ps1`
- Create: `scripts/build-executor.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: state path, discovered official installation, selected target, original argv/env/stdio.
- Produces: `runSelectedTarget(selection, args, options)`, `launcherMain(options)`, `dist/launcher.mjs`, and Windows wrappers.

- [ ] **Step 1: 写参数、stdio 和退出码 RED 测试**

Create `test/fixtures/echo-child.mjs`:

```javascript
process.stdin.setEncoding("utf8");
let input = "";
process.stdin.on("data", (chunk) => { input += chunk; });
process.stdin.on("end", () => {
  process.stdout.write(JSON.stringify({ args: process.argv.slice(2), input, locale: process.env.CODEX_ULTRA_LOCALE ?? null }));
  process.stderr.write("child-stderr\n");
  process.exitCode = Number(process.env.CHILD_EXIT_CODE ?? 0);
});
```

The process test launches `process.execPath` with the fixture as its first argument, passes arguments containing spaces and Chinese, writes `标准输入`, and asserts exact stdout JSON, inherited stderr capture, environment overlay, and exit code `23`.

- [ ] **Step 2: 运行测试并确认 RED**

```powershell
node --test test/launcher/process.test.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` for `src/launcher/process.mjs`.

- [ ] **Step 3: 实现透明子进程转发**

Create `src/launcher/process.mjs` using `spawn` with `shell: false`, `windowsHide: false`, and caller-provided stdio defaulting to `"inherit"`:

```javascript
import { spawn } from "node:child_process";

export async function runSelectedTarget(selection, args, options = {}) {
  if (selection.kind === "error" || !selection.path) {
    options.stderr?.write?.("Codex Ultra: no trusted Codex binary is available; run codex-ultra doctor.\n");
    return 127;
  }
  const child = spawn(selection.path, args, {
    shell: false,
    windowsHide: false,
    stdio: options.stdio ?? "inherit",
    env: { ...(options.env ?? process.env), ...selection.env }
  });
  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) return resolve(128);
      resolve(code ?? 1);
    });
  });
}
```

Do not intercept `SIGINT` on Windows: the child shares the console and receives Ctrl+C. Tests use piped streams; production uses inherited streams and terminal dimensions from the shared console.

- [ ] **Step 4: 实现 launcher 主入口的损坏状态恢复**

`launcherMain` resolves the install root and `state.json`, tries `readState`, and on missing or invalid state calls `discoverOfficialCodex` with the Ultra root excluded. It then calls `selectLaunchTarget`, best-effort emits one notice, and calls `runSelectedTarget`. It imports no provider, installer, archive, HTTP, `fetch`, `https`, or update module.

Add a source-boundary test that recursively parses launcher imports and fails if any imported module path contains `/release/`, `/installer/`, `fetch`, or `http`.

- [ ] **Step 5: 创建包装器与两个独立 bundle**

Create exact wrappers:

`templates/bin/codex.cmd`

```batch
@echo off
node "%~dp0launcher.mjs" %*
exit /b %ERRORLEVEL%
```

`templates/bin/codex.ps1`

```powershell
#!/usr/bin/env pwsh
& node (Join-Path $PSScriptRoot 'launcher.mjs') @args
exit $LASTEXITCODE
```

`templates/bin/codex-ultra.cmd`

```batch
@echo off
node "%~dp0codex-ultra.mjs" %*
exit /b %ERRORLEVEL%
```

`templates/bin/codex-ultra.ps1`

```powershell
#!/usr/bin/env pwsh
& node (Join-Path $PSScriptRoot 'codex-ultra.mjs') @args
exit $LASTEXITCODE
```

Create `scripts/build-executor.mjs` using esbuild with `platform: "node"`, `format: "esm"`, `target: "node24"`, `bundle: true`, `legalComments: "external"`, and two entry points: `src/launcher/main.mjs -> dist/launcher.mjs`, `src/manage-main.mjs -> dist/codex-ultra.mjs`. The launcher metafile test must prove it contains no yauzl, Fluent, HTTP provider, or installer module.

- [ ] **Step 6: 验证构建并提交启动器**

```powershell
npm run build
node dist/launcher.mjs --help
npm test
git diff --check
git add src/launcher templates/bin scripts/build-executor.mjs test/launcher test/fixtures/echo-child.mjs package.json package-lock.json .gitignore
git commit -m "feat: 添加并排 Codex 启动器"
```

For the direct `--help` invocation, use a test install root with neither binary and expect exit `127` plus the doctor command; the wrapper does not own Codex help text.

---

### Task 4: 验证 Release、下载资产并安全解压 ZIP

**Files:**
- Create: `src/release/manifest.mjs`
- Create: `src/release/provider.mjs`
- Create: `src/release/archive.mjs`
- Create: `src/release/hash.mjs`
- Create: `test/installer/release-manifest.test.mjs`
- Create: `test/installer/archive.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Release manifest JSON, expected official version/platform, local directory or HTTPS provider, ZIP bytes.
- Produces: `validateReleaseManifest(value, expected)`, `sha256File(path)`, `DirectoryReleaseProvider`, `HttpReleaseProvider`, and `extractZipSecure(zipPath, destination)`.

- [ ] **Step 1: 写清单兼容性 RED 测试**

Use the exact valid manifest fixture:

```javascript
const manifest = {
  schemaVersion: 1,
  upstreamVersion: "0.144.1",
  upstreamTag: "rust-v0.144.1",
  upstreamCommit: "44918ea10c0f99151c6710411b4322c2f5c96bea",
  ultraRevision: 1,
  i18nApiVersion: 1,
  catalogVersion: 1,
  platform: "x86_64-pc-windows-msvc",
  executor: {
    name: "codex-ultra-executor-0.1.0.mjs",
    size: 2048,
    sha256: "sha256:" + "d".repeat(64)
  },
  asset: {
    name: "codex-ultra-0.144.1-u1-windows-x64.zip",
    size: 1024,
    sha256: "sha256:" + "a".repeat(64)
  },
  language: {
    locale: "zh-CN",
    asset: "codex-ultra-language-zh-CN-v1.zip",
    size: 512,
    sha256: "sha256:" + "b".repeat(64)
  },
  sourceArchive: {
    name: "codex-ultra-0.144.1-u1-source.tar.gz",
    size: 4096,
    sha256: "sha256:" + "c".repeat(64)
  },
  signature: null
};
```

Assert exact acceptance and rejection of unknown keys/schema, wrong version, commit, platform, i18n API, catalog, non-basename asset names, invalid sizes and hashes. Compatibility is exact; no semver range is used for the Ultra build.

- [ ] **Step 2: 写 ZIP 安全矩阵 RED 测试**

Generate ZIPs at test runtime with yazl and assert:

- `package/codex-package.json`, `package/bin/codex.exe`, `package/codex-resources/`, `package/codex-path/rg.exe`, and `LICENSES/NOTICE` extract successfully;
- `../escape`, `/absolute`, `C:/drive`, `dir/../../escape`, and backslash equivalents are rejected;
- two names that collapse to the same lowercase Windows path are rejected;
- Unix symlink mode in external attributes is rejected;
- extraction failure leaves no file outside the destination and removes its incomplete destination.

- [ ] **Step 3: 实现严格 Release 清单验证与哈希**

`validateReleaseManifest` uses exact-key validation and returns a clone. `src/release/hash.mjs` streams the file through SHA-256 and returns `{ size, sha256 }`. Never read the 325 MiB binary into one Buffer.

- [ ] **Step 4: 实现资产提供器**

`DirectoryReleaseProvider(root)` resolves manifest and assets beneath a fixture directory and rejects escapes. `HttpReleaseProvider({ manifestUrl, fetchImpl = fetch, headers = {} })` accepts only HTTPS URLs, follows redirects only to `github.com`, `api.github.com`, `objects.githubusercontent.com`, or `githubusercontent.com` hosts, streams each response to a caller-supplied temporary path, and rejects non-2xx responses. Caller Authorization headers are sent only to `github.com` and `api.github.com` and stripped before any redirect to an object/CDN host. The provider is used only by explicit management commands, never imported by the launcher graph. Production headers are empty; CI may inject an ephemeral GitHub Authorization header for draft assets.

- [ ] **Step 5: 实现 yauzl 安全解压**

For every lazy ZIP entry:

1. Replace `\\` with `/` for validation.
2. Reject empty names, NUL, leading `/`, drive prefixes, and any `.` or `..` segment.
3. Reject symlinks using `(externalFileAttributes >>> 16) & 0o170000`.
4. Resolve the output and require it to remain under `destination + sep`.
5. Track `relative.toLowerCase()` and reject duplicates.
6. Create files with `open(path, "wx")`; stream bytes and close before the next entry.
7. On any error remove only the verified destination root created for this extraction.

The caller must create a unique staging destination; `extractZipSecure` refuses a pre-existing non-empty destination.

- [ ] **Step 6: 运行安全测试并提交**

```powershell
node --test test/installer/release-manifest.test.mjs test/installer/archive.test.mjs
npm test
git add src/release test/installer package.json package-lock.json
git commit -m "feat: 添加 Release 校验与安全解压"
```

Expected: every traversal, symlink and duplicate-path fixture is rejected without an outside write.

---

### Task 5: 实现事务式安装、显式更新和回滚

**Files:**
- Create: `src/installer/install.mjs`
- Create: `src/installer/rollback.mjs`
- Create: `test/installer/install.test.mjs`
- Create: `test/installer/rollback.test.mjs`
- Create: `test/fixtures/releases/README.md`

**Interfaces:**
- Consumes: official discovery result, validated provider, language validator from Plan 1, secure extractor, binary smoke runner, PATH adapter and state store.
- Produces: `installFromProvider(options)`, `updateFromProvider(options)`, and `rollback(options)`.

- [ ] **Step 1: 写完整故障注入 RED 测试**

Build the installer around injected dependencies and cover these named stages:

```javascript
const STAGES = [
  "manifest",
  "download-ultra",
  "verify-ultra",
  "extract-ultra",
  "download-language",
  "verify-language",
  "extract-language",
  "smoke-version",
  "smoke-zh-cn",
  "smoke-english",
  "move-release",
  "move-language",
  "path-add",
  "state-switch"
];
```

For each stage, inject one failure and assert the prior `state.json` bytes and PATH snapshot are unchanged. Also test:

- successful first install records the official absolute binary and activates Ultra;
- successful update moves the former active build and its locale selection into `lastKnownGood`;
- exact repeated install is idempotent and does not rewrite immutable assets;
- an existing release directory with different hashes is rejected;
- no compatible exact release leaves state untouched;
- a failed new install does not remove an already installed language pack or last-known-good build.

- [ ] **Step 2: 运行测试并确认 RED**

```powershell
node --test test/installer/install.test.mjs test/installer/rollback.test.mjs
```

Expected: missing installer modules.

- [ ] **Step 3: 实现三次真实二进制冒烟边界**

The default smoke runner executes the extracted absolute `codex.exe` with `shell: false`:

1. `--version` must exit 0 and contain `0.144.1`.
2. `--ultra-i18n-self-check` with the validated zh-CN FTL must return JSON where `active` is `true` and `tui.history.worked-for` is `加班了 7m 57s`.
3. The same self-check with a guaranteed missing FTL path must return JSON where `active` is `false` and `tui.history.worked-for` is `Worked for 7m 57s`.

The runner has a 30-second timeout for each noninteractive probe, kills only its own child on timeout, and returns captured stdout/stderr for the install error.

The immutable MVP destination preserves the complete upstream package under `releases/0.144.1-ultra.1/x86_64-pc-windows-msvc/package/`; the recorded executable is always `package/bin/codex.exe`. No companion binary or resource is flattened or moved away from that package root.

- [ ] **Step 4: 实现事务安装**

`installFromProvider` must follow this exact order:

```text
discover official -> read/validate manifest -> exact compatibility check
-> create a unique installRoot/cache/install-{randomUUID} directory
-> materialize and hash Ultra ZIP -> secure extract
-> materialize and hash language ZIP -> secure extract -> validateLanguagePack
-> run version/Chinese/English smoke probes
-> atomically rename complete release and language directories to immutable destinations
-> add the Ultra bin directory to the beginning of user PATH
-> write state.json atomically as the only active-pointer switch
```

For the first state, an explicit `--locale` wins; otherwise negotiate the operating-system canonical locale against the installed packs, and store `locale: null` when no exact/fallback/base pack exists. This selection is local and does not fetch another language.

Before any mutation, create `%LOCALAPPDATA%\codex-cli-ultra\.codex-cli-ultra-owned` containing:

```json
{
  "schemaVersion": 1,
  "root": "C:\\Users\\Example\\AppData\\Local\\codex-cli-ultra"
}
```

The production code writes the actual resolved root rather than the example path shown above. Staging lives under the install root so final directory renames stay on one volume. If PATH succeeds but state switching fails, remove the PATH entry only when this transaction added it. A newly moved release may remain as an inactive immutable cache, but it must not become active; `doctor` reports it as inactive.

- [ ] **Step 5: 实现显式 update 和 rollback**

`updateFromProvider` is an alias over the same transaction and is never called by `launcherMain`. `lastKnownGood` has exact shape `{ build, locale }`. `rollback` verifies current and last-known-good directory metadata, swaps `{ active, locale }` with that pair in one atomic state write, restores the recorded locale only when the pack still validates, and otherwise sets locale to `null` so the restored Ultra runs English.

- [ ] **Step 6: 运行测试并提交事务安装**

```powershell
node --test test/installer/install.test.mjs test/installer/rollback.test.mjs
npm test
git add src/installer test/installer test/fixtures/releases
git commit -m "feat: 添加事务式安装更新与回滚"
```

Expected: every injected failure preserves the old state and PATH snapshot.

---

### Task 6: 实现 locale、doctor、PATH、安装入口和安全卸载

**Files:**
- Create: `src/commands/doctor.mjs`
- Create: `src/commands/locale.mjs`
- Create: `src/commands/uninstall.mjs`
- Create: `src/language/negotiate.mjs`
- Create: `src/windows/user-path.mjs`
- Create: `src/manage-main.mjs`
- Create: `scripts/install.ps1`
- Create: `scripts/uninstall.ps1`
- Create: `scripts/set-user-path.ps1`
- Create: `test/installer/commands.test.mjs`
- Create: `test/installer/user-path.test.mjs`
- Modify: `src/cli.mjs`

**Interfaces:**
- Consumes: installed state, installed language directories, Release provider arguments and Windows user environment.
- Produces: `negotiateLocale(requested, installedPacks)`, `locale list|set`, `doctor [--json]`, `install`, `update`, `rollback`, `uninstall`, and idempotent PATH operations.

- [ ] **Step 1: 写命令行为 RED 测试**

Assert:

- `locale list` reports installed, valid locales and marks the active one;
- `locale set zh-CN` validates the pack and changes only `state.locale` atomically;
- `locale set en-US` stores `locale: null` and therefore uses compiled English;
- an invalid or incompatible pack leaves state unchanged;
- `doctor --json` reports official version/path, Ultra release/path, locale, expected and actual SHA-256, selected target and fallback reason;
- `doctor` performs full hashes while `launcherMain` test counters prove it never does;
- `uninstall` refuses a root without a matching ownership marker;
- repeated PATH add/remove is idempotent and case-insensitive.
- locale negotiation tries exact canonical locale, declared fallbacks, progressively normalized base locales, then compiled `en-US`, and rejects fallback cycles.

- [ ] **Step 2: 实现用户 PATH PowerShell helper**

Create `scripts/set-user-path.ps1`:

```powershell
#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Add', 'Remove')]
    [string]$Action,

    [Parameter(Mandatory)]
    [string]$Entry
)

$ErrorActionPreference = 'Stop'
$resolved = [IO.Path]::GetFullPath($Entry).TrimEnd('\')
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($current -split ';' | Where-Object { $_ } | ForEach-Object { $_.Trim().TrimEnd('\') })
$remaining = @($parts | Where-Object { -not [string]::Equals($_, $resolved, [StringComparison]::OrdinalIgnoreCase) })
$changed = $remaining.Count -ne $parts.Count
if ($Action -eq 'Add') {
    $newParts = @($resolved) + $remaining
    $changed = $changed -or $parts.Count -eq 0 -or -not [string]::Equals($parts[0], $resolved, [StringComparison]::OrdinalIgnoreCase)
} else {
    $newParts = $remaining
}
if ($changed) {
    [Environment]::SetEnvironmentVariable('Path', ($newParts -join ';'), 'User')
}
@{ changed = $changed; entry = $resolved } | ConvertTo-Json -Compress
```

`src/windows/user-path.mjs` runs this exact installed helper through `pwsh -NoProfile -File`, parses the JSON, and supports an injected runner for tests. It never edits a PowerShell profile.

- [ ] **Step 3: 实现 locale 和 doctor**

`setLocale({ installRoot, locale })` treats `en-US` as compiled-English mode. Other locales must exist beneath a canonical locale directory such as `languages/zh-CN`, pass Plan 1 `validateLanguagePack`, match i18n API 1/catalog 1, and record current size/mtime/hash before atomic state write.

`negotiateLocale(requested, installedPacks)` uses a visited set, follows only manifest-declared installed fallbacks, then tries installed canonical base locales by removing rightmost subtags. A repeated locale is a cycle error. When no candidate exists it returns `null`, which means compiled `en-US`; it never downloads a pack or substitutes a different regional pack merely because it shares the same primary language.

`doctor` recomputes hashes because it is explicit and diagnostic. Its JSON schema is:

```javascript
{
  schemaVersion: 1,
  official: { available, version, binaryPath },
  ultra: { available, releaseId, binaryPath, metadataMatch, hashMatch },
  locale: { id, resourcePath, metadataMatch, hashMatch },
  selection: { kind, path, reason },
  recommendations: ["codex-ultra update" | "codex-ultra locale set en-US" | "codex-ultra install"]
}
```

Human output is derived from this object and never exposes authentication, environment secrets or session content.

- [ ] **Step 4: 实现安全卸载调度和清理脚本**

`scheduleUninstall` verifies the ownership marker, then spawns:

```text
pwsh -NoProfile -File $installedUninstallScript -InstallRoot $installRoot -ParentPid $processId
```

with `detached: true`, `windowsHide: true`, and ignored stdio. `scripts/uninstall.ps1` waits up to 30 seconds for the parent, verifies:

- `InstallRoot` resolves to the marker's exact `root`;
- it is not a drive root, user profile root, `LOCALAPPDATA`, or a parent of those paths;
- the PATH removal helper lives under the same verified root.

It then removes only the exact Ultra PATH entry and the verified project root. It never touches `%USERPROFILE%\.codex`, npm modules, official wrappers, authentication, sessions, config or shell profiles.

- [ ] **Step 5: 实现管理命令路由和 PowerShell 安装入口**

`runManageCli(args, deps)` supports:

```text
install --release-dir PATH | --manifest-url HTTPS_URL
update --release-dir PATH | --manifest-url HTTPS_URL
rollback
locale list
locale set LOCALE
doctor [--json]
uninstall
```

Unknown/missing arguments return exit 2 with one-line usage. `scripts/install.ps1` requires PowerShell 7, verifies `node --version` major >=24, runs `npm run build` only when executed from a development checkout, then invokes `dist/codex-ultra.mjs install` with the supplied provider option. It does not install Rust.

- [ ] **Step 6: 运行并提交管理命令**

```powershell
node --test test/installer/commands.test.mjs test/installer/user-path.test.mjs
npm run build
npm test
git diff --check
git add src/commands src/windows src/manage-main.mjs src/cli.mjs scripts templates test/installer package.json package-lock.json
git commit -m "feat: 添加 Codex Ultra 管理命令"
```

Expected: commands pass against temporary install roots without changing the developer's real user PATH.

---

### Task 7: 完成本地 Release fixture 端到端验证和计划 2 审查

**Files:**
- Create: `scripts/test-launcher-installer.ps1`
- Create: `docs/i18n/launcher-installer-mvp.md`
- Create: `test/installer/e2e.test.mjs`
- Modify: `README.md`

**Interfaces:**
- Consumes: a local fixture Release, temporary fake official npm root and temporary `CODEX_ULTRA_HOME`.
- Produces: repeatable install/select/fallback/locale/rollback/uninstall proof without publishing a GitHub Release.

- [ ] **Step 1: 建立不接触本机 PATH 的端到端 fixture**

The E2E test uses injected PATH operations and process runners but real filesystem state, hashing, ZIP extraction, language validation, bundles and wrappers. It performs:

```text
install fixture -> exact match selects Ultra -> zh-CN environment is present
-> remove one FTL key and prove Ultra selection with compiled-English mode
-> restore pack -> simulate official 0.145.0 and prove official absolute fallback
-> restore 0.144.1 -> corrupt Ultra metadata and prove official fallback
-> update to ultra revision 2 -> rollback to revision 1
-> uninstall and prove only the temporary Ultra root is removed
```

The fixture official target is `node.exe` plus `echo-child.mjs`; the installer smoke runner is injected in Plan 2. Plan 3 replaces this with the real packaged `codex.exe` on a clean Windows runner.

- [ ] **Step 2: 实现 PowerShell 聚合验证**

Create `scripts/test-launcher-installer.ps1`:

```powershell
#requires -Version 7.0
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    npm ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    node --test test/launcher test/installer
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    git diff --check
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
```

- [ ] **Step 3: 写操作文档和 README 入口**

Document the side-by-side layout, exact launch decision order, commands, no-network launch guarantee, English and official fallback, and the boundary that this plan validates a local fixture while Plan 3 delivers real precompiled assets. Do not claim a public installer URL yet.

- [ ] **Step 4: 运行完整计划 2 验证**

```powershell
pwsh -NoProfile -File scripts/test-launcher-installer.ps1
rg -n "fetch\(|https:|HttpReleaseProvider" src/launcher dist/launcher.mjs
git status --short
git diff --check
```

Expected:

- all launcher and installer tests pass;
- the launcher source and bundle search returns no network implementation;
- fixture install, language fallback, official fallback, rollback and uninstall pass;
- no real user PATH or official npm installation changes.

- [ ] **Step 5: 提交文档并请求审查**

```powershell
git add scripts/test-launcher-installer.ps1 docs/i18n/launcher-installer-mvp.md test/installer/e2e.test.mjs README.md
git commit -m "feat: 完成启动器安装器 MVP 验证"
```

Use `requesting-code-review` against the entire Plan 2 branch. Critical and Important findings must be fixed and re-reviewed before Plan 3 consumes this branch.
