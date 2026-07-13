# i18n MVP 使用说明 / i18n MVP Usage

> **实验状态：** 本流程只支持 Codex CLI 0.144.1，对应上游提交 `44918ea10c0f99151c6710411b4322c2f5c96bea`。它用于验证源码适配、外部 FTL 和英文回退，不是稳定安装器。
>
> **Experimental status:** This workflow supports only Codex CLI 0.144.1 at upstream commit `44918ea10c0f99151c6710411b4322c2f5c96bea`. It validates source adaptation, external FTL, and English fallback; it is not a stable installer.

## 1. 已验证内容 / What Is Proven

- 从真实 Codex TUI 源码确定性提取 11 条消息：5 条已接入，6 条只完成目录整理。

  Deterministically extract 11 messages from real Codex TUI source: five wired and six catalogued only.

- JavaScript 严格校验声明式语言包的清单、哈希、FTL、消息键和参数。

  Strictly validate the declarative language-pack manifest, hashes, FTL, message keys, and arguments in JavaScript.

- Rust 运行时直接读取外部 FTL，翻译四条状态栏设置文本和 `Worked for {duration}`。

  Load external FTL directly in Rust and translate four status-line setup messages plus `Worked for {duration}`.

- 单条消息失败时只回退该条英文；区域、文件或整个 FTL 无法加载时，本次进程完整使用英文。

  Fall back only the affected message on per-message failure, or use English for the whole process when the locale, file, or FTL resource cannot load.

- 适配器校验精确提交、Cargo.lock 指纹和源码锚点，以事务方式应用并支持精确回滚。

  Verify the exact commit, Cargo.lock fingerprint, and source anchors before applying transactionally with exact rollback.

## 2. 环境要求 / Requirements

- Windows 11 与 PowerShell 7。
- Node.js 24 或更高版本，以及 npm。
- Git，以及包含固定提交的 `openai/codex` 源码仓库。
- 上游 `rust-toolchain.toml` 指定的 Rust/Cargo 1.95.0。

- Windows 11 and PowerShell 7.
- Node.js 24 or newer, plus npm.
- Git and an `openai/codex` source repository containing the pinned commit.
- Rust/Cargo 1.95.0 selected by the upstream `rust-toolchain.toml`.

在 Codex CLI Ultra 仓库根目录安装锁定的 JavaScript 依赖：

Install locked JavaScript dependencies from the Codex CLI Ultra repository root:

```powershell
npm ci
```

## 3. 创建隔离的上游工作树 / Create an Isolated Upstream Worktree

不要修改日常使用的 Codex 源码目录。以下路径只是示例：

Do not modify a Codex checkout used for daily work. These paths are examples:

```powershell
$CodexRepo = "D:\src\codex"
$CodexWorktree = Join-Path $env:TEMP ("codex-ultra-0.144.1-{0}" -f [guid]::NewGuid().ToString("N"))

git -C $CodexRepo worktree add --detach $CodexWorktree 44918ea10c0f99151c6710411b4322c2f5c96bea
git -C $CodexWorktree status --short
git -C $CodexWorktree rev-parse HEAD
```

`status --short` 必须无输出，HEAD 必须等于固定提交。

`status --short` must be empty, and HEAD must equal the pinned commit.

## 4. 生成目录并验证语言包 / Generate the Catalog and Validate the Pack

```powershell
pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Extract `
  -CodexSource $CodexWorktree

pwsh -NoProfile -File scripts/codex-ultra.ps1 -Action Validate
```

重复提取不得改变以下生成文件：

Repeated extraction must not change these generated files:

```text
research/codex-0.144.1/tui-messages.jsonl
docs/i18n/codex-0.144.1-text-inventory.md
```

语言包运行时资源是 `packages/languages/zh-CN/messages.ftl`，不再生成或加载 compiled JSON。

The runtime language resource is `packages/languages/zh-CN/messages.ftl`; no compiled JSON is generated or loaded.

## 5. 预检、应用与诊断 / Plan, Apply, and Diagnose

```powershell
pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Plan `
  -CodexSource $CodexWorktree

pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Apply `
  -CodexSource $CodexWorktree

pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Doctor `
  -CodexSource $CodexWorktree
```

错误提交、源码漂移、Cargo.lock 漂移、非干净工作树或不完整恢复状态都会在未知源码被覆盖前停止。

A wrong commit, source drift, Cargo.lock drift, dirty worktree, or incomplete recovery state stops before unknown source is overwritten.

## 6. 运行完整运行时验证 / Run the Runtime Verification

```powershell
pwsh -NoProfile -File scripts/test-i18n-runtime.ps1 `
  -SourceWorktree $CodexWorktree
