# Rust i18n Runtime MVP Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Use superpowers:test-driven-development for every behavior change.

**Goal:** 把 PR #1 已通过测试的“FTL 编译为 JSON、Rust 读取 JSON”原型迁移为直接加载外部 FTL 的薄 Rust i18n 运行时，同时保留已有文本研究、事务适配和英文回退能力，并加入 `加班了 {duration}`、隐藏二进制自检、CJK 快照和同 profile 体积证据。

**Architecture:** 当前仓库是迁移基线，不是空项目。JavaScript 保留源码目录提取、语言包严格预检和版本锁定适配；Rust `codex-tui` 使用 `fluent-bundle` 最终格式化。官方英文闭包始终位于调用点，单条失败回退该条英文，整包失败本次进程使用英文。

**Tech Stack:** Node.js 24.15.0、npm 11.12.1、Node 内置测试运行器、`@fluent/bundle` 0.19.1、上游 Rust/Cargo 1.95.0、`fluent-bundle` 0.15.3、`unic-langid` 0.9.6、PowerShell 7.6.3、Insta snapshots。

## Existing Baseline

远端 PR #1 已提供以下可工作的基线，开始实现前 `npm ci && npm test` 必须保持 22 项测试、0 失败：

- 10 条真实源码文本，其中 4 条状态栏消息标记为 `wired`，6 条 onboarding 消息标记为 `catalogued`。
- `src/pack/compile.mjs` 把 FTL 编译为静态 JSON。
- `src/adapter/codex-0.144.1.mjs` 提供精确锚点、预检、事务应用、备份、回滚和 doctor。
- `src/adapter/overlay/i18n.rs` 提供 JSON `Translator`。
- `scripts/codex-ultra.ps1` 验证源码工作树原型。

迁移不得丢失六条已整理但暂未接入的 onboarding 记录，不得降低现有适配器的路径逃逸、失败恢复和精确字节回滚测试。

## Global Constraints

- 固定 Codex CLI `0.144.1`、标签 `rust-v0.144.1`、提交 `44918ea10c0f99151c6710411b4322c2f5c96bea`。
- 上游 `codex-rs/rust-toolchain.toml` 固定 Rust/Cargo 1.95.0；不得用全局更新版 Cargo 重写锁文件。
- 公开命令使用 `$env:CODEX_UPSTREAM_SOURCE`；公开文件不记录维护者私有路径。
- 完整上游源码不进入本仓库，只维护目录、语言包、overlay、精确锚点和验证证据。
- 语言包只包含声明式 FTL、manifest、许可证和文档。
- MVP 文本目录共 11 条：5 条 `wired`、6 条 `catalogued`；语言包只强制覆盖 5 条 `wired` 消息。
- `CODEX_ULTRA_LOCALE` 和 `CODEX_ULTRA_FTL_PATH` 是运行时输入；旧 `CODEX_ULTRA_CATALOG` 在迁移完成后删除。
- Fluent bidi isolation 在 MVP 关闭；RTL 布局不在本计划范围内。
- 不使用 `git reset --hard` 或 `git clean` 复用已写工作树；每次重放使用新的 detached worktree。
- 所有提交使用中文 Conventional Commit。

## Planned File Changes

```text
Modify  package.json package-lock.json .gitattributes
Modify  src/catalog/message-specs.mjs src/catalog/extract.mjs src/cli.mjs
Modify  test/catalog.test.mjs test/cli.test.mjs
Create  src/language/validate.mjs test/language.test.mjs
Modify  packages/languages/zh-CN/manifest.json packages/languages/zh-CN/messages.ftl
Delete  src/pack/compile.mjs test/pack.test.mjs build/languages/zh-CN/compiled-messages.json
Create  src/adapter/transaction.mjs test/adapter-transaction.test.mjs
Modify  src/adapter/codex-0.144.1.mjs test/adapter.test.mjs
Move    src/adapter/overlay/* -> adapters/codex/0.144.1/overlay/*
Create  adapters/codex/0.144.1/manifest.json
Create  scripts/test-i18n-runtime.ps1 scripts/measure-i18n-size.ps1
Create  research/codex-0.144.1/i18n-size.json docs/i18n/runtime-mvp.md
Modify  docs/i18n/mvp-usage.md README.md
```

