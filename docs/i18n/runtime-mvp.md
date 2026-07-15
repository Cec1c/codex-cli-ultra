# Rust i18n 运行时 MVP / Rust i18n Runtime MVP

## 1. 范围 / Scope

本运行时只支持 Codex CLI `0.144.1`、标签 `rust-v0.144.1`、提交 `44918ea10c0f99151c6710411b4322c2f5c96bea`。完整上游源码不进入本仓库；本项目只维护声明式语言包、Rust overlay、精确适配操作和验证证据。

This runtime supports only Codex CLI `0.144.1`, tag `rust-v0.144.1`, commit `44918ea10c0f99151c6710411b4322c2f5c96bea`. The full upstream source is not stored in this repository; the project maintains only declarative language packs, Rust overlays, exact adapter operations, and validation evidence.

当前消息目录共 11 条，其中 5 条已接入运行时、6 条 onboarding 消息只完成目录整理。

The current catalog contains 11 messages: five wired into the runtime and six onboarding messages catalogued only.

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
| `tui.history.worked-for` | 加班了 `{ $duration }` |

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

有效 zh-CN FTL 的结果包含五条中文消息，以及一条用于证明单键英文回退的缺键探针：

With valid zh-CN FTL, the result contains all five Chinese messages and one missing-key probe proving per-message English fallback:

```json
{
  "schemaVersion": 1,
  "active": true,
  "locale": "zh-CN",
  "messages": {
    "tui.status-line.setup.configure-title": "配置状态栏",
    "tui.history.worked-for": "加班了 7m 57s",
    "ultra.i18n.missing-key": "English fallback"
  }
}
```

FTL 缺失或无法加载时，`active` 为 `false`、`locale` 为 `null`，五条消息全部返回原始英文。

When FTL is missing or cannot load, `active` is `false`, `locale` is `null`, and all five messages return original English.

## 6. 可重复验证 / Reproducible Verification

统一入口：

Unified entry point:

```powershell
pwsh -NoProfile -File scripts/test-i18n-runtime.ps1 `
  -SourceWorktree PATH
```

脚本固定检查 Cargo 1.95.0、上游提交、已应用适配器和语言包，然后运行：

The script verifies Cargo 1.95.0, the upstream commit, the applied adapter, and the language pack before running:

- 9 条 Rust Localizer 测试。
- 窄、中、宽三档 zh-CN 状态栏快照。
- 未修改的官方英文状态栏快照。
- `Worked for` 参数化翻译测试。
- locked Cargo 检查。
- 有效 FTL 中文二进制自检。
- 缺失 FTL 英文二进制自检。

- Nine Rust Localizer tests.
- Narrow, medium, and wide zh-CN status-line snapshots.
- The unchanged official English status-line snapshot.
- Parameterized `Worked for` translation test.
- Locked Cargo check.
- Valid-FTL Chinese binary self-check.
- Missing-FTL English binary self-check.

扩展的 `history_cell` 审计结果为 125 passed、3 failed、2 ignored。三条失败是 `pnpm_update_available_history_cell_snapshot`、`standalone_unix_update_available_history_cell_snapshot` 和 `standalone_windows_update_available_history_cell_snapshot`：上游快照仍期望 `0.0.0`，而发布源码构建显示 `0.144.1`。它们不涉及本地化调用点，不被接受或重写，也不计入运行时 smoke 的全绿声明。

The broader `history_cell` audit produced 125 passed, three failed, and two ignored tests. The failures are `pnpm_update_available_history_cell_snapshot`, `standalone_unix_update_available_history_cell_snapshot`, and `standalone_windows_update_available_history_cell_snapshot`: the upstream snapshots still expect `0.0.0`, while the release-source build renders `0.144.1`. They do not involve localization call sites, are neither accepted nor rewritten, and are excluded from claims that the runtime smoke is fully green.

## 7. 同 Profile 体积证据 / Same-Profile Size Evidence

体积测量使用同一固定提交、Cargo 1.95.0 和 `release --locked` profile。baseline 与 patched 两边执行相同的固定上游 Cargo.lock workspace 版本归一化（132 个 workspace 包从 `0.0.0` 对齐为 `0.144.1`），只有 patched 工作树应用 i18n 适配器。两组 worktree 和 target 使用等长绝对路径，构建环境拒绝自定义 Rust 编译器、flags、wrapper 和 release profile 覆盖。

Size measurement uses the same pinned commit, Cargo 1.95.0, and `release --locked` profile. Baseline and patched builds receive the same pinned-upstream Cargo.lock workspace-version normalization (132 workspace packages aligned from `0.0.0` to `0.144.1`); only the patched worktree receives the i18n adapter. Both worktree and target pairs use equal-length absolute paths, while the build environment rejects custom Rust compilers, flags, wrappers, and release-profile overrides.

机器可读结果记录于 `research/codex-0.144.1/i18n-size.json`。体积增量是设计证据而不是当前硬性上限；计划 3 会再次测量完整发布包。

Machine-readable results are stored in `research/codex-0.144.1/i18n-size.json`. The size delta is design evidence rather than a hard ceiling; Plan 3 measures the complete release package again.

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
