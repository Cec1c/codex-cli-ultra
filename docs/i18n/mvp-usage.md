# i18n MVP 使用说明 / i18n MVP Usage

> **实验状态：** 本流程只支持 Codex CLI 0.144.1，对应上游提交 `44918ea10c0f99151c6710411b4322c2f5c96bea`。它用于验证可行性，不是稳定安装器。
>
> **Experimental status:** This workflow supports only Codex CLI 0.144.1 at upstream commit `44918ea10c0f99151c6710411b4322c2f5c96bea`. It proves feasibility and is not a stable installer.

## 1. 已验证内容 / What Is Proven

- 从真实 Codex TUI 源码提取 10 条文本，并生成稳定 JSONL 与 Markdown 目录。

  Extract 10 messages from real Codex TUI source and generate deterministic JSONL and Markdown inventories.

- 将 4 条状态栏设置文本从 zh-CN FTL 编译为运行时 JSON。

  Compile four zh-CN status-line setup messages from FTL into runtime JSON.

- 通过精确版本与源码锚点预检，事务式更新 5 个上游文件，并支持安全回滚。

  Preflight the exact version and source anchors, transactionally update five upstream files, and support safe rollback.

- 在目录未配置、文件不可读、JSON 损坏、消息缺失或翻译为空时保留原有英文。

  Preserve the original English when the catalog is not configured, unreadable, malformed, missing a message, or contains an empty translation.

## 2. 环境要求 / Requirements

- Windows 11 与 PowerShell 7。

  Windows 11 and PowerShell 7.

- Node.js 20 或更高版本，以及 npm。

  Node.js 20 or newer, plus npm.

- Git，以及包含 `rust-v0.144.1` 标签的 `openai/codex` 源码仓库。

  Git and an `openai/codex` source repository containing the `rust-v0.144.1` tag.

- 运行 Rust 验证时需要对应工具链、`just` 和 `cargo-insta`。

  Rust validation also requires the matching toolchain, `just`, and `cargo-insta`.

在 Codex CLI Ultra 仓库根目录安装 JavaScript 依赖：

Install JavaScript dependencies from the Codex CLI Ultra repository root:

```powershell
npm install
```

## 3. 创建隔离的 Codex 工作树 / Create an Isolated Codex Worktree

不要直接修改日常使用的 Codex 源码目录。以下变量只是示例，请换成自己的路径：

Do not modify a Codex source checkout used for daily work. The following variables are examples; replace them with your own paths:

```powershell
$CodexRepo = "D:\src\codex"
$CodexWorktree = Join-Path $env:TEMP "codex-ultra-rust-v0.144.1"

git -C $CodexRepo worktree add --detach $CodexWorktree rust-v0.144.1
git -C $CodexWorktree status --short
git -C $CodexWorktree rev-parse HEAD
```

`status --short` 应无输出，提交必须为 `44918ea10c0f99151c6710411b4322c2f5c96bea`。

`status --short` should print nothing, and HEAD must be `44918ea10c0f99151c6710411b4322c2f5c96bea`.

## 4. 提取文本并编译语言包 / Extract Messages and Compile the Pack

```powershell
pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Extract `
  -CodexSource $CodexWorktree

pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Compile
```

编译产物位于 `build/languages/zh-CN/compiled-messages.json`，当前应包含 4 条消息。

The compiled artifact is written to `build/languages/zh-CN/compiled-messages.json` and currently contains four messages.

## 5. 应用与诊断适配器 / Apply and Diagnose the Adapter

```powershell
pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Apply `
  -CodexSource $CodexWorktree

pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Doctor `
  -CodexSource $CodexWorktree
