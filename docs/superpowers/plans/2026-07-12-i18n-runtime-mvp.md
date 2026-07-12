# Rust i18n Runtime MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Codex CLI 0.144.1 建立可重复应用的薄 Rust i18n 运行时，加载外部 zh-CN FTL，翻译四条状态栏设置消息和 `Worked for {duration}`，并在任意语言资源故障时回退编译内置英文。

**Architecture:** 项目仓库维护语义消息目录、纯数据语言包和版本锁定源码适配器。适配器只对精确上游提交应用经过指纹验证的变更，在 `codex-tui` 内加入可注入测试的 `Localizer`；语言作者维护 FTL，Rust 使用 `fluent-bundle` 完成最终格式化，英文闭包始终保留官方渲染逻辑。

**Tech Stack:** Node.js 24.15.0、npm 11.12.1、Node 内置测试运行器、`@fluent/bundle` 0.19.1、上游锁定 Rust/Cargo 1.95.0、`fluent-bundle` 0.15.3、`unic-langid` 0.9.6、PowerShell 7.6.3、Git worktree、Insta snapshots。

## Global Constraints

- Stable target: Codex CLI `0.144.1`, upstream tag `rust-v0.144.1`, commit `44918ea10c0f99151c6710411b4322c2f5c96bea`.
- Rust 和 Cargo 必须由上游 `codex-rs/rust-toolchain.toml` 选择为 `1.95.0`；不得用全局更新版 Cargo 重写锁文件。
- 只修改隔离的上游工作树；不得把完整 Codex 源码加入本仓库。
- 语言包只包含 `manifest.json`、FTL、许可证和可选文档，不执行任何代码。
- Rust 是运行时最终格式化者；JavaScript 只做安装前验证和适配编排。
- 逻辑消息 ID 使用点号；FTL 键通过把点号替换成双连字符确定性生成。
- 单条键缺失、参数错误、格式化错误或空结果只回退该条英文。
- 整个 FTL 无法解析、路径缺失或 locale 非法时，本次会话完整使用英文。
- MVP 使用 `CODEX_ULTRA_LOCALE` 和 `CODEX_ULTRA_FTL_PATH` 向补丁二进制传入已经验证的活动语言资源。
- 所有公开命令通过 `$env:CODEX_UPSTREAM_SOURCE` 引用用户自行准备的精确上游 checkout；公开文件不得记录项目维护者的私有临时目录。
- 上游验证使用唯一的 detached worktree；不得通过 `git reset --hard` 或 `git clean` 复用一个已写入的工作树。
- MVP 对 Fluent 参数关闭 bidi isolation，以保持当前 Ratatui 宽度与快照稳定；RTL 终端布局不在本计划范围内。
- 相同 `release` profile 的官方基线与补丁构建必须记录二进制字节数、增量和百分比；不得用 crate 源码体积代替最终链接结果。
- 所有项目提交使用中文 Conventional Commit，例如 `feat: 添加 Rust i18n 运行时`。

## Planned File Map

```text
package.json                              Node 项目、脚本和固定依赖
package-lock.json                         npm 依赖锁
.gitattributes                            FTL 使用稳定 LF 字节
src/cli.mjs                               项目 CLI 路由
src/catalog/message-specs.mjs             五条 MVP 消息的语义定义
src/catalog/extract.mjs                   从精确上游源码提取目录
src/catalog/write.mjs                     生成 JSONL 和 Markdown 报告
src/language/validate.mjs                 语言清单、哈希、FTL 和参数验证
src/adapter/transaction.mjs               纯计划、事务式应用和恢复引擎
src/adapter/codex-0.144.1.mjs              版本锁定 Codex 适配器
adapters/codex/0.144.1/manifest.json       上游提交、API 和目录版本
adapters/codex/0.144.1/overlay/i18n.rs     注入 codex-tui 的 Rust 运行时
adapters/codex/0.144.1/overlay/snapshots/  适配器管理的三档 CJK 快照
packages/languages/zh-CN/manifest.json     zh-CN 包清单
packages/languages/zh-CN/messages.ftl      五条 MVP 翻译
research/codex-0.144.1/tui-messages.jsonl  机器可读目录
research/codex-0.144.1/i18n-size.json      同 profile 基线与补丁体积证据
docs/i18n/codex-0.144.1-text-inventory.md  人工审阅目录
scripts/measure-i18n-size.ps1              可重复二进制增量测量
test/*.test.mjs                            Node 单元与集成测试
```

---

### Task 1: 建立 Node 项目和源码文本目录

**Files:**
- Create: `.gitattributes`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `src/cli.mjs`
- Create: `src/catalog/message-specs.mjs`
- Create: `src/catalog/extract.mjs`
- Create: `src/catalog/write.mjs`
- Create: `test/catalog.test.mjs`
- Create: `research/codex-0.144.1/tui-messages.jsonl`
- Create: `docs/i18n/codex-0.144.1-text-inventory.md`

**Interfaces:**
- Consumes: an upstream Codex source root at exact commit `44918ea10c0f99151c6710411b4322c2f5c96bea`.
- Produces: `MESSAGE_SPECS`, `extractCatalog(sourceRoot, specs)`, `writeCatalogArtifacts(records, paths)`, and CLI command `catalog extract --source PATH`.

- [ ] **Step 1: 创建最小 Node 元数据和失败测试**

Create `.gitattributes`:

```gitattributes
*.ftl text eol=lf
*.jsonl text eol=lf
```

Create `package.json`:

```json
{
  "name": "codex-cli-ultra",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "test": "node --test",
    "catalog:extract": "node src/cli.mjs catalog extract"
  },
  "dependencies": {
    "@fluent/bundle": "0.19.1"
  }
}
```

Run:

```powershell
npm install --package-lock-only
```

Create `test/catalog.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractCatalog } from "../src/catalog/extract.mjs";

async function fixtureTree(source) {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-catalog-"));
  const path = join(root, "codex-rs", "tui", "src", "sample.rs");
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, source, "utf8");
  return root;
}

const spec = {
  id: "tui.sample.title",
  ftlKey: "tui--sample--title",
  kind: "plain",
  english: "Sample title",
  args: [],
  sources: [{
    path: "codex-rs/tui/src/sample.rs",
    symbol: "sample",
    anchor: '"Sample title"',
    expectedOccurrences: 1
  }]
};

test("extractCatalog records exact lines and source hashes", async () => {
  const root = await fixtureTree('fn sample() {\n    let value = "Sample title";\n}\n');
  const [record] = await extractCatalog(root, [spec]);
  assert.equal(record.id, spec.id);
  assert.equal(record.sources[0].line, 2);
  assert.match(record.sources[0].fingerprint, /^sha256:[a-f0-9]{64}$/);
});

test("extractCatalog rejects source drift", async () => {
  const root = await fixtureTree('fn sample() { let value = "Changed"; }\n');
  await assert.rejects(extractCatalog(root, [spec]), /expected 1 occurrence, found 0/);
});

test("extractCatalog supports one semantic message with two call sites", async () => {
  const root = await fixtureTree('fn sample() {\n "Sample title";\n "Sample title";\n}\n');
  const twoSites = {
    ...spec,
    sources: [{ ...spec.sources[0], expectedOccurrences: 2 }]
  };
  const [record] = await extractCatalog(root, [twoSites]);
  assert.deepEqual(record.sources[0].lines, [2, 3]);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node --test test/catalog.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/catalog/extract.mjs`.

- [ ] **Step 3: 定义五条真实消息规范**

Create `src/catalog/message-specs.mjs`:

```javascript
export const MESSAGE_SPECS = [
  {
    id: "tui.status-line.setup.use-theme-colors",
    ftlKey: "tui--status-line--setup--use-theme-colors",
    kind: "plain",
    english: "Use theme colors",
    args: [],
    sources: [{
      path: "codex-rs/tui/src/bottom_pane/status_line_setup.rs",
      symbol: "StatusLineSetupView::new",
      anchor: '"Use theme colors"',
      expectedOccurrences: 1
    }]
  },
  {
    id: "tui.status-line.setup.apply-theme-colors",
    ftlKey: "tui--status-line--setup--apply-theme-colors",
    kind: "plain",
    english: "Apply colors from the active /theme",
    args: [],
    sources: [{
      path: "codex-rs/tui/src/bottom_pane/status_line_setup.rs",
      symbol: "StatusLineSetupView::new",
      anchor: '"Apply colors from the active /theme"',
      expectedOccurrences: 1
    }]
  },
  {
    id: "tui.status-line.setup.configure-title",
    ftlKey: "tui--status-line--setup--configure-title",
    kind: "plain",
    english: "Configure Status Line",
    args: [],
    sources: [{
      path: "codex-rs/tui/src/bottom_pane/status_line_setup.rs",
      symbol: "StatusLineSetupView::new",
      anchor: '"Configure Status Line"',
      expectedOccurrences: 1
    }]
  },
  {
    id: "tui.status-line.setup.select-items-description",
    ftlKey: "tui--status-line--setup--select-items-description",
    kind: "plain",
    english: "Select which items to display in the status line.",
    args: [],
    sources: [{
      path: "codex-rs/tui/src/bottom_pane/status_line_setup.rs",
      symbol: "StatusLineSetupView::new",
      anchor: '"Select which items to display in the status line."',
      expectedOccurrences: 1
    }]
  },
  {
    id: "tui.history.worked-for",
    ftlKey: "tui--history--worked-for",
    kind: "parameterized",
    english: "Worked for {duration}",
    args: [{ name: "duration", type: "string", sample: "7m 57s" }],
    sources: [{
      path: "codex-rs/tui/src/history_cell/separators.rs",
      symbol: "FinalMessageSeparator",
      anchor: 'format!("Worked for {elapsed_seconds}")',
      expectedOccurrences: 2
    }]
  }
];
```