---

### Task 1: 扩展现有文本目录为 11 条并加入参数消息

**Interfaces:**
- Preserve: existing `extractCatalog(sourceRoot, specs)` and `writeCatalogArtifacts(records, paths)` exports.
- Add: `expectedOccurrences`, `args`, `source.lines`, `catalogVersion`, and pinned upstream commit metadata.

- [ ] **Step 1: 写迁移 RED 测试**

Extend `test/catalog.test.mjs` and import `MESSAGE_SPECS`. Add assertions:

```javascript
test("catalog keeps six researched messages and adds Worked for as the fifth wired message", () => {
  assert.equal(MESSAGE_SPECS.length, 11);
  assert.equal(MESSAGE_SPECS.filter((item) => item.mvpStatus === "wired").length, 5);
  assert.equal(MESSAGE_SPECS.filter((item) => item.mvpStatus === "catalogued").length, 6);
  const worked = MESSAGE_SPECS.find((item) => item.id === "tui.history.worked-for");
  assert.deepEqual(worked.args, [{ name: "duration", type: "string", sample: "7m 57s" }]);
  assert.equal(worked.expectedOccurrences, 2);
});

test("extractCatalog records every source line for a repeated semantic message", async () => {
  const sourceRoot = await createSourceTree('fn render() {\n "Worked";\n "Worked";\n}\n');
  const [record] = await extractCatalog(sourceRoot, [{
    id: "tui.history.worked-for",
    ftlKey: "tui--history--worked-for",
    surface: "history",
    kind: "parameterized",
    translation: "required",
    mvpStatus: "wired",
    path: "codex-rs/tui/src/sample.rs",
    symbol: "FinalMessageSeparator",
    anchor: '"Worked"',
    english: "Worked for {duration}",
    args: [{ name: "duration", type: "string", sample: "7m 57s" }],
    expectedOccurrences: 2
  }]);
  assert.deepEqual(record.source.lines, [2, 3]);
});
```

- [ ] **Step 2: 确认 RED 原因**

```powershell
node --test test/catalog.test.mjs
```

Expected: current catalog has 10 entries and the extractor rejects the two-occurrence fixture.

- [ ] **Step 3: 扩展现有规范和提取器**

Keep all ten existing specs and append:

```javascript
{
  id: "tui.history.worked-for",
  ftlKey: "tui--history--worked-for",
  surface: "history",
  kind: "parameterized",
  translation: "required",
  mvpStatus: "wired",
  path: "codex-rs/tui/src/history_cell/separators.rs",
  symbol: "FinalMessageSeparator",
  anchor: 'format!("Worked for {elapsed_seconds}")',
  english: "Worked for {duration}",
  args: [{ name: "duration", type: "string", sample: "7m 57s" }],
  expectedOccurrences: 2
}
```

For every spec, default `args` to `[]` and `expectedOccurrences` to `1`. `extractCatalog` must compare the actual occurrence count, store `source.line` as the first line for backward compatibility, store every line in `source.lines`, and preserve `mvpStatus`. Add `catalogVersion: 1` and upstream commit `44918ea10c0f99151c6710411b4322c2f5c96bea` without removing existing provenance fields.

- [ ] **Step 4: 更新 Node 版本和目录命令**

Change `package.json` engine to `>=24`; retain existing scripts for the moment. Keep `writeCatalogArtifacts` in `src/catalog/extract.mjs` rather than introducing a duplicate writer module. Existing `pathToFileURL` entry detection remains unchanged.

- [ ] **Step 5: 生成真实目录并验证确定性**

```powershell
$env:CODEX_UPSTREAM_SOURCE = (Resolve-Path $env:CODEX_UPSTREAM_SOURCE).Path
npm test
node src/cli.mjs catalog extract --source $env:CODEX_UPSTREAM_SOURCE
node src/cli.mjs catalog extract --source $env:CODEX_UPSTREAM_SOURCE
git diff --exit-code -- research/codex-0.144.1/tui-messages.jsonl docs/i18n/codex-0.144.1-text-inventory.md
```