```

该脚本验证：

The script verifies:

- zh-CN 语言包预检。
- Rust Localizer 单元测试。
- 窄、中、宽三档中文状态栏快照。
- 未改变的官方英文状态栏快照。
- `加班了 7m 57s` 参数化消息。
- locked Cargo 依赖图检查。
- 有效 FTL 的中文二进制自检。
- 缺失 FTL 时的完整英文二进制自检。

- zh-CN language-pack preflight.
- Rust Localizer unit tests.
- Narrow, medium, and wide Chinese status-line snapshots.
- The unchanged official English status-line snapshot.
- The parameterized `加班了 7m 57s` message.
- A locked Cargo dependency-graph check.
- Chinese binary self-check with valid FTL.
- Full English binary self-check with missing FTL.

隐藏自检只接受唯一参数：

The hidden self-check accepts exactly one argument:

```powershell
$PreviousLocale = [Environment]::GetEnvironmentVariable("CODEX_ULTRA_LOCALE", "Process")
$PreviousFtlPath = [Environment]::GetEnvironmentVariable("CODEX_ULTRA_FTL_PATH", "Process")
try {
  $env:CODEX_ULTRA_LOCALE = "zh-CN"
  $env:CODEX_ULTRA_FTL_PATH = (Resolve-Path "packages/languages/zh-CN/messages.ftl").Path

  Push-Location (Join-Path $CodexWorktree "codex-rs")
  try {
    cargo run -p codex-cli --locked -- --ultra-i18n-self-check
  }
  finally {
    Pop-Location
  }
}
finally {
  [Environment]::SetEnvironmentVariable("CODEX_ULTRA_LOCALE", $PreviousLocale, "Process")
  [Environment]::SetEnvironmentVariable("CODEX_ULTRA_FTL_PATH", $PreviousFtlPath, "Process")
}
```

输出 JSON 包含 schema、是否启用、实际 locale、五条已接入消息和一条缺键英文回退探针。

The JSON output includes the schema, active state, actual locale, all five wired messages, and one missing-key English-fallback probe.

### Windows 上游基线说明 / Windows Upstream Baseline Note

固定发布源码中的部分非本项目快照仍期望开发版本 `0.0.0`，而 release manifest 构建实际显示 `0.144.1`。当前 `history_cell` 聚焦回归中有三条 update-available 快照属于该差异；Ultra 不接受或重写这些无关快照，运行时 smoke 只执行与本适配相关且基线稳定的门禁。

Some unrelated snapshots in the pinned release source still expect development version `0.0.0`, while the release manifest build renders `0.144.1`. Three update-available snapshots in the focused `history_cell` regression have this mismatch. Ultra neither accepts nor rewrites those unrelated snapshots; the runtime smoke runs only adapter-relevant gates with a stable baseline.

## 7. 构建与启动测试版本 / Build and Launch a Test Binary

```powershell
Push-Location (Join-Path $CodexWorktree "codex-rs")
try {
  cargo build -p codex-cli --locked
}
finally {
  Pop-Location
}

$CodexBinary = Join-Path $CodexWorktree "codex-rs\target\debug\codex.exe"

pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Launch `
  -CodexBinary $CodexBinary
```

`Launch` 要求显式传入真实 `.exe` 文件路径。它先验证语言包，直接使用验证结果中的 locale，再只向新建子进程注入 `CODEX_ULTRA_LOCALE` 和 `CODEX_ULTRA_FTL_PATH`。验证 JSON 不会写入 Codex 的 stdout。它不修改机器级环境变量、PATH、代理、认证、会话或用户配置。

`Launch` requires an explicit real `.exe` file path. It validates the language pack, uses the locale from that validation result, and injects `CODEX_ULTRA_LOCALE` and `CODEX_ULTRA_FTL_PATH` only into the new child process. Validation JSON is not written to Codex stdout. It does not modify machine-level environment variables, PATH, proxy, authentication, sessions, or user configuration.

## 8. 验证英文回退 / Verify English Fallback

删除或指向不存在的 FTL 文件后运行隐藏自检，应返回 `active: false`、`locale: null` 和原始英文：

Point the runtime to a missing FTL file and run the hidden self-check. It must return `active: false`, `locale: null`, and original English:

```powershell
$PreviousLocale = [Environment]::GetEnvironmentVariable("CODEX_ULTRA_LOCALE", "Process")
$PreviousFtlPath = [Environment]::GetEnvironmentVariable("CODEX_ULTRA_FTL_PATH", "Process")
try {
  $env:CODEX_ULTRA_LOCALE = "zh-CN"
  $env:CODEX_ULTRA_FTL_PATH = Join-Path $env:TEMP ("missing-codex-ultra-{0}.ftl" -f [guid]::NewGuid().ToString("N"))

  Push-Location (Join-Path $CodexWorktree "codex-rs")
  try {
    cargo run -p codex-cli --locked -- --ultra-i18n-self-check
  }
  finally {
    Pop-Location
  }
}
finally {
  [Environment]::SetEnvironmentVariable("CODEX_ULTRA_LOCALE", $PreviousLocale, "Process")
  [Environment]::SetEnvironmentVariable("CODEX_ULTRA_FTL_PATH", $PreviousFtlPath, "Process")
}
```

## 9. 回滚 / Revert

```powershell
pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Revert `
  -CodexSource $CodexWorktree
```

回滚会验证适配状态、备份和当前文件哈希。若补丁文件随后被未知程序修改，回滚会停止而不是覆盖未知字节。

Revert validates adapter state, backups, and current file hashes. If patched files were later changed by an unknown process, rollback stops rather than overwriting unknown bytes.

## 10. 当前限制 / Current Limitations

- 只支持精确的 Codex CLI 0.144.1 提交，并且需要本地源码构建。
- 五条消息已接入：四条状态栏设置文本和一条工作时长消息；六条 onboarding 消息只完成目录整理。
- 每个进程只初始化一次 Localizer；修改 FTL 后需要重启 Codex。
- 随机 `Worked for` 短语不属于当前 MVP。
- 全局 `codex` 并排安装、官方自动回退、更新和卸载属于计划 2；预编译 Release 属于计划 3。

- Only the exact Codex CLI 0.144.1 commit is supported, and a local source build is required.
- Five messages are wired: four status-line setup messages and one worked-duration message; six onboarding messages are catalogued only.
- Each process initializes the Localizer once; restart Codex after changing FTL.
- Random `Worked for` phrases are outside the current MVP.
- Global side-by-side `codex` installation, official fallback, update, and removal belong to Plan 2; precompiled Releases belong to Plan 3.