- [ ] **Step 4: 实现确定性提取器和报告写入器**

Create `src/catalog/extract.mjs`:

```javascript
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function allIndexes(source, anchor) {
  const indexes = [];
  let cursor = 0;
  while (true) {
    const index = source.indexOf(anchor, cursor);
    if (index === -1) return indexes;
    indexes.push(index);
    cursor = index + anchor.length;
  }
}

function lineAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

function fingerprint(payload) {
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

export async function extractCatalog(sourceRoot, specs) {
  const records = [];
  for (const spec of specs) {
    const sources = [];
    for (const sourceSpec of spec.sources) {
      const file = join(sourceRoot, ...sourceSpec.path.split("/"));
      const source = await readFile(file, "utf8");
      const indexes = allIndexes(source, sourceSpec.anchor);
      if (indexes.length !== sourceSpec.expectedOccurrences) {
        throw new Error(
          `${spec.id}: expected ${sourceSpec.expectedOccurrences} occurrence, found ${indexes.length} in ${sourceSpec.path}`
        );
      }
      const lines = indexes.map((index) => lineAt(source, index));
      sources.push({
        path: sourceSpec.path,
        symbol: sourceSpec.symbol,
        line: lines[0],
        lines,
        fingerprint: fingerprint(
          `${sourceSpec.path}|${sourceSpec.symbol}|${sourceSpec.anchor}|${source}`
        )
      });
    }
    records.push({
      schemaVersion: 1,
      catalogVersion: 1,
      id: spec.id,
      ftlKey: spec.ftlKey,
      kind: spec.kind,
      english: spec.english,
      args: spec.args,
      upstream: {
        version: "0.144.1",
        tag: "rust-v0.144.1",
        commit: "44918ea10c0f99151c6710411b4322c2f5c96bea"
      },
      sources
    });
  }
  return records.sort((left, right) => left.id.localeCompare(right.id));
}
```

Create `src/catalog/write.mjs`:

```javascript
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function writeCatalogArtifacts(records, { jsonlPath, markdownPath }) {
  await mkdir(dirname(jsonlPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });
  const jsonl = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const rows = records.map((record) => {
    const locations = record.sources
      .flatMap((source) => source.lines.map((line) => `${source.path}:${line}`))
      .join("<br>");
    return `| \`${record.id}\` | ${record.english.replaceAll("|", "\\|")} | ${record.kind} | ${locations} |`;
  });
  const markdown = [
    "# Codex CLI 0.144.1 TUI 文本目录",
    "",
    "> 该文件由 `catalog extract` 生成，不要手工编辑。",
    "",
    "| 消息 ID | 英文 | 类型 | 上游位置 |",
    "| --- | --- | --- | --- |",
    ...rows,
    ""
  ].join("\n");
  await writeFile(jsonlPath, jsonl, "utf8");
  await writeFile(markdownPath, markdown, "utf8");
}
```

- [ ] **Step 5: 添加 CLI 路由**

Create `src/cli.mjs`:

```javascript
#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { extractCatalog } from "./catalog/extract.mjs";
import { MESSAGE_SPECS } from "./catalog/message-specs.mjs";
import { writeCatalogArtifacts } from "./catalog/write.mjs";

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) throw new Error(`missing ${name}`);
  return args[index + 1];
}