Expected: output reports 11 records, five wired entries, and the second generation creates no diff.

- [ ] **Step 6: 提交**

```powershell
git add package.json package-lock.json src/catalog test/catalog.test.mjs research/codex-0.144.1 docs/i18n/codex-0.144.1-text-inventory.md
git commit -m "feat: 扩展 Codex 文本目录与参数消息"
```

---

### Task 2: 用直接 FTL 验证替换编译 JSON 运行时

**Interfaces:**
- Add: `validateLanguagePack({ packRoot, catalogPath, verifyHashes = true })` returning `{ locale, messages, sourceHash }`.
- Remove: compiled runtime JSON and `CODEX_ULTRA_CATALOG` contract.

- [ ] **Step 1: 写语言包 RED 测试**

Create `test/language.test.mjs` covering valid five-message formatting, missing wired key, malformed FTL, wrong resource hash, empty output, missing `{duration}`, noncanonical/self/duplicate fallback locale, and the rule that six `catalogued` records are not required translations.

The valid test must assert:

```javascript
const result = await validateLanguagePack({ packRoot, catalogPath });
assert.equal(result.locale, "zh-CN");
assert.equal(Object.keys(result.messages).length, 5);
assert.equal(result.messages["tui.history.worked-for"], "加班了 7m 57s");
```

- [ ] **Step 2: 确认 RED**

```powershell
node --test test/language.test.mjs
```

Expected: `src/language/validate.mjs` does not exist.

- [ ] **Step 3: 更新固定字节语言包**

`messages.ftl` uses LF and exactly:

```ftl
tui--status-line--setup--use-theme-colors = 使用主题颜色
tui--status-line--setup--apply-theme-colors = 应用当前 /theme 的颜色
tui--status-line--setup--configure-title = 配置状态栏
tui--status-line--setup--select-items-description = 选择要显示在状态栏中的项目。
tui--history--worked-for = 加班了 { $duration }
```

The SHA-256 is `sha256:7ff65a10b6a37a528f75c67ac2be46ae983eea7d3f85424c1dd9853c424d1d24`.

Replace the legacy version-bound manifest with schema 1 fields: `type`, `id`, canonical `locale`, `license`, `i18nApi {min:1,max:1}`, `catalogVersion:1`, `fallbackLocales:[]`, and one resource record using the prefixed hash.

- [ ] **Step 4: 实现 validator**

Use `FluentBundle` and `FluentResource`. Parse JSONL, filter `mvpStatus === "wired"`, format each message with samples from `args`, reject any Fluent errors or empty values, and return logical message IDs. Validate fallback locales as canonical, unique and non-self-referential.

- [ ] **Step 5: 迁移 CLI 并删除 JSON 产物**

Replace `pack compile` with:

```text
language validate --pack PATH --catalog PATH
```

Update `test/cli.test.mjs`, then delete `src/pack/compile.mjs`, `test/pack.test.mjs`, and `build/languages/zh-CN/compiled-messages.json` only after the new validator suite is green. Remove `@fluent/syntax` if no remaining import uses it.

- [ ] **Step 6: 验证并提交**

```powershell
npm test
node src/cli.mjs language validate --pack packages/languages/zh-CN --catalog research/codex-0.144.1/tui-messages.jsonl
git diff --check
git add -A package.json package-lock.json src packages build test
git commit -m "feat: 迁移为直接 Fluent 语言包验证"
```

Expected: validator reports five wired messages and no compiled runtime JSON remains.

---

### Task 3: 拆分并增强现有事务适配器

**Interfaces:**
- Add: generic `planOperations`, `applyOperations`, `revertOperations`.
- Preserve through compatibility wrappers: `planCodexPatch`, `applyCodexPatch`, `revertCodexPatch`, and `doctorCodexPatch` until all callers migrate.

- [ ] **Step 1: 为现有安全行为建立迁移保护**

