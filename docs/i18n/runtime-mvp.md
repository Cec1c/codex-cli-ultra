# Rust i18n 运行时 MVP / Rust i18n Runtime MVP

## 1. 范围 / Scope

本运行时只支持 Codex CLI `0.144.4`、标签 `rust-v0.144.4`、提交 `8c68d4c87dc54d38861f5114e920c3de2efa5876`。完整上游源码不进入本仓库；本项目只维护声明式语言包、Rust overlay、精确适配操作和验证证据。

This runtime supports only Codex CLI `0.144.4`, tag `rust-v0.144.4`, commit `8c68d4c87dc54d38861f5114e920c3de2efa5876`. The full upstream source is not stored in this repository; the project maintains only declarative language packs, Rust overlays, exact adapter operations, and validation evidence.

当前上游消息目录共 129 条，已经全部接入运行时：原有 104 条，再加上启动会话卡片、提示、MCP 前缀、用量网址提示、输入占位文本、Context/Token 状态和未知命令错误共 25 条。Ultra 另外提供 `/language` 命令说明和 4 条语言选择提示。

The upstream catalog contains 129 messages, all wired into the runtime: the previous 104-message scope plus 25 session-card, tooltip, MCP-prefix, usage-note, composer-placeholder, Context/Token, and unknown-command strings. Ultra additionally provides the `/language` description and four language-selection messages.

## 2. 数据流 / Data Flow

```text
manifest.json + messages.ftl
        │
        ├─ JavaScript 严格预检 / strict JavaScript preflight
        │    manifest, hashes, keys, arguments, fallback locales
        │
        └─ Rust Localizer 直接加载 FTL / Rust Localizer loads FTL directly
             CODEX_ULTRA_LOCALE
             CODEX_ULTRA_FTL_PATH
                    │
                    ├─ 成功 / success → localized String
                    └─ 失败 / failure → call-site English closure
```

语言包只包含数据，不执行代码、hook 或安装逻辑。JavaScript 验证通过并不取代 Rust 回退；运行时仍将外部文件视为不可信输入。

Language packs contain data only and execute no code, hooks, or installation logic. JavaScript validation does not replace Rust fallback; the runtime still treats external files as untrusted input.

## 3. 已接入消息 / Wired Messages

| 消息 ID / Message ID | zh-CN |
| --- | --- |
| `tui.status-line.setup.use-theme-colors` | 使用主题颜色 |
| `tui.status-line.setup.apply-theme-colors` | 应用当前 `/theme` 的颜色 |
| `tui.status-line.setup.configure-title` | 配置状态栏 |
| `tui.status-line.setup.select-items-description` | 选择要显示在状态栏中的项目。 |
| `tui.history.worked-for` | 工作了 `{ $duration }` |
| `tui.slash-command.description.model` | 选择模型和推理强度 |
| `tui.slash-command.description.status` | 显示当前会话配置和令牌用量 |
| `tui.slash-command.description.permissions` | 选择允许 Codex 执行的操作 |

`Worked for` 只在原有 `> 60` 秒条件满足时显示，继续使用上游紧凑时长格式。随机短语不属于本 MVP。

`Worked for` is shown only when the existing `> 60` second condition is met and keeps the upstream compact duration formatter. Random phrases are outside this MVP.

## 4. 英文回退 / English Fallback

| 故障 / Failure | 行为 / Behavior |
| --- | --- |
| locale 无效、FTL 缺失或无法读取 | 本次进程完整使用英文 / English for the whole process |
| FTL 语法损坏或资源无法加入 bundle | 本次进程完整使用英文 / English for the whole process |
| 单个键缺失 | 只回退该条调用点英文 / Call-site English for that message only |
| Fluent 参数缺失或格式化错误 | 只回退该条调用点英文 / Call-site English for that message only |
| 格式化结果为空或仅空白 | 只回退该条调用点英文 / Call-site English for that message only |

回退不会返回消息 ID、半格式化模板或空字符串，也不会改变官方英文调用点和样式。

Fallback never returns a message ID, partially formatted template, or empty string, and does not change official English call sites or styles.

## 5. 隐藏二进制自检 / Hidden Binary Self-Check

补丁二进制在 Clap 解析前拦截唯一参数：

The patched binary intercepts this exact single argument before Clap parsing:

```text
codex --ultra-i18n-self-check
```

有效 zh-CN FTL 的结果包含 130 条可翻译消息（129 条上游目录消息和 `/language` 说明），以及一条用于证明单键英文回退的缺键探针：

With valid zh-CN FTL, the result contains 130 localizable messages (129 upstream catalog messages plus the `/language` description) and one missing-key probe proving per-message English fallback:

```json
{
  "schemaVersion": 1,
  "active": true,
  "locale": "zh-CN",
  "messages": {
    "tui.status-line.setup.configure-title": "配置状态栏",
    "tui.slash-command.description.model": "选择模型和推理强度",
    "tui.history.worked-for": "工作了 7m 57s",
    "ultra.i18n.missing-key": "English fallback"
  }
}
```

FTL 缺失或无法加载时，`active` 为 `false`、`locale` 为 `null`，全部 130 条消息返回原始英文。

When FTL is missing or cannot load, `active` is `false`, `locale` is `null`, and all 130 messages return original English.

## 6. 可重复验证 / Reproducible Verification

统一入口：

Unified entry point:

```powershell
pwsh -NoProfile -File scripts/test-i18n-runtime.ps1 `
  -SourceWorktree PATH
```

脚本固定检查 Cargo 1.95.0、上游提交、已应用适配器和语言包，然后运行：

The script verifies Cargo 1.95.0, the upstream commit, the applied adapter, and the language pack before running:

- 10 条 Rust Localizer 测试。
- 5 条 slash command 聚焦测试和 15 条命令面板测试。
- 窄、中、宽三档 zh-CN 状态栏快照。
- 未修改的官方英文状态栏快照。
- `Worked for` 参数化翻译测试。
- locked Cargo 检查。
- 有效 FTL 中文二进制自检。
- 缺失 FTL 英文二进制自检。

- Ten Rust Localizer tests.
- Five focused slash-command tests and 15 command-popup tests.
- Narrow, medium, and wide zh-CN status-line snapshots.
- The unchanged official English status-line snapshot.
- Parameterized `Worked for` translation test.
- Locked Cargo check.
- Valid-FTL Chinese binary self-check.
- Missing-FTL English binary self-check.

0.144.4 聚焦验证结果为：i18n `10/10`、斜杠命令 `5/5`、命令面板 `15/15`、审批 `34/34`、MCP `17/17`、启动卡片 `4 passed / 1 ignored`。唯一 ignored 测试是上游已标注的 Windows 路径渲染差异。

Focused 0.144.4 validation passed i18n `10/10`, slash commands `5/5`, command popup `15/15`, approvals `34/34`, MCP `17/17`, and session cards `4 passed / 1 ignored`. The only ignored test is the upstream-marked Windows path-rendering difference.

## 7. 同 Profile 体积证据 / Same-Profile Size Evidence

此前 0.144.1 的体积测量仍作为历史证据保留；0.144.4 本轮只重新验证 Debug 构建和可见演示，尚未重新执行成对的 release 体积测量。

The previous 0.144.1 size measurement remains as historical evidence. This 0.144.4 pass revalidated the Debug build and visible demo only; paired release-size measurement has not yet been rerun.

历史机器可读结果记录于 `research/codex-0.144.1/i18n-size.json`。它不应被解释为 0.144.4 的体积数据。

Historical machine-readable results are stored in `research/codex-0.144.1/i18n-size.json`; they must not be interpreted as 0.144.4 size data.

| 项目 / Item | 字节 / Bytes |
| --- | ---: |
| 官方基线 / Baseline | 344,187,904 |
| i18n 补丁 / Patched | 344,224,256 |
| 增量 / Delta | 36,352 |

增量比例为 `0.010562%`。

The measured delta is `0.010562%`.

## 8. 当前交付边界 / Current Delivery Boundary

本阶段仍需要本地源码工作树和 Rust 工具链。普通已安装的全局 `codex` 命令不会被修改；并排启动器、官方二进制回退、PATH、更新、卸载和预编译 Windows x64 Release 分别属于计划 2 和计划 3。

This stage still requires a local source worktree and Rust toolchain. The normally installed global `codex` command is not modified; the side-by-side launcher, official-binary fallback, PATH, update, removal, and precompiled Windows x64 Release belong to Plans 2 and 3.