export async function runCli(args) {
  if (args[0] === "catalog" && args[1] === "extract") {
    const source = resolve(option(args, "--source"));
    const records = await extractCatalog(source, MESSAGE_SPECS);
    await writeCatalogArtifacts(records, {
      jsonlPath: resolve("research/codex-0.144.1/tui-messages.jsonl"),
      markdownPath: resolve("docs/i18n/codex-0.144.1-text-inventory.md")
    });
    process.stdout.write(`extracted ${records.length} messages\n`);
    return 0;
  }
  throw new Error("usage: codex-ultra catalog extract --source PATH");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 6: 运行测试并生成真实目录**

Run:

```powershell
npm test
if (-not $env:CODEX_UPSTREAM_SOURCE) { throw 'Set CODEX_UPSTREAM_SOURCE to the exact Codex 0.144.1 checkout.' }
node src/cli.mjs catalog extract --source $env:CODEX_UPSTREAM_SOURCE
node src/cli.mjs catalog extract --source $env:CODEX_UPSTREAM_SOURCE
git diff --exit-code -- research/codex-0.144.1/tui-messages.jsonl docs/i18n/codex-0.144.1-text-inventory.md
```

Expected:

- Node tests: 3 PASS, 0 FAIL.
- Both extraction runs print `extracted 5 messages`.
- The second extraction produces no diff.

- [ ] **Step 7: 提交文本目录**

```powershell
git add .gitattributes package.json package-lock.json src/cli.mjs src/catalog test/catalog.test.mjs research/codex-0.144.1 docs/i18n/codex-0.144.1-text-inventory.md
git commit -m "feat: 建立 Codex 文本目录"
```

---

### Task 2: 添加可独立维护的 zh-CN FTL 语言包

**Files:**
- Create: `packages/languages/zh-CN/manifest.json`
- Create: `packages/languages/zh-CN/messages.ftl`
- Create: `packages/languages/zh-CN/LICENSE`
- Create: `src/language/validate.mjs`
- Create: `test/language.test.mjs`
- Modify: `src/cli.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: catalog JSONL from Task 1 and a language-pack directory.
- Produces: `validateLanguagePack({ packRoot, catalogPath })` returning `{ locale, messages, sourceHash }`, plus CLI `language validate --pack PATH --catalog PATH`.

- [ ] **Step 1: 写语言包验证失败测试**

Create `test/language.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { validateLanguagePack } from "../src/language/validate.mjs";

const catalogPath = resolve("research/codex-0.144.1/tui-messages.jsonl");
const packRoot = resolve("packages/languages/zh-CN");

test("valid zh-CN pack formats static and parameterized messages", async () => {
  const result = await validateLanguagePack({ packRoot, catalogPath });
  assert.equal(result.locale, "zh-CN");
  assert.equal(result.messages["tui.status-line.setup.configure-title"], "配置状态栏");
  assert.equal(result.messages["tui.history.worked-for"], "加班了 7m 57s");
});

test("missing required key is rejected", async () => {
  const temp = await mkdtemp(join(tmpdir(), "codex-ultra-language-"));
  await cp(packRoot, temp, { recursive: true });
  const path = join(temp, "messages.ftl");
  const source = await readFile(path, "utf8");
  await writeFile(path, source.replace(/^tui--history--worked-for.*\r?\n/m, ""), "utf8");
  await assert.rejects(
    validateLanguagePack({ packRoot: temp, catalogPath, verifyHashes: false }),
    /missing required key tui--history--worked-for/
  );
});

test("resource hash mismatch is rejected", async () => {
  const temp = await mkdtemp(join(tmpdir(), "codex-ultra-language-"));
  await cp(packRoot, temp, { recursive: true });
  await writeFile(join(temp, "messages.ftl"), "broken = value\n", "utf8");
  await assert.rejects(
    validateLanguagePack({ packRoot: temp, catalogPath }),
    /resource hash mismatch/
  );
});

test("fallback locales must be canonical, unique, and non-self-referential", async () => {
  const temp = await mkdtemp(join(tmpdir(), "codex-ultra-language-"));
  await cp(packRoot, temp, { recursive: true });
  const manifestPath = join(temp, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.fallbackLocales = ["zh-CN"];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await assert.rejects(
    validateLanguagePack({ packRoot: temp, catalogPath, verifyHashes: false }),
    /fallback locale cannot reference itself/
  );
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node --test test/language.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/language/validate.mjs`.

- [ ] **Step 3: 创建固定字节的 zh-CN 包**

Create `packages/languages/zh-CN/messages.ftl` with LF line endings:

```ftl
tui--status-line--setup--use-theme-colors = 使用主题颜色
tui--status-line--setup--apply-theme-colors = 应用当前 /theme 的颜色
tui--status-line--setup--configure-title = 配置状态栏
tui--status-line--setup--select-items-description = 选择要显示在状态栏中的项目。
tui--history--worked-for = 加班了 { $duration }
```

Create `packages/languages/zh-CN/manifest.json`:

```json
{
  "schemaVersion": 1,
  "type": "language",
  "id": "codex-cli-ultra.zh-CN",
  "locale": "zh-CN",
  "license": "GPL-3.0-only",
  "i18nApi": {
    "min": 1,
    "max": 1
  },
  "catalogVersion": 1,
  "fallbackLocales": [],
  "resources": [
    {
      "path": "messages.ftl",
      "sha256": "sha256:7ff65a10b6a37a528f75c67ac2be46ae983eea7d3f85424c1dd9853c424d1d24"
    }
  ]
}
```

Create `packages/languages/zh-CN/LICENSE` by copying the repository GPL-3.0 license text:

```powershell
Copy-Item -LiteralPath LICENSE -Destination packages/languages/zh-CN/LICENSE
```

- [ ] **Step 4: 实现严格语言包验证**

Create `src/language/validate.mjs`:

```javascript
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { FluentBundle, FluentResource } from "@fluent/bundle";

function parseJsonl(source) {
  return source.trim().split(/\r?\n/).map((line) => JSON.parse(line));
}

function sha256(buffer) {
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}

function assertManifest(manifest) {
  if (manifest.schemaVersion !== 1 || manifest.type !== "language") {
    throw new Error("unsupported language manifest");
  }
  const locale = new Intl.Locale(manifest.locale).toString();
  if (locale !== manifest.locale) throw new Error("locale must be canonical BCP 47");
  if (manifest.i18nApi?.min !== 1 || manifest.i18nApi?.max !== 1) {
    throw new Error("unsupported i18n API range");
  }
  if (manifest.catalogVersion !== 1) throw new Error("unsupported catalog version");
  if (!Array.isArray(manifest.fallbackLocales)) throw new Error("invalid fallbackLocales");
  const fallbacks = manifest.fallbackLocales.map((locale) => new Intl.Locale(locale).toString());
  if (fallbacks.some((locale, index) => locale !== manifest.fallbackLocales[index])) {
    throw new Error("fallback locales must be canonical BCP 47");
  }
  if (new Set(fallbacks).size !== fallbacks.length) {
    throw new Error("fallback locales must be unique");
  }
  if (fallbacks.includes(manifest.locale)) {
    throw new Error("fallback locale cannot reference itself");
  }
}

export async function validateLanguagePack({
  packRoot,
  catalogPath,
  verifyHashes = true
}) {
  const manifest = JSON.parse(await readFile(join(packRoot, "manifest.json"), "utf8"));
  assertManifest(manifest);
  const [resource] = manifest.resources;
  if (!resource || resource.path !== "messages.ftl") {
    throw new Error("MVP requires exactly messages.ftl");
  }
  const bytes = await readFile(join(packRoot, resource.path));
  const sourceHash = sha256(bytes);
  if (verifyHashes && sourceHash !== resource.sha256) {
    throw new Error(`resource hash mismatch: expected ${resource.sha256}, got ${sourceHash}`);
  }
  const resourceObject = new FluentResource(bytes.toString("utf8"));
  const bundle = new FluentBundle(manifest.locale, { useIsolating: false });
  const addErrors = bundle.addResource(resourceObject);
  if (addErrors.length > 0) throw new Error(`FTL parse error: ${addErrors.join("; ")}`);
  const catalog = parseJsonl(await readFile(catalogPath, "utf8"));
  const messages = {};
  for (const record of catalog) {
    const message = bundle.getMessage(record.ftlKey);
    if (!message?.value) throw new Error(`missing required key ${record.ftlKey}`);
    const args = Object.fromEntries(record.args.map((arg) => [arg.name, arg.sample]));
    const errors = [];
    const value = bundle.formatPattern(message.value, args, errors);
    if (errors.length > 0) throw new Error(`${record.ftlKey}: ${errors.join("; ")}`);
    if (!value.trim()) throw new Error(`${record.ftlKey}: empty formatted value`);
    messages[record.id] = value;
  }
  return { locale: manifest.locale, messages, sourceHash };
}
```

- [ ] **Step 5: 添加 CLI 命令并运行测试**

Extend `src/cli.mjs` with:

```javascript
import { validateLanguagePack } from "./language/validate.mjs";

// Inside runCli, before the usage error:
if (args[0] === "language" && args[1] === "validate") {
  const result = await validateLanguagePack({
    packRoot: resolve(option(args, "--pack")),
    catalogPath: resolve(option(args, "--catalog"))
  });
  process.stdout.write(`validated ${Object.keys(result.messages).length} messages for ${result.locale}\n`);
  return 0;
}
```

Run:

```powershell
npm test
node src/cli.mjs language validate --pack packages/languages/zh-CN --catalog research/codex-0.144.1/tui-messages.jsonl
```

Expected:

- All Node tests PASS.
- CLI prints `validated 5 messages for zh-CN`.

- [ ] **Step 6: 提交语言包**

```powershell
git add packages/languages/zh-CN src/language src/cli.mjs test/language.test.mjs package.json package-lock.json .gitattributes
git commit -m "feat: 添加 zh-CN Fluent 语言包"
```

---

### Task 3: 建立版本锁定的事务式源码适配器

**Files:**
- Create: `src/adapter/transaction.mjs`
- Create: `test/adapter-transaction.test.mjs`
- Modify: `src/cli.mjs`

**Interfaces:**
- Consumes: source root and an operation list containing exact `replace` and `create` operations.
- Produces: `planOperations(root, operations)`, `applyOperations(root, plan)`, `revertOperations(root)`, and adapter state under `.codex-ultra-adapter/` in the temporary upstream tree.

- [ ] **Step 1: 写事务失败测试**

Create `test/adapter-transaction.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  applyOperations,
  planOperations,
  revertOperations
} from "../src/adapter/transaction.mjs";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-adapter-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "lib.rs"), "mod before;\n", "utf8");
  return root;
}

const operations = [
  {
    type: "replace",
    path: "src/lib.rs",
    before: "mod before;\n",
    after: "mod before;\nmod i18n;\n",
    expectedOccurrences: 1
  },
  {
    type: "create",
    path: "src/i18n.rs",
    content: "pub struct Localizer;\n"
  }
];

test("planning is read-only and records before/after hashes", async () => {
  const root = await fixture();
  const before = await readFile(join(root, "src", "lib.rs"), "utf8");
  const plan = await planOperations(root, operations);
  assert.equal(await readFile(join(root, "src", "lib.rs"), "utf8"), before);
  assert.equal(plan.files.length, 2);
  assert.match(plan.files[0].beforeHash, /^sha256:/);
  assert.match(plan.files[0].afterHash, /^sha256:/);
});

test("multiple replacements for one path are applied sequentially in one file plan", async () => {
  const root = await fixture();
  const plan = await planOperations(root, [
    {
      type: "replace",
      path: "src/lib.rs",
      before: "mod before;\n",
      after: "mod before;\nmod i18n;\n",
      expectedOccurrences: 1
    },
    {
      type: "replace",
      path: "src/lib.rs",
      before: "mod i18n;\n",
      after: "mod i18n;\npub use i18n::Localizer;\n",
      expectedOccurrences: 1
    }
  ]);
  assert.equal(plan.files.length, 1);
  assert.equal(
    plan.files[0].afterBytes.toString("utf8"),
    "mod before;\nmod i18n;\npub use i18n::Localizer;\n"
  );
});

test("drift rejects the whole plan before any write", async () => {
  const root = await fixture();
  await writeFile(join(root, "src", "lib.rs"), "mod changed;\n", "utf8");
  await assert.rejects(planOperations(root, operations), /expected 1 occurrence, found 0/);
  await assert.rejects(readFile(join(root, "src", "i18n.rs"), "utf8"), /ENOENT/);
});

test("apply and revert restore exact original bytes", async () => {
  const root = await fixture();
  const original = await readFile(join(root, "src", "lib.rs"));
  const plan = await planOperations(root, operations);
  await applyOperations(root, plan);
  assert.match(await readFile(join(root, "src", "lib.rs"), "utf8"), /mod i18n/);
  await revertOperations(root);
  assert.deepEqual(await readFile(join(root, "src", "lib.rs")), original);
  await assert.rejects(readFile(join(root, "src", "i18n.rs"), "utf8"), /ENOENT/);
});
```

- [ ] **Step 2: 运行测试并确认 RED**

Run:

```powershell
node --test test/adapter-transaction.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/adapter/transaction.mjs`.

- [ ] **Step 3: 实现纯计划和事务式应用**

Create `src/adapter/transaction.mjs` with these exact exported contracts:

```javascript
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const STATE_DIR = ".codex-ultra-adapter";