Keep all current `test/adapter.test.mjs` cases. Create `test/adapter-transaction.test.mjs` for read-only planning, whole-plan drift rejection, exact byte restore, create-target collision, backup failure cleanup, path escape rejection, and two sequential replacements of one path producing one file plan.

- [ ] **Step 2: 确认新模块 RED**

```powershell
node --test test/adapter-transaction.test.mjs
```

Expected: missing `src/adapter/transaction.mjs`.

- [ ] **Step 3: 提取通用事务引擎**

Move generic hashing, exact occurrence checks, backups, atomic writes and revert validation out of the existing adapter. Group operations by path and apply same-file replacements sequentially in memory. A `create` operation cannot share a path with another operation. State stays beneath the verified upstream root and all joins use repository-relative slash paths.

- [ ] **Step 4: 迁移 overlay 和适配器清单**

Move existing overlays under `adapters/codex/0.144.1/overlay/`, create `adapters/codex/0.144.1/manifest.json` with exact upstream/tag/commit, Ultra revision 1, i18n API 1 and catalog 1, and update the version adapter to read from that directory.

The adapter must expose `adapter plan|apply|revert` CLI routes. `plan` is read-only and prints touched paths and hashes.

- [ ] **Step 5: 验证现有与新测试**

```powershell
node --test test/adapter.test.mjs test/adapter-transaction.test.mjs
npm test
```

Expected: no regression in the seven existing transaction/path safety behaviors.

- [ ] **Step 6: 提交**

```powershell
git add -A src/adapter adapters test/adapter.test.mjs test/adapter-transaction.test.mjs src/cli.mjs
git commit -m "refactor: 拆分版本锁定事务适配器"
```

---

### Task 4: 把 JSON Translator 替换为 Rust Fluent Localizer

**Files:**
- Replace: `adapters/codex/0.144.1/overlay/i18n.rs`
- Modify through adapter: `codex-rs/Cargo.toml`, `codex-rs/tui/Cargo.toml`, `codex-rs/Cargo.lock`, `codex-rs/tui/src/lib.rs`, `codex-rs/cli/src/main.rs`.

**Interfaces:**
- `Localizer::english()`
- `Localizer::from_ftl(locale, source)`
- `Localizer::from_environment()`
- `Localizer::text(id, args, english_closure) -> String`
- `global()` and hidden `codex --ultra-i18n-self-check`.

- [ ] **Step 1: 创建两个全新 detached worktree**

```powershell
$projectRoot = (git rev-parse --show-toplevel).Trim()
$upstream = (Resolve-Path $env:CODEX_UPSTREAM_SOURCE).Path
if ((git -C $upstream rev-parse HEAD) -ne '44918ea10c0f99151c6710411b4322c2f5c96bea') { throw 'Pinned upstream commit required.' }
$redWorktree = Join-Path $env:TEMP ("codex-ultra-fluent-red-{0}" -f [guid]::NewGuid().ToString('N'))
$worktree = Join-Path $env:TEMP ("codex-ultra-fluent-green-{0}" -f [guid]::NewGuid().ToString('N'))
git -C $upstream worktree add --detach $redWorktree 44918ea10c0f99151c6710411b4322c2f5c96bea
git -C $upstream worktree add --detach $worktree 44918ea10c0f99151c6710411b4322c2f5c96bea
```

- [ ] **Step 2: 写 Rust RED 测试**

Required tests: static translation, `{duration}` formatting, missing key, empty value, malformed whole resource, missing Fluent argument, invalid locale, and self-check JSON containing translated history plus English fallback for an absent key.

- [ ] **Step 3: 实现 Localizer**

Use `fluent_bundle::concurrent::FluentBundle`, `FluentResource`, `FluentArgs`, `unic_langid::LanguageIdentifier`, and `OnceLock`. Any locale/resource/add-resource failure returns `Localizer::english()`. `text` converts logical dots to FTL double hyphens, collects format errors, and calls the `FnOnce` English closure on missing/invalid/empty output.

Self-check JSON schema:

```json
{
  "schemaVersion": 1,
  "active": true,
  "locale": "zh-CN",
  "messages": {
    "tui.status-line.setup.configure-title": "配置状态栏",
    "tui.history.worked-for": "加班了 7m 57s"
  }
}
```