```

Doctor 应报告 `supported: true`、`applied: true`、`locale: zh-CN` 和 `compiledMessages: 4`。源码漂移、错误提交或非干净工作树会在写入前停止。

Doctor should report `supported: true`, `applied: true`, `locale: zh-CN`, and `compiledMessages: 4`. Source drift, a different commit, or a dirty worktree stops the operation before any write.

## 6. 运行 Rust 验证 / Run Rust Validation

```powershell
Push-Location (Join-Path $CodexWorktree "codex-rs")
try {
  just test -p codex-tui i18n
  just test -p codex-tui setup_view_snapshot_uses_zh_cn_catalog
}
finally {
  Pop-Location
}
```

第一条命令验证 6 个加载与英文回退场景；第二条命令验证中文标题、说明和主题颜色选项的 TUI 快照。

The first command validates six loading and English-fallback scenarios. The second validates a TUI snapshot containing the Chinese title, description, and theme-color option.

### Windows 上游基线说明 / Windows Upstream Baseline Note

在 `rust-v0.144.1` 发布标签上运行完整 `just test -p codex-tui` 时，本机验证观察到 23 个与本补丁无关的既有失败：20 个快照期望 `v0.0.0`、实际构建显示 `v0.144.1`，另有 3 个 Windows 用户目录路径缩写断言失败。回滚适配器后代表测试仍以相同差异失败，因此 MVP 以以上两条聚焦测试为验收入口，不接受这些无关快照。

On the `rust-v0.144.1` release tag, a full `just test -p codex-tui` run produced 23 pre-existing failures unrelated to this patch: 20 snapshots expect `v0.0.0` while the release build renders `v0.144.1`, and three Windows home-path abbreviation assertions fail. Representative failures remain identical after reverting the adapter, so the two focused commands above are the MVP acceptance path; the unrelated snapshots are not accepted.

## 7. 构建并启动测试版本 / Build and Launch the Test Binary

```powershell
Push-Location (Join-Path $CodexWorktree "codex-rs")
try {
  cargo build -p codex-cli --bin codex
}
finally {
  Pop-Location
}

$CodexBinary = Join-Path $CodexWorktree "codex-rs\target\debug\codex.exe"

pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Launch `
  -CodexBinary $CodexBinary
```

Launch 只向新建的 Codex 子进程注入 `CODEX_ULTRA_CATALOG`，不写入机器级环境变量、PATH、代理或语言设置。

Launch injects `CODEX_ULTRA_CATALOG` only into the new Codex child process. It does not change machine-wide environment variables, PATH, proxy, or locale settings.

## 8. 验证英文回退 / Verify English Fallback

不设置目录环境变量直接运行补丁二进制，状态栏设置界面应继续显示官方英文：

Run the patched binary directly without the catalog environment variable; the status-line setup should remain in official English:

```powershell
& $CodexBinary
```

也可以把损坏 JSON 只传给一次启动，运行时仍应使用英文且不 panic：

You can also pass malformed JSON to one launch only; the runtime should still use English without panicking:

```powershell
$BrokenCatalog = Join-Path $env:TEMP "codex-ultra-broken-catalog.json"
Set-Content -LiteralPath $BrokenCatalog -Value "{" -NoNewline -Encoding utf8

pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Launch `
  -CodexBinary $CodexBinary `
  -Catalog $BrokenCatalog

Remove-Item -LiteralPath $BrokenCatalog
```

## 9. 回滚 / Revert

```powershell
pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Revert `
  -CodexSource $CodexWorktree
```

回滚前会核对已安装文件哈希。若补丁文件在安装后又被手工修改，回滚会停止，不会覆盖未知改动。

Revert verifies the installed file hashes first. If a patched file was edited after installation, rollback stops instead of overwriting unknown changes.

## 10. 当前限制 / Current Limitations

- 只支持精确的 Codex CLI 0.144.1 提交，并且需要源码构建。

  Only the exact Codex CLI 0.144.1 commit is supported, and a source build is required.

- 只有 4 条状态栏设置文本接入运行时；其余 6 条登录文本只完成目录整理。

  Only four status-line setup messages are wired at runtime; the other six login messages are catalogued only.

- 运行时每个进程只加载一次目录；更新语言包后需要重启 Codex。

  Each process loads the catalog once; restart Codex after updating a language pack.

- 这不是官方插件或市场包，尚未提供稳定的一键安装与签名发布流程。

  This is not an official plugin or marketplace package, and no stable one-command signed release flow exists yet.