function hash(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function countOccurrences(source, needle) {
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = source.indexOf(needle, cursor);
    if (index === -1) return count;
    count += 1;
    cursor = index + needle.length;
  }
}

export async function planOperations(root, operations) {
  const grouped = new Map();
  for (const operation of operations) {
    const group = grouped.get(operation.path) ?? [];
    group.push(operation);
    grouped.set(operation.path, group);
  }

  const files = [];
  for (const [path, fileOperations] of grouped) {
    const absolute = join(root, ...path.split("/"));
    const createOperations = fileOperations.filter((operation) => operation.type === "create");
    if (createOperations.length > 0) {
      if (fileOperations.length !== 1) {
        throw new Error(`${path}: create cannot be combined with other operations`);
      }
      const [operation] = createOperations;
      try {
        await readFile(absolute);
        throw new Error(`${path}: create target already exists`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const afterBytes = Buffer.from(operation.content, "utf8");
      files.push({
        path,
        created: true,
        beforeBytes: null,
        afterBytes,
        beforeHash: null,
        afterHash: hash(afterBytes)
      });
      continue;
    }

    const beforeBytes = await readFile(absolute);
    let afterText = beforeBytes.toString("utf8");
    for (const operation of fileOperations) {
      if (operation.type !== "replace") {
        throw new Error(`unsupported operation type ${operation.type}`);
      }
      const count = countOccurrences(afterText, operation.before);
      if (count !== operation.expectedOccurrences) {
        throw new Error(`${path}: expected ${operation.expectedOccurrences} occurrence, found ${count}`);
      }
      afterText = afterText.replace(operation.before, operation.after);
    }
    const afterBytes = Buffer.from(afterText, "utf8");
    files.push({
      path,
      created: false,
      beforeBytes,
      afterBytes,
      beforeHash: hash(beforeBytes),
      afterHash: hash(afterBytes)
    });
  }
  return { schemaVersion: 1, files };
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.codex-ultra-tmp-${process.pid}`;
  await writeFile(temp, bytes);
  await rename(temp, path);
}

export async function applyOperations(root, plan) {
  const stateRoot = join(root, STATE_DIR);
  const backups = join(stateRoot, "backups");
  await mkdir(backups, { recursive: true });
  const written = [];
  try {
    for (const file of plan.files) {
      const target = join(root, ...file.path.split("/"));
      if (!file.created) {
        const backup = join(backups, ...file.path.split("/"));
        await atomicWrite(backup, file.beforeBytes);
      }
      await atomicWrite(target, file.afterBytes);
      written.push(file);
    }
    const serializable = {
      schemaVersion: 1,
      files: plan.files.map(({ beforeBytes, afterBytes, ...file }) => file)
    };
    await atomicWrite(join(stateRoot, "state.json"), Buffer.from(`${JSON.stringify(serializable, null, 2)}\n`));
  } catch (error) {
    for (const file of written.reverse()) {
      const target = join(root, ...file.path.split("/"));
      if (file.created) await rm(target, { force: true });
      else await atomicWrite(target, file.beforeBytes);
    }
    await rm(stateRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function revertOperations(root) {
  const stateRoot = join(root, STATE_DIR);
  const state = JSON.parse(await readFile(join(stateRoot, "state.json"), "utf8"));
  for (const file of [...state.files].reverse()) {
    const target = join(root, ...file.path.split("/"));
    const current = await readFile(target);
    if (hash(current) !== file.afterHash) throw new Error(`${file.path}: patched file drifted`);
    if (file.created) await rm(target, { force: true });
    else {
      const backup = join(stateRoot, "backups", ...file.path.split("/"));
      await atomicWrite(target, await readFile(backup));
    }
  }
  await rm(stateRoot, { recursive: true, force: true });
}
```

- [ ] **Step 4: 运行适配器事务测试**

Run:

```powershell
node --test test/adapter-transaction.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 5: 提交事务引擎**

```powershell
git add src/adapter/transaction.mjs test/adapter-transaction.test.mjs
git commit -m "feat: 添加事务式源码适配器"
```

---

### Task 4: 实现 Rust Localizer 和 0.144.1 适配器

**Files:**
- Create: `adapters/codex/0.144.1/manifest.json`
- Create: `adapters/codex/0.144.1/overlay/i18n.rs`
- Create: `src/adapter/codex-0.144.1.mjs`
- Create: `test/codex-adapter.test.mjs`
- Modify: `src/cli.mjs`
- Modify in temporary upstream tree: `codex-rs/Cargo.toml`
- Modify in temporary upstream tree: `codex-rs/tui/Cargo.toml`
- Modify in temporary upstream tree: `codex-rs/Cargo.lock`
- Modify in temporary upstream tree: `codex-rs/cli/src/main.rs`
- Modify in temporary upstream tree: `codex-rs/tui/src/lib.rs`
- Create in temporary upstream tree: `codex-rs/tui/src/i18n.rs`

**Interfaces:**
- Consumes: exact upstream source and transaction engine from Task 3.
- Produces: `codex01441Operations(root)`, `planCodex01441(root)`, `applyCodex01441(root)`, `revertCodex01441(root)`, Rust `Localizer`, `global()`, `FluentArgs`, hidden read-only `codex --ultra-i18n-self-check`, and adapter CLI commands.

- [ ] **Step 1: 创建隔离上游工作树**

Run:

```powershell
if (-not $env:CODEX_UPSTREAM_SOURCE) { throw 'Set CODEX_UPSTREAM_SOURCE to the exact Codex 0.144.1 checkout.' }
$projectRoot = (git rev-parse --show-toplevel).Trim()
$upstream = (Resolve-Path -LiteralPath $env:CODEX_UPSTREAM_SOURCE).Path
if ((git -C $upstream rev-parse HEAD) -ne '44918ea10c0f99151c6710411b4322c2f5c96bea') {
    throw 'CODEX_UPSTREAM_SOURCE is not the pinned upstream commit.'
}
$redWorktree = Join-Path $env:TEMP ("codex-ultra-runtime-red-{0}" -f [guid]::NewGuid().ToString('N'))
$worktree = Join-Path $env:TEMP ("codex-ultra-runtime-green-{0}" -f [guid]::NewGuid().ToString('N'))
git -C $upstream worktree add --detach $redWorktree 44918ea10c0f99151c6710411b4322c2f5c96bea
git -C $upstream worktree add --detach $worktree 44918ea10c0f99151c6710411b4322c2f5c96bea
git -C $redWorktree rev-parse HEAD
git -C $worktree rev-parse HEAD
```

Expected: both worktrees report `44918ea10c0f99151c6710411b4322c2f5c96bea`. Use `$redWorktree` only for the required failing Rust test and keep `$worktree` untouched until the adapter applies the reviewed overlay.

- [ ] **Step 2: 在临时工作树写 Rust RED 测试**

Create temporary `$redWorktree/codex-rs/tui/src/i18n.rs` with only this failing test shell:

```rust
use fluent_bundle::FluentArgs;

pub(crate) struct Localizer;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parameterized_message_uses_fluent_arguments() {
        let localizer = Localizer::from_ftl(
            "zh-CN",
            "tui--history--worked-for = 加班了 { $duration }\n".to_string(),
        );
        let mut args = FluentArgs::new();
        args.set("duration", "7m 57s");
        assert_eq!(
            localizer.text("tui.history.worked-for", Some(&args), || {
                "Worked for 7m 57s".to_string()
            }),
            "加班了 7m 57s"
        );
    }
}
```

Temporarily add `mod i18n;` to `tui/src/lib.rs` and direct dependencies to both Cargo.toml files, then run:

```powershell
Set-Location "$redWorktree\codex-rs"
cargo test -p codex-tui i18n::tests::parameterized_message_uses_fluent_arguments
```

Expected RED: compiler errors that `Localizer::from_ftl` and `Localizer::text` do not exist.

- [ ] **Step 3: 创建正式 Rust overlay**

Create `adapters/codex/0.144.1/overlay/i18n.rs`:

```rust
use fluent_bundle::FluentResource;
use fluent_bundle::concurrent::FluentBundle;
pub(crate) use fluent_bundle::FluentArgs;
use serde_json::json;
use std::env;
use std::fs;
use std::sync::OnceLock;
use unic_langid::LanguageIdentifier;

type Bundle = FluentBundle<FluentResource>;

pub(crate) struct Localizer {
    bundle: Option<Bundle>,
    locale: String,
}

impl Localizer {
    pub(crate) fn english() -> Self {
        Self {
            bundle: None,
            locale: "en-US".to_string(),
        }
    }

    pub(crate) fn from_ftl(locale: &str, source: String) -> Self {
        let Ok(locale) = locale.parse::<LanguageIdentifier>() else {
            return Self::english();
        };
        let Ok(resource) = FluentResource::try_new(source) else {
            return Self::english();
        };
        let locale_name = locale.to_string();
        let mut bundle = Bundle::new_concurrent(vec![locale]);
        bundle.set_use_isolating(false);
        if bundle.add_resource(resource).is_err() {
            return Self::english();
        }
        Self {
            bundle: Some(bundle),
            locale: locale_name,
        }
    }

    pub(crate) fn from_environment() -> Self {
        let Ok(path) = env::var("CODEX_ULTRA_FTL_PATH") else {
            return Self::english();
        };
        let locale = env::var("CODEX_ULTRA_LOCALE").unwrap_or_else(|_| "en-US".to_string());
        match fs::read_to_string(path) {
            Ok(source) => Self::from_ftl(&locale, source),
            Err(_) => Self::english(),
        }
    }

    pub(crate) fn text<F>(
        &self,
        id: &str,
        args: Option<&FluentArgs<'_>>,
        english: F,
    ) -> String
    where
        F: FnOnce() -> String,
    {
        let Some(bundle) = self.bundle.as_ref() else {
            return english();
        };
        let key = id.replace('.', "--");
        let Some(message) = bundle.get_message(&key) else {
            return english();
        };
        let Some(pattern) = message.value() else {
            return english();
        };
        let mut errors = Vec::new();
        let value = bundle.format_pattern(pattern, args, &mut errors);
        if !errors.is_empty() || value.trim().is_empty() {
            return english();
        }
        value.into_owned()
    }

    pub(crate) fn self_check_json(&self) -> String {
        let mut duration_args = FluentArgs::new();
        duration_args.set("duration", "7m 57s");
        json!({
            "schemaVersion": 1,
            "active": self.bundle.is_some(),
            "locale": self.locale.as_str(),
            "messages": {
                "tui.status-line.setup.use-theme-colors": self.text(
                    "tui.status-line.setup.use-theme-colors",
                    None,
                    || "Use theme colors".to_string(),
                ),
                "tui.status-line.setup.apply-theme-colors": self.text(
                    "tui.status-line.setup.apply-theme-colors",
                    None,
                    || "Apply colors from the active /theme".to_string(),
                ),
                "tui.status-line.setup.configure-title": self.text(
                    "tui.status-line.setup.configure-title",
                    None,
                    || "Configure Status Line".to_string(),
                ),
                "tui.status-line.setup.select-items-description": self.text(
                    "tui.status-line.setup.select-items-description",
                    None,
                    || "Select which items to display in the status line.".to_string(),
                ),
                "tui.history.worked-for": self.text(
                    "tui.history.worked-for",
                    Some(&duration_args),
                    || "Worked for 7m 57s".to_string(),
                ),
            }
        })
        .to_string()
    }
}

static GLOBAL: OnceLock<Localizer> = OnceLock::new();

pub(crate) fn global() -> &'static Localizer {
    GLOBAL.get_or_init(Localizer::from_environment)
}

pub(crate) fn environment_self_check_json() -> String {
    global().self_check_json()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_static_message_is_translated() {
        let localizer = Localizer::from_ftl(
            "zh-CN",
            "tui--status-line--setup--configure-title = 配置状态栏\n".to_string(),
        );
        assert_eq!(
            localizer.text("tui.status-line.setup.configure-title", None, || {
                "Configure Status Line".to_string()
            }),
            "配置状态栏"
        );
    }

    #[test]
    fn parameterized_message_uses_fluent_arguments() {
        let localizer = Localizer::from_ftl(
            "zh-CN",
            "tui--history--worked-for = 加班了 { $duration }\n".to_string(),
        );
        let mut args = FluentArgs::new();
        args.set("duration", "7m 57s");
        assert_eq!(
            localizer.text("tui.history.worked-for", Some(&args), || {
                "Worked for 7m 57s".to_string()
            }),
            "加班了 7m 57s"
        );
    }

    #[test]
    fn invalid_resource_falls_back_to_english() {
        let localizer = Localizer::from_ftl("zh-CN", "broken = {".to_string());
        assert_eq!(
            localizer.text("broken", None, || "English".to_string()),
            "English"
        );
    }

    #[test]
    fn missing_or_empty_message_falls_back_to_english() {
        let localizer = Localizer::from_ftl("zh-CN", "empty =\n".to_string());
        assert_eq!(localizer.text("missing", None, || "English".to_string()), "English");
        assert_eq!(localizer.text("empty", None, || "English".to_string()), "English");
    }

    #[test]
    fn missing_fluent_argument_falls_back_to_english() {
        let localizer = Localizer::from_ftl(
            "zh-CN",
            "tui--history--worked-for = 加班了 { $duration }\n".to_string(),
        );
        assert_eq!(
            localizer.text("tui.history.worked-for", None, || {
                "Worked for 7m 57s".to_string()
            }),
            "Worked for 7m 57s"
        );
    }

    #[test]
    fn self_check_reports_active_translation_and_compiled_english_fallback() {
        let translated = Localizer::from_ftl(
            "zh-CN",
            "tui--history--worked-for = 加班了 { $duration }\n".to_string(),
        );
        let translated: serde_json::Value =
            serde_json::from_str(&translated.self_check_json()).expect("valid probe JSON");
        assert_eq!(translated["active"], true);
        assert_eq!(translated["locale"], "zh-CN");
        assert_eq!(translated["messages"]["tui.history.worked-for"], "加班了 7m 57s");
        assert_eq!(
            translated["messages"]["tui.status-line.setup.configure-title"],
            "Configure Status Line"
        );

        let english: serde_json::Value =
            serde_json::from_str(&Localizer::english().self_check_json())
                .expect("valid fallback probe JSON");
        assert_eq!(english["active"], false);
        assert_eq!(english["locale"], "en-US");
        assert_eq!(english["messages"]["tui.history.worked-for"], "Worked for 7m 57s");
    }
}
```

- [ ] **Step 4: 定义适配器清单和精确操作**

Create `adapters/codex/0.144.1/manifest.json`:

```json
{
  "schemaVersion": 1,
  "upstreamVersion": "0.144.1",
  "upstreamTag": "rust-v0.144.1",
  "upstreamCommit": "44918ea10c0f99151c6710411b4322c2f5c96bea",
  "ultraRevision": 1,
  "i18nApiVersion": 1,
  "catalogVersion": 1
}
```

Create `src/adapter/codex-0.144.1.mjs`. It must read the overlay with `readFile` and return exact operations equivalent to:

```javascript
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  applyOperations,
  planOperations,
  revertOperations
} from "./transaction.mjs";