The actual probe includes all five wired messages. `codex-rs/tui/src/lib.rs` exports only `ultra_i18n_self_check_json()`. `codex-rs/cli/src/main.rs` intercepts exactly one hidden argument before Clap and prints the JSON.

- [ ] **Step 4: 添加精确依赖操作**

Add workspace `fluent-bundle = "0.15.3"` and `unic-langid = "0.9.6"`, then `codex-tui` workspace dependencies. The complete normalized `codex-tui` Cargo.lock package block must hash to `sha256:dec3736f9d5fb1b72a09bfc8583c9d265c1a50275e1e4eae4655532bea9b9a9a` before adding `fluent-bundle` and `unic-langid`; mismatch is a hard failure.

- [ ] **Step 5: 应用适配器并验证二进制探针**

```powershell
Set-Location $projectRoot
node src/cli.mjs adapter apply --source $worktree
Set-Location "$worktree\codex-rs"
cargo test -p codex-tui i18n::tests
cargo check -p codex-tui --locked
$env:CODEX_ULTRA_LOCALE = 'zh-CN'
$env:CODEX_ULTRA_FTL_PATH = (Resolve-Path (Join-Path $projectRoot 'packages\languages\zh-CN\messages.ftl')).Path
$zh = cargo run -p codex-cli --locked -- --ultra-i18n-self-check | ConvertFrom-Json
if ($zh.messages.'tui.history.worked-for' -ne '加班了 7m 57s') { throw 'Chinese probe failed.' }
$env:CODEX_ULTRA_FTL_PATH = Join-Path $env:TEMP 'missing-ultra-language.ftl'
$en = cargo run -p codex-cli --locked -- --ultra-i18n-self-check | ConvertFrom-Json
if ($en.messages.'tui.history.worked-for' -ne 'Worked for 7m 57s') { throw 'English probe failed.' }
```

- [ ] **Step 6: 提交**

```powershell
Set-Location $projectRoot
npm test
git add adapters/codex/0.144.1 src/adapter src/cli.mjs test
git commit -m "feat: 添加 Rust Fluent i18n 运行时"
```

---

### Task 5: 接入状态栏和 `加班了 {duration}`

**Interfaces:**
- Add private injectable `StatusLineSetupView::new_with_localizer`.
- Add `FinalMessageSeparator::label_parts_with_localizer`.
- Preserve official constructors/methods as wrappers using `crate::i18n::global()`.

- [ ] **Step 1: 写状态栏三档中文快照 RED**

Use existing test helpers exactly: `unbounded_channel::<AppEvent>()`, `AppEventSender::new(tx_raw)`, `StatusSurfacePreviewData::default()`, `RuntimeKeymap::defaults().list`, and `render_lines`.

One test renders widths 32, 72 and 120 with names `status_line_setup_zh_cn_narrow`, `medium`, and `wide`. The existing English snapshot `setup_view_snapshot_uses_runtime_preview_values` must remain accepted unchanged.

- [ ] **Step 2: 注入四条状态栏消息**

Keep `StatusLineSetupView::new` signature unchanged and delegate to `new_with_localizer`. Replace only the four approved English call sites with `localizer.text(..., || original.to_string())`.

- [ ] **Step 3: 写 Worked for RED 测试并重构**

```rust
let separator = FinalMessageSeparator::new(Some(477), None);
assert_eq!(
    separator.label_parts_with_localizer(&localizer),
    vec!["加班了 7m 57s".to_string()]
);
```

Both `display_lines` and `raw_lines` call the shared helper. Preserve the existing `> 60` threshold, compact duration formatter, metrics order, width truncation and raw output.

- [ ] **Step 4: 把已验证 Rust diff 编码为精确 adapter operations**

Use complete original code blocks with `expectedOccurrences: 1`, not fuzzy individual string substitutions. Copy the three accepted snapshot bytes under `adapters/codex/0.144.1/overlay/snapshots/` and create them through adapter operations. Tests compare overlay and planned snapshot hashes.

- [ ] **Step 5: 从新 worktree 重放并验证**

