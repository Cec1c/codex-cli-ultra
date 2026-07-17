# Codex CLI i18n 演示 MVP

## 目标

本阶段只证明三件事：Codex TUI 可以加载声明式 Fluent 语言包；常用可见文本可以安全翻译并逐条回退英文；用户可以在 TUI 中通过 `/language` 查看或选择语言。

这不是完整中文化，也不声称与更新版官方 Codex 功能对齐。

## 当前演示范围

- 129 条上游真实 TUI 文本已经接入：此前 104 条，以及启动会话卡片、提示、MCP 前缀、用量网址提示、11 条输入占位文本、Context/Token 状态和未知命令错误共 25 条。
- Ultra 另外提供 `/language` 说明和 4 条语言选择提示，FTL 中合计 134 个可翻译键。
- `/language` 显示当前语言和用法。
- `/language zh-CN`、`/language en` 保存选择，重启后生效。
- FTL 缺失、损坏或单条消息格式失败时保留编译进二进制的英文。
- 官方 Codex 版本变化时，完整性正常的 Ultra 可以以 `optimistic coexistence` 状态继续运行，但明确不宣称功能对齐。

## 可复现验证

```powershell
node src/cli.mjs language validate `
  --pack packages/languages/zh-CN `
  --catalog research/codex-0.144.4/tui-messages.jsonl

node src/cli.mjs adapter plan --source $env:CODEX_UPSTREAM_SOURCE
node src/cli.mjs adapter apply --source $env:CODEX_UPSTREAM_SOURCE
```

在应用适配器后的 `codex-rs` 中运行：

```powershell
just fmt
just test -p codex-tui i18n::tests
just test -p codex-tui slash_command::tests
cargo build -p codex-cli --locked
```

设置 `CODEX_ULTRA_LOCALE=zh-CN` 与 `CODEX_ULTRA_FTL_PATH` 后，隐藏自检输出 130 条可翻译消息；资源缺失时，同一探针返回相同 130 条原始英文。

构建完成后可直接启动交互演示：

```powershell
$CodexBinary = Join-Path $env:CODEX_UPSTREAM_SOURCE "codex-rs\target\debug\codex.exe"
$PreferencePath = Join-Path $env:TEMP "codex-ultra-demo-language-preference.txt"

pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Launch `
  -CodexBinary $CodexBinary `
  -LanguagePreferencePath $PreferencePath
```

进入 TUI 后依次尝试 `/language`、`/language en`，重启后确认英文；再执行 `/language zh-CN` 并重启，确认中文恢复。MVP 明确采用重启生效，不伪装成热切换。

## 0.144.4 本机 GIF 演示

当前已验证二进制：

```text
D:\t\codex-ultra-mvp-01444\codex-rs\target\debug\codex.exe
```

为避免以前的语言偏好影响录制，使用新的偏好文件路径启动：

```powershell
pwsh -NoProfile -File scripts/codex-ultra.ps1 `
  -Action Launch `
  -CodexBinary D:\t\codex-ultra-mvp-01444\codex-rs\target\debug\codex.exe `
  -LanguagePreferencePath D:\t\codex-ultra-01444-language.txt
```

建议 GIF 依次展示：启动卡片和中文输入占位；输入 `/` 查看命令说明；运行 `/language`；运行 `/status`；输入不存在的 `/sdsd`；最后运行 `/language en`，重启后证明语言选择和英文回退路径。

## 上游沟通策略

`openai/codex` 当前只接受维护者邀请的外部 PR，未经邀请的 PR 会直接关闭。维护者也曾在 issue #26136 表示当时没有 TUI 本地化计划。因此本项目不会直接提交大型 PR。

合理路径是先在 CLI 专用的 issue #29309 中提供：

- 可运行演示和精确上游提交；
- 129 条上游目录消息、启动卡片/提示/输入框/状态条/错误提示中文效果和英文回退输出；
- `/language` UX；
- Fluent 依赖、改动文件和测试范围；
- 一个可拆分的小 PR 方案，并明确询问维护者是否愿意邀请贡献。

如果获得积极反馈，首个上游 PR 应只包含最小 i18n scaffold、语言选择入口和极少量代表性文本，不包含 Codex Ultra 的安装器、版本兼容层或外部发布系统。

用于准备该演示分支的个人 fork 已建立在 `https://github.com/Cec1c/codex`，Ultra 工作树中的 `.upstream/codex` 默认被忽略；在用户确认前不发布 Issue 或 PR。