const COMMIT = "44918ea10c0f99151c6710411b4322c2f5c96bea";
const CODEX_TUI_LOCK_BLOCK_HASH =
  "sha256:dec3736f9d5fb1b72a09bfc8583c9d265c1a50275e1e4eae4655532bea9b9a9a";

function sha256(text) {
  return `sha256:${createHash("sha256").update(text).digest("hex")}`;
}

async function codexTuiLockOperation(root) {
  const lockPath = join(root, "codex-rs", "Cargo.lock");
  const source = await readFile(lockPath, "utf8");
  const match = source.match(
    /^\[\[package\]\]\r?\nname = "codex-tui"\r?\n[\s\S]*?(?=^\[\[package\]\]\r?\n)/m
  );
  if (!match) throw new Error("codex-rs/Cargo.lock: codex-tui package block not found");
  const before = match[0];
  const normalized = before.replaceAll("\r\n", "\n");
  if (sha256(normalized) !== CODEX_TUI_LOCK_BLOCK_HASH) {
    throw new Error("codex-rs/Cargo.lock: codex-tui package block fingerprint mismatch");
  }
  const normalizedAfter = normalized
    .replace(' "dunce",\n', ' "dunce",\n "fluent-bundle",\n')
    .replace(' "two-face",\n', ' "two-face",\n "unic-langid",\n');
  const after = before.includes("\r\n")
    ? normalizedAfter.replaceAll("\n", "\r\n")
    : normalizedAfter;
  return {
    type: "replace",
    path: "codex-rs/Cargo.lock",
    before,
    after,
    expectedOccurrences: 1
  };
}