```powershell
$replay = Join-Path $env:TEMP ("codex-ultra-tui-replay-{0}" -f [guid]::NewGuid().ToString('N'))
git -C $upstream worktree add --detach $replay 44918ea10c0f99151c6710411b4322c2f5c96bea
Set-Location $projectRoot
node src/cli.mjs adapter apply --source $replay
Set-Location "$replay\codex-rs"
cargo test -p codex-tui i18n::tests
cargo test -p codex-tui setup_view_snapshot_uses_zh_cn_localizer
cargo test -p codex-tui setup_view_snapshot_uses_runtime_preview_values
cargo test -p codex-tui worked_for_uses_zh_cn_localizer
cargo test -p codex-tui history_cell
```

- [ ] **Step 6: 提交**

```powershell
Set-Location $projectRoot
npm test
git diff --check
git add adapters/codex/0.144.1 src/adapter test
git commit -m "feat: 接入状态栏与工作时长翻译"
```

---

### Task 6: 完成运行时验证、体积证据和文档迁移

**Files:**
- Create: `scripts/test-i18n-runtime.ps1`, `scripts/measure-i18n-size.ps1`, `research/codex-0.144.1/i18n-size.json`, `docs/i18n/runtime-mvp.md`.
- Modify: `scripts/codex-ultra.ps1`, `docs/i18n/mvp-usage.md`, `README.md`.

- [ ] **Step 1: 重写 smoke script**

`scripts/test-i18n-runtime.ps1 -SourceWorktree PATH` runs language validation, Rust unit tests, three CJK snapshots, unchanged English snapshot, Worked for test, `cargo check --locked`, valid-FLT binary self-check and missing-FTL English self-check. Remove every compiled JSON and `CODEX_ULTRA_CATALOG` reference from the legacy PowerShell entry and usage guide.

- [ ] **Step 2: 测量相同 release profile 体积**

Create two new detached worktrees from the same commit, apply the adapter only to one, and run in each:

```powershell
cargo build -p codex-cli --release --locked
```

Require Cargo 1.95.0. Write `research/codex-0.144.1/i18n-size.json` with schema, commit, profile, cargo version, baseline bytes, patched bytes, delta bytes and delta percent. This is evidence, not a hard ceiling; Plan 3 measures final packaged bytes again.

- [ ] **Step 3: 更新文档**

Document the direct external FTL flow, hidden self-check, exact supported version, five wired/eleven catalogued counts, English fallback, same-profile size result, and the fact that the global installed `codex` command belongs to Plans 2-3.

- [ ] **Step 4: 完整验证**

```powershell
Set-Location $projectRoot
npm test
node src/cli.mjs catalog extract --source $env:CODEX_UPSTREAM_SOURCE
git diff --exit-code -- research/codex-0.144.1/tui-messages.jsonl docs/i18n/codex-0.144.1-text-inventory.md
node src/cli.mjs language validate --pack packages/languages/zh-CN --catalog research/codex-0.144.1/tui-messages.jsonl
pwsh -NoProfile -File scripts/test-i18n-runtime.ps1 -SourceWorktree $replay
git diff --check
```

- [ ] **Step 5: 提交**

```powershell
git add scripts docs/i18n README.md research/codex-0.144.1/i18n-size.json
git commit -m "feat: 完成 Rust i18n 运行时验证"
```

---

### Task 7: Plan 1 最终审查

- [ ] `npm test` has zero failures.
- [ ] A fresh pinned worktree accepts the adapter and all focused Rust tests.
- [ ] Catalog regeneration is deterministic at 11 records, with 5 wired and 6 catalogued.
- [ ] No compiled JSON runtime or `CODEX_ULTRA_CATALOG` reference remains.
- [ ] Language pack executes no code and invalid FTL reaches compiled English.
- [ ] The old seven adapter safety behaviors remain covered.
- [ ] Existing official English snapshot remains unchanged.
- [ ] Random phrase selection remains outside the MVP.
- [ ] `git diff --check` is clean.
- [ ] Use `requesting-code-review`; fix Critical and Important findings and re-review before Plan 2 begins.