export async function codex01441Operations(root) {
  const overlay = await readFile(
    resolve("adapters/codex/0.144.1/overlay/i18n.rs"),
    "utf8"
  );
  return [
    {
      type: "replace",
      path: "codex-rs/Cargo.toml",
      before: 'flate2 = "1.1.8"\n',
      after: 'flate2 = "1.1.8"\nfluent-bundle = "0.15.3"\n',
      expectedOccurrences: 1
    },
    {
      type: "replace",
      path: "codex-rs/Cargo.toml",
      before: 'unicode-width = "0.2"\n',
      after: 'unic-langid = "0.9.6"\nunicode-width = "0.2"\n',
      expectedOccurrences: 1
    },
    {
      type: "replace",
      path: "codex-rs/tui/Cargo.toml",
      before: 'dunce = { workspace = true }\n',
      after: 'dunce = { workspace = true }\nfluent-bundle = { workspace = true }\n',
      expectedOccurrences: 1
    },
    {
      type: "replace",
      path: "codex-rs/tui/Cargo.toml",
      before: 'two-face = { version = "0.5", default-features = false, features = ["syntect-default-onig"] }\nunicode-segmentation = { workspace = true }\n',
      after: 'two-face = { version = "0.5", default-features = false, features = ["syntect-default-onig"] }\nunic-langid = { workspace = true }\nunicode-segmentation = { workspace = true }\n',
      expectedOccurrences: 1
    },
    await codexTuiLockOperation(root),
    {
      type: "replace",
      path: "codex-rs/tui/src/lib.rs",
      before: "mod ide_context;\npub(crate) mod insert_history;\n",
      after: "mod ide_context;\nmod i18n;\n\npub fn ultra_i18n_self_check_json() -> String {\n    i18n::environment_self_check_json()\n}\n\npub(crate) mod insert_history;\n",
      expectedOccurrences: 1
    },
    {
      type: "replace",
      path: "codex-rs/cli/src/main.rs",
      before: "fn main() -> anyhow::Result<()> {\n    let remote_control_disabled = codex_app_server::take_remote_control_disabled_env();\n",
      after: "fn main() -> anyhow::Result<()> {\n    let mut args = std::env::args_os();\n    let _program = args.next();\n    if args.next().as_deref() == Some(std::ffi::OsStr::new(\"--ultra-i18n-self-check\"))\n        && args.next().is_none()\n    {\n        println!(\"{}\", codex_tui::ultra_i18n_self_check_json());\n        return Ok(());\n    }\n\n    let remote_control_disabled = codex_app_server::take_remote_control_disabled_env();\n",
      expectedOccurrences: 1
    },
    {
      type: "create",
      path: "codex-rs/tui/src/i18n.rs",
      content: overlay
    }
  ];
}

export async function planCodex01441(root) {
  return planOperations(root, await codex01441Operations(root));
}

export async function applyCodex01441(root) {
  const plan = await planCodex01441(root);
  await applyOperations(root, plan);
  return plan;
}

export async function revertCodex01441(root) {
  await revertOperations(root);
}

export { COMMIT };
```

The recorded anchors are from commit `44918ea10c0f99151c6710411b4322c2f5c96bea`. The complete normalized `codex-tui` lock block must hash to `sha256:dec3736f9d5fb1b72a09bfc8583c9d265c1a50275e1e4eae4655532bea9b9a9a`; any mismatch is a hard adapter failure, not a reason to weaken the check.

- [ ] **Step 5: 写真实适配器测试**

Create `test/codex-adapter.test.mjs`:

```javascript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { planCodex01441 } from "../src/adapter/codex-0.144.1.mjs";

const sourceValue = process.env.CODEX_UPSTREAM_SOURCE;
const source = sourceValue ? resolve(sourceValue) : null;
const upstreamTestOptions = source
  ? {}
  : { skip: "CODEX_UPSTREAM_SOURCE is not set in the fast unit-test job" };

test("0.144.1 adapter plans only the i18n dependency and module files", upstreamTestOptions, async () => {
  const plan = await planCodex01441(source);
  assert.deepEqual(
    plan.files.map((file) => file.path).sort(),
    [
      "codex-rs/Cargo.lock",
      "codex-rs/Cargo.toml",
      "codex-rs/cli/src/main.rs",
      "codex-rs/tui/Cargo.toml",
      "codex-rs/tui/src/i18n.rs",
      "codex-rs/tui/src/lib.rs"
    ]
  );
  assert.equal(plan.files.every((file) => file.afterHash.startsWith("sha256:")), true);
});

test("planning leaves the reference checkout unchanged", upstreamTestOptions, async () => {
  const before = await readFile(`${source}/codex-rs/tui/src/lib.rs`, "utf8");
  await planCodex01441(source);
  assert.equal(await readFile(`${source}/codex-rs/tui/src/lib.rs`, "utf8"), before);
});
```

The Task 3 regression test already requires `planOperations` to group operations by path and apply replacements sequentially in memory before producing one file plan. This integration test confirms that behavior against the pinned upstream checkout.

- [ ] **Step 6: 应用到干净工作树并运行 Rust GREEN 测试**

Extend `src/cli.mjs` with `adapter apply`, `adapter revert`, and `adapter plan` routing to the 0.144.1 adapter.

Apply the adapter to the untouched detached `$worktree`, then run:

```powershell
Set-Location $projectRoot
node src/cli.mjs adapter apply --source $worktree
Set-Location "$worktree\codex-rs"
cargo test -p codex-tui i18n::tests
cargo check -p codex-tui --locked
$env:CODEX_ULTRA_LOCALE = 'zh-CN'
$env:CODEX_ULTRA_FTL_PATH = (Resolve-Path (Join-Path $projectRoot 'packages\languages\zh-CN\messages.ftl')).Path
$translatedProbe = cargo run -p codex-cli --locked -- --ultra-i18n-self-check | ConvertFrom-Json
if ($translatedProbe.messages.'tui.history.worked-for' -ne '加班了 7m 57s') { throw 'Translated probe failed.' }
$env:CODEX_ULTRA_FTL_PATH = Join-Path $env:TEMP 'missing-codex-ultra.ftl'
$englishProbe = cargo run -p codex-cli --locked -- --ultra-i18n-self-check | ConvertFrom-Json
if ($englishProbe.messages.'tui.history.worked-for' -ne 'Worked for 7m 57s') { throw 'English probe failed.' }
```

Expected:

- Six `i18n::tests` PASS.
- `cargo check --locked` succeeds, proving Cargo.lock was patched correctly.
- The hidden self-check returns Chinese with the valid FTL and compiled English with a missing FTL path.

- [ ] **Step 7: 提交 Rust 运行时和适配器**

```powershell
Set-Location $projectRoot
npm test
git add adapters/codex/0.144.1 src/adapter src/cli.mjs test/codex-adapter.test.mjs test/adapter-transaction.test.mjs
git commit -m "feat: 添加 Rust i18n 运行时"
```

---

### Task 5: 接入状态栏消息和 `加班了 {duration}`

**Files:**
- Modify: `src/adapter/codex-0.144.1.mjs`
- Modify in temporary upstream tree: `codex-rs/tui/src/bottom_pane/status_line_setup.rs`
- Modify in temporary upstream tree: `codex-rs/tui/src/history_cell/separators.rs`
- Create in temporary upstream tree: `codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_narrow.snap`
- Create in temporary upstream tree: `codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_medium.snap`
- Create in temporary upstream tree: `codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_wide.snap`
- Create: matching files under `adapters/codex/0.144.1/overlay/snapshots/`
- Modify: `test/codex-adapter.test.mjs`

**Interfaces:**
- Consumes: `Localizer`, `global()`, and `FluentArgs` from Task 4.
- Produces: `StatusLineSetupView::new_with_localizer`, `FinalMessageSeparator::label_parts_with_localizer`, four translated status-line strings, and one parameterized history message.

- [ ] **Step 1: 写状态栏中文快照 RED 测试**

In the temporary worktree, add this test inside `status_line_setup.rs` tests:

```rust
#[test]
fn setup_view_snapshot_uses_zh_cn_localizer() {
    let localizer = crate::i18n::Localizer::from_ftl(
        "zh-CN",
        concat!(
            "tui--status-line--setup--use-theme-colors = 使用主题颜色\n",
            "tui--status-line--setup--apply-theme-colors = 应用当前 /theme 的颜色\n",
            "tui--status-line--setup--configure-title = 配置状态栏\n",
            "tui--status-line--setup--select-items-description = 选择要显示在状态栏中的项目。\n",
        )
        .to_string(),
    );
    let (tx_raw, _rx) = unbounded_channel::<AppEvent>();
    let view = StatusLineSetupView::new_with_localizer(
        None,
        true,
        StatusSurfacePreviewData::default(),
        AppEventSender::new(tx_raw),
        crate::keymap::RuntimeKeymap::defaults().list,
        &localizer,
    );
    insta::assert_snapshot!("status_line_setup_zh_cn_narrow", render_lines(&view, 32));
    insta::assert_snapshot!("status_line_setup_zh_cn_medium", render_lines(&view, 72));
    insta::assert_snapshot!("status_line_setup_zh_cn_wide", render_lines(&view, 120));
}
```

The test deliberately reuses the file's existing `unbounded_channel::<AppEvent>()`, `AppEventSender::new(tx_raw)`, `StatusSurfacePreviewData::default()`, `RuntimeKeymap::defaults().list`, and `render_lines` patterns. Run:

```powershell
Set-Location "$worktree\codex-rs"
cargo test -p codex-tui setup_view_snapshot_uses_zh_cn_localizer
```

Expected RED: `new_with_localizer` does not exist.

- [ ] **Step 2: 重构构造器并翻译四条字符串**

Change the production constructor shape to:

```rust
pub(crate) fn new(
    status_line_items: Option<&[String]>,
    use_theme_colors: bool,
    preview_data: StatusSurfacePreviewData,
    app_event_tx: AppEventSender,
    list_keymap: ListKeymap,
) -> Self {
    Self::new_with_localizer(
        status_line_items,
        use_theme_colors,
        preview_data,
        app_event_tx,
        list_keymap,
        crate::i18n::global(),
    )
}

fn new_with_localizer(
    status_line_items: Option<&[String]>,
    use_theme_colors: bool,
    preview_data: StatusSurfacePreviewData,
    app_event_tx: AppEventSender,
    list_keymap: ListKeymap,
    localizer: &crate::i18n::Localizer,
) -> Self {
    // Existing constructor body, with only these four values replaced:
}
```

Use these exact lookups:

```rust
name: localizer.text(
    "tui.status-line.setup.use-theme-colors",
    None,
    || "Use theme colors".to_string(),
),
description: Some(localizer.text(
    "tui.status-line.setup.apply-theme-colors",
    None,
    || "Apply colors from the active /theme".to_string(),
)),
```

and:

```rust
MultiSelectPicker::builder(
    localizer.text(
        "tui.status-line.setup.configure-title",
        None,
        || "Configure Status Line".to_string(),
    ),
    Some(localizer.text(
        "tui.status-line.setup.select-items-description",
        None,
        || "Select which items to display in the status line.".to_string(),
    )),
    app_event_tx,
)
```

- [ ] **Step 3: 运行并接受状态栏快照**

Run:

```powershell
cargo test -p codex-tui setup_view_snapshot_uses_zh_cn_localizer
cargo insta pending-snapshots -p codex-tui
cargo insta accept -p codex-tui
cargo test -p codex-tui setup_view_snapshot_uses_zh_cn_localizer
```

Expected: all three accepted snapshots visibly contain `使用主题颜色` and `配置状态栏`; the medium and wide snapshots also contain the complete `选择要显示在状态栏中的项目。` text, while the narrow snapshot proves deterministic CJK wrapping or truncation.

- [ ] **Step 4: 写 Worked for 参数化 RED 测试**

Inside `history_cell/separators.rs` tests, add:

```rust
#[test]
fn worked_for_uses_zh_cn_localizer() {
    let localizer = crate::i18n::Localizer::from_ftl(
        "zh-CN",
        "tui--history--worked-for = 加班了 { $duration }\n".to_string(),
    );
    let separator = FinalMessageSeparator::new(Some(477), None);
    let parts = separator.label_parts_with_localizer(&localizer);
    assert_eq!(parts, vec!["加班了 7m 57s".to_string()]);
}
```

Run:

```powershell
cargo test -p codex-tui worked_for_uses_zh_cn_localizer
```

Expected RED: `label_parts_with_localizer` does not exist.

- [ ] **Step 5: 提取共享 label parts 并接入 Fluent 参数**

Refactor `FinalMessageSeparator` so both `display_lines` and `raw_lines` call:

```rust
fn label_parts_with_localizer(
    &self,
    localizer: &crate::i18n::Localizer,
) -> Vec<String> {
    let mut label_parts = Vec::new();
    if let Some(duration) = self
        .elapsed_seconds
        .filter(|seconds| *seconds > 60)
        .map(crate::status_indicator_widget::fmt_elapsed_compact)
    {
        let mut args = crate::i18n::FluentArgs::new();
        args.set("duration", duration.clone());
        label_parts.push(localizer.text(
            "tui.history.worked-for",
            Some(&args),
            || format!("Worked for {duration}"),
        ));
    }
    if let Some(metrics_label) = self.runtime_metrics.and_then(runtime_metrics_label) {
        label_parts.push(metrics_label);
    }
    label_parts
}
```

Production methods call `self.label_parts_with_localizer(crate::i18n::global())`. Preserve all existing separator width and raw-output behavior.

- [ ] **Step 6: 把已验证变更编码为适配器操作**

Add exact `replace` operations to `src/adapter/codex-0.144.1.mjs` for:

- the complete original `StatusLineSetupView::new` signature and the four English call sites;
- the duplicated label construction in `display_lines` and `raw_lines`, replaced by the shared helper;
- the new Rust tests;
- the three accepted snapshot files, first copied byte-for-byte into `adapters/codex/0.144.1/overlay/snapshots/`, then read by the adapter and emitted as exact `create` operations at the three upstream snapshot paths.

Every replacement must use the complete original code block as `before`, the complete tested code block as `after`, and `expectedOccurrences: 1`. Do not use individual fuzzy string replacements for this task.

Update `test/codex-adapter.test.mjs` to assert the plan includes:

```javascript
assert.deepEqual(
  plan.files.filter((file) => file.path.includes("status_line_setup") || file.path.includes("separators"))
    .map((file) => file.path)
    .sort(),
    [
    "codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_medium.snap",
    "codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_narrow.snap",
    "codex-rs/tui/src/bottom_pane/snapshots/codex_tui__bottom_pane__status_line_setup__tests__status_line_setup_zh_cn_wide.snap",
    "codex-rs/tui/src/bottom_pane/status_line_setup.rs",
    "codex-rs/tui/src/history_cell/separators.rs"
  ]
);
```

The adapter test must also assert that each planned snapshot `afterHash` equals the SHA-256 of its repository overlay source, so a changed accepted snapshot cannot silently diverge from the reproducible patch.

- [ ] **Step 7: 从干净工作树证明适配器可重复生成 Rust 结果**

Run:

```powershell
$verificationWorktree = Join-Path $env:TEMP ("codex-ultra-runtime-replay-{0}" -f [guid]::NewGuid().ToString('N'))
git -C $upstream worktree add --detach $verificationWorktree 44918ea10c0f99151c6710411b4322c2f5c96bea
node src/cli.mjs adapter apply --source $verificationWorktree
Set-Location "$verificationWorktree\codex-rs"
cargo test -p codex-tui i18n::tests
cargo test -p codex-tui setup_view_snapshot_uses_zh_cn_localizer
cargo test -p codex-tui setup_view_snapshot_uses_runtime_preview_values
cargo test -p codex-tui worked_for_uses_zh_cn_localizer
cargo test -p codex-tui history_cell
```

Expected: all focused tests PASS from adapter-produced files; the pre-existing English status-line snapshot remains byte-for-byte accepted, proving that an inactive Localizer preserves official rendering.

- [ ] **Step 8: 提交 TUI 接入**

```powershell
Set-Location $projectRoot
npm test
git diff --check
git add src/adapter/codex-0.144.1.mjs adapters/codex/0.144.1 test/codex-adapter.test.mjs
git commit -m "feat: 接入状态栏与工作时长翻译"
```

---

### Task 6: 完成运行时验证和操作文档

**Files:**
- Create: `scripts/test-i18n-runtime.ps1`
- Create: `scripts/measure-i18n-size.ps1`
- Create: `research/codex-0.144.1/i18n-size.json`
- Create: `docs/i18n/runtime-mvp.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: patched upstream worktree and zh-CN pack.
- Produces: repeatable PowerShell verification, a same-profile baseline/patched binary-size record, and an operator-facing runtime proof document.

- [ ] **Step 1: 写 PowerShell smoke test 的失败调用**

Run before the script exists:

```powershell
pwsh -NoProfile -File scripts/test-i18n-runtime.ps1 -SourceWorktree $worktree
```

Expected RED: PowerShell reports that `scripts/test-i18n-runtime.ps1` does not exist.

- [ ] **Step 2: 实现运行时验证脚本**

Create `scripts/test-i18n-runtime.ps1`:

```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$SourceWorktree
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = (Resolve-Path -LiteralPath $SourceWorktree).Path
$codexRs = Join-Path $sourceRoot 'codex-rs'
$ftl = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'packages\languages\zh-CN\messages.ftl')).Path

Push-Location $repoRoot
try {
    node src/cli.mjs language validate `
        --pack packages/languages/zh-CN `
        --catalog research/codex-0.144.1/tui-messages.jsonl
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

$env:CODEX_ULTRA_LOCALE = 'zh-CN'
$env:CODEX_ULTRA_FTL_PATH = $ftl

Push-Location $codexRs
try {
    cargo test -p codex-tui i18n::tests
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    cargo test -p codex-tui setup_view_snapshot_uses_zh_cn_localizer
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    cargo test -p codex-tui worked_for_uses_zh_cn_localizer
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    cargo check -p codex-tui --locked
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $translated = cargo run -p codex-cli --locked -- --ultra-i18n-self-check | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($translated.messages.'tui.history.worked-for' -ne '加班了 7m 57s') {
        throw 'Translated binary self-check failed.'
    }
    $env:CODEX_ULTRA_FTL_PATH = Join-Path $env:TEMP 'codex-ultra-missing-language.ftl'
    $english = cargo run -p codex-cli --locked -- --ultra-i18n-self-check | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    if ($english.messages.'tui.history.worked-for' -ne 'Worked for 7m 57s') {
        throw 'Compiled-English binary self-check failed.'
    }
    exit 0
} finally {
    Pop-Location
}
```

- [ ] **Step 3: 实现同 profile 二进制体积测量**

Create `scripts/measure-i18n-size.ps1`:

```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$BaselineWorktree,

    [Parameter(Mandatory)]
    [string]$PatchedWorktree,

    [string]$OutputPath = 'research/codex-0.144.1/i18n-size.json'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Build-CodexRelease([string]$Worktree) {
    $root = (Resolve-Path -LiteralPath $Worktree).Path
    $codexRs = Join-Path $root 'codex-rs'
    Push-Location $codexRs
    try {
        $cargoVersion = (& cargo --version).Trim()
        if ($cargoVersion -notmatch '^cargo 1\.95\.0 ') {
            throw "Pinned Cargo 1.95.0 is required, got: $cargoVersion"
        }
        & cargo build -p codex-cli --release --locked
        if ($LASTEXITCODE -ne 0) { throw "cargo build failed with $LASTEXITCODE" }
        $binary = Get-Item -LiteralPath (Join-Path $codexRs 'target\release\codex.exe')
        return [ordered]@{
            cargo = $cargoVersion
            bytes = $binary.Length
        }
    } finally {
        Pop-Location
    }
}

$baseline = Build-CodexRelease $BaselineWorktree
$patched = Build-CodexRelease $PatchedWorktree
$delta = [int64]$patched.bytes - [int64]$baseline.bytes
$percent = if ($baseline.bytes -eq 0) { 0 } else { [math]::Round(($delta * 100.0) / $baseline.bytes, 4) }
$record = [ordered]@{
    schemaVersion = 1
    upstreamVersion = '0.144.1'
    upstreamCommit = '44918ea10c0f99151c6710411b4322c2f5c96bea'
    profile = 'release'
    cargo = $baseline.cargo
    baselineBytes = $baseline.bytes
    patchedBytes = $patched.bytes
    deltaBytes = $delta
    deltaPercent = $percent
}

$absoluteOutput = Join-Path $repoRoot $OutputPath
$outputDirectory = Split-Path -Parent $absoluteOutput
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$json = $record | ConvertTo-Json
[IO.File]::WriteAllText($absoluteOutput, "$json`n", [Text.UTF8Encoding]::new($false))
$json
```

Run against two new detached worktrees created from the same commit:

```powershell
$sizeBaselineWorktree = Join-Path $env:TEMP ("codex-ultra-size-baseline-{0}" -f [guid]::NewGuid().ToString('N'))
$sizePatchedWorktree = Join-Path $env:TEMP ("codex-ultra-size-patched-{0}" -f [guid]::NewGuid().ToString('N'))
git -C $upstream worktree add --detach $sizeBaselineWorktree 44918ea10c0f99151c6710411b4322c2f5c96bea
git -C $upstream worktree add --detach $sizePatchedWorktree 44918ea10c0f99151c6710411b4322c2f5c96bea
node src/cli.mjs adapter apply --source $sizePatchedWorktree
pwsh -NoProfile -File scripts/measure-i18n-size.ps1 `
  -BaselineWorktree $sizeBaselineWorktree `
  -PatchedWorktree $sizePatchedWorktree
```

Expected: both builds use Cargo 1.95.0 and `research/codex-0.144.1/i18n-size.json` contains non-zero baseline and patched byte counts plus the measured delta. This is evidence, not a hard size ceiling for the MVP.

- [ ] **Step 4: 写运行时文档和 README 入口**

Create `docs/i18n/runtime-mvp.md` documenting these exact facts:

~~~~markdown
# Rust i18n Runtime MVP

The runtime proof is pinned to Codex CLI 0.144.1 / rust-v0.144.1.

Run:

```powershell
if (-not $env:CODEX_UPSTREAM_SOURCE) { throw 'Set CODEX_UPSTREAM_SOURCE first.' }
$runtimeProof = Join-Path $env:TEMP ("codex-ultra-runtime-proof-{0}" -f [guid]::NewGuid().ToString('N'))
git -C $env:CODEX_UPSTREAM_SOURCE worktree add --detach $runtimeProof 44918ea10c0f99151c6710411b4322c2f5c96bea
node src/cli.mjs adapter apply --source $runtimeProof
pwsh -NoProfile -File scripts/test-i18n-runtime.ps1 `
  -SourceWorktree $runtimeProof
```

The proof covers four status-line setup messages and the parameterized
`加班了 {duration}` history separator. Missing, malformed, or incomplete FTL
falls back to the original compiled English text.

The measured same-profile binary delta is recorded in
`research/codex-0.144.1/i18n-size.json`; final packaged size is measured again
by the Release plan after the official packaging and symbol-stripping steps.
~~~~

Add a concise README link under the early roadmap. Do not claim that the global `codex` command is installed yet; that belongs to Plan 2 and Plan 3.

- [ ] **Step 5: 运行完整验证**

Run:

```powershell
Set-Location $projectRoot
npm test
node src/cli.mjs catalog extract --source $env:CODEX_UPSTREAM_SOURCE
node src/cli.mjs language validate --pack packages/languages/zh-CN --catalog research/codex-0.144.1/tui-messages.jsonl
pwsh -NoProfile -File scripts/test-i18n-runtime.ps1 -SourceWorktree $worktree
pwsh -NoProfile -File scripts/measure-i18n-size.ps1 -BaselineWorktree $sizeBaselineWorktree -PatchedWorktree $sizePatchedWorktree
git diff --check
```

Expected:

- All Node tests PASS.
- Catalog contains exactly 5 records.
- Language validation reports 5 messages.
- All three focused Rust test groups and `cargo check --locked` PASS.
- The size record contains the same Cargo version for both builds and exact byte counts.
- `git diff --check` prints no errors.

- [ ] **Step 6: 提交运行时 MVP 文档和脚本**

```powershell
git add scripts/test-i18n-runtime.ps1 scripts/measure-i18n-size.ps1 research/codex-0.144.1/i18n-size.json docs/i18n/runtime-mvp.md README.md
git commit -m "feat: 完成 Rust i18n 运行时验证"
```

---

### Task 7: 运行计划 1 最终审查

**Files:**
- Verify all files created or modified by Tasks 1-6.

**Interfaces:**
- Consumes: completed runtime branch.
- Produces: a clean, reviewable runtime deliverable for Plan 2 and Plan 3.

- [ ] **Step 1: 验证项目测试和生成物确定性**

```powershell
npm test
node src/cli.mjs catalog extract --source $env:CODEX_UPSTREAM_SOURCE
git diff --exit-code -- research/codex-0.144.1/tui-messages.jsonl docs/i18n/codex-0.144.1-text-inventory.md
node src/cli.mjs language validate --pack packages/languages/zh-CN --catalog research/codex-0.144.1/tui-messages.jsonl
$size = Get-Content -Raw research/codex-0.144.1/i18n-size.json | ConvertFrom-Json
if ($size.baselineBytes -le 0 -or $size.patchedBytes -le 0 -or $size.cargo -notmatch '^cargo 1\.95\.0 ') { throw 'Invalid size evidence.' }
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: 验证真实适配器和 Rust 测试**

```powershell
$finalWorktree = Join-Path $env:TEMP ("codex-ultra-runtime-final-{0}" -f [guid]::NewGuid().ToString('N'))
git -C $upstream worktree add --detach $finalWorktree 44918ea10c0f99151c6710411b4322c2f5c96bea
node src/cli.mjs adapter apply --source $finalWorktree
pwsh -NoProfile -File scripts/test-i18n-runtime.ps1 -SourceWorktree $finalWorktree
```

Expected: adapter application and all runtime checks exit 0.

- [ ] **Step 3: 审阅差异边界**

Confirm with:

```powershell
git status --short
git diff origin/main...HEAD --stat
rg -n "CODEX_ULTRA_|Localizer|Worked for|加班了" src adapters packages docs scripts test research
```

Required review conclusions:

- No full upstream source tree is tracked.
- No language pack executes code.
- Every adapter anchor is exact and version locked.
- English fallback closures preserve the original English text.
- Random phrase selection is absent.
- Plan 2 can consume the language pack and adapter without reading upstream internals.

- [ ] **Step 4: 请求代码审查**

Use the `requesting-code-review` skill against the completed runtime diff. Address only findings within this plan's file boundaries, rerun Steps 1-3, and leave the branch ready for Plan 2.
