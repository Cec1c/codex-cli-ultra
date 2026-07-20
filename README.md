# Codex CLI Ultra

> **v0.1.3：** 这是一个非官方的 Windows x64 社区发行版。它提供内置 fork 二进制、1396 条简体中文 FTL、可选 Hermes 状态栏、后台管理任务、本地 Release 安装与一键卸载回退，同时保留 npm 安装的官方英文 Codex。
>
> **v0.1.3:** This unofficial Windows x64 community distribution bundles the verified fork binary, 1,396 Simplified Chinese FTL messages, an optional Hermes status line, background management tasks, local Release installation, and one-click fallback to the retained official npm Codex.

Codex CLI Ultra 通过职责分离的长期 fork 和轻量管理器，为 Codex CLI 探索可持续维护的本地化与界面扩展能力。

Codex CLI Ultra explores maintainable localization and interface extension capabilities through a responsibility-separated long-lived fork and a lightweight manager.

## 当前 MVP / Current MVP

当前发布候选基于 Codex CLI 0.144.6，显示版本为 `0.144.6-ccu.i18n.2`。简体中文 FTL 与英文模板已扩展为 1396 个实际使用键，覆盖 `/model`、`/fast`、`/feedback`、`/mention`、`@`、本地启动 Tips、命令列表与二级界面。状态栏的令牌分子使用当前上下文窗口，而不是 session 累计消耗；Hermes 状态栏只有在安装时明确选择后才启用。语言包缺失、损坏、缺键、变量不匹配或翻译为空时逐条回退到二进制内置英文。

The current release candidate is based on Codex CLI 0.144.6 and reports `0.144.6-ccu.i18n.2`. The Simplified Chinese FTL and English template contain 1,396 actively used messages, including `/model`, `/fast`, `/feedback`, `/mention`, `@`, local Tips, command lists, and secondary screens. Context-token status uses the current context window rather than session-total usage, and the Hermes status line is opt-in. Invalid or incomplete translations fall back per message to compiled English.

fork 每 6 小时检查一次上游稳定 Release，从对应 `rust-vX.Y.Z` tag 建立发布分支并重放 CCU 提交；冲突时创建告警 Issue 并停止。CCU 自动读取 fork Release channel、校验 manifest/大小/SHA256、事务安装并清理旧 CCU 版本。

The fork checks upstream stable Releases every six hours, creates a release branch from the matching `rust-vX.Y.Z` tag, and replays the CCU commits. Conflicts open an alert issue and stop the release. CCU follows the fork Release channel, validates the manifest, size, and SHA256, installs transactionally, and removes stale CCU versions.

实现与恢复检查点见 [进度记录](docs/PLAN2_PROGRESS.md)，自动发布契约见 [CCU、fork 与上游跟踪计划](docs/CCU_I18N_FORK_PLAN.md)，翻译流程见 [FTL 语言包模板](docs/i18n/language-pack-template.md)，已整理文本见 [Codex CLI 0.144.5 TUI 文本目录](docs/i18n/codex-0.144.5-text-inventory.md)。

See the [progress checkpoint](docs/PLAN2_PROGRESS.md), the [CCU/fork/upstream release plan](docs/CCU_I18N_FORK_PLAN.md), the [FTL language-pack template](docs/i18n/language-pack-template.md), and the [Codex CLI 0.144.5 TUI text inventory](docs/i18n/codex-0.144.5-text-inventory.md).

## 当前架构 / Current Architecture

- [`Cec1c/codex`](https://github.com/Cec1c/codex) 负责 Rust/TUI i18n 接口、`/language`、英文回退和编译后的 fork 二进制。
- 本仓库负责 FTL 语言包、官方版与 fork 共存、下载校验、安装更新、版本状态和后续界面预设。
- fork Release 使用 `ccu-rust-vX.Y.Z-rN`，二进制显示为 `X.Y.Z-ccu.i18n.N`；同一上游版本的 fork 修复只递增 `N`。
- GitHub Actions 每 6 小时轮询上游稳定 Release；冲突时停止并告警，不覆盖 fork 改动。
- 安装后只保留两份 Codex：官方 npm 英文版备份，以及一个当前运行中的 CCU Release；旧 CCU Release 自动清理。若 Windows 正由旧会话占用二进制，安装器不会终止进程，而是在会话自然退出后由隐藏清理器删除旧版。
- CCU shim 被写入用户 PATH，并排在官方 npm shim 前；因此新终端中的 `codex --yolo` 默认启动 CCU。
- 用户安装只需要编译后的二进制、管理器和内容包，不需要下载完整 Codex Rust 源码。

The Rust/TUI mechanism and compiled binaries live in `Cec1c/codex`; this repository manages FTL language packs, coexistence with official Codex, verified downloads, installation, updates, version status, and later UI presets. Users do not need the full Codex source tree. If Windows still has an old CCU binary open, the installer never kills that session; a hidden cleanup worker removes the stale release after it exits naturally.

## 安装与验证 / Install and verify

PowerShell 7 本地源码安装：

```powershell
cd D:\codex-cli-ultra
.\install.ps1
# 或完全离线使用已解压的 fork Release：
.\install.ps1 -ForkReleaseDir <解压后的-fork-Release-目录>
```

源码安装只构建 CCU 管理器；没有本地 `fork-release` 时会尝试读取 `Cec1c/codex` 最新稳定 Release。网络不可用时安装器会停止并引导下载完整的 CCU Release ZIP。受限网络环境优先使用下方自包含安装包。

从 GitHub Release 安装：下载 `codex-cli-ultra-v0.1.3-windows-x64.zip` 和同名 `.sha256`，核对 SHA256，解压后双击 `install.cmd`。ZIP 已内置 fork Release，不需要再次下载 Codex。安装器会说明每一步并询问是否启用 Hermes 四段式状态栏，默认不启用。

```powershell
codex-ultra version
codex-ultra status --check
codex --version
codex --yolo
ccu-manager
```

预期 `codex --version` 包含 `0.144.6-ccu.i18n.2`；`codex --yolo` 显示中文欢迎页和 `YOLO 模式`。若安装时选择 Hermes 状态栏，安装器会备份并更新 `~/.codex/config.toml` 中的状态栏字段；禁用或卸载时仅恢复仍由 CCU 管理的值。官方备份路径可由 `codex-ultra status --json` 查看。

The GitHub Release ZIP is self-contained. Verify the adjacent SHA256 file, extract it, and run `install.cmd`. A new terminal resolves `codex` to CCU, while `uninstall.cmd` removes CCU from PATH and returns `codex` to the retained official English build.

管理执行器提供：

```text
codex-ultra version
codex-ultra status --check
codex-ultra install
codex-ultra update
codex-ultra uninstall
codex-ultra content sync
ccu-manager
```

Rust 管理器有“状态/安装、语言包、主题包”三个页面。耗时操作在后台线程执行并显示任务进度，不再阻塞键盘和绘制循环。状态页同时显示 CCU 本体、CCU-I18N fork 与 OpenAI Codex 上游的本地/远端版本；`i` 从检测到的本地 fork Release 安装，`u` 在线更新 CCU-I18N，`x` 二次确认卸载，`c` 同步三路远端版本，`f` 原子同步 FTL 与主题。CCU 本体发现新版时前往 Release 下载完整包更新。

详细版本与自动发布契约见 [CCU、Codex i18n fork 与上游跟踪实施计划](docs/CCU_I18N_FORK_PLAN.md)。

自包含 Release 已把 fork 二进制、安装/卸载脚本、FTL 与管理器合并为单个 CCU 下载包，验收合同见 [CCU 自包含安装包合同](docs/CCU_BUNDLED_RELEASE_PLAN.md)。

The self-contained Release bundles the fork binary, installer/uninstaller, FTL content, and manager in one download; see the [self-contained release contract](docs/CCU_BUNDLED_RELEASE_PLAN.md).

## 两个长期方向 / Two Long-Term Directions

### 1. i18n 多语言框架 / i18n Language Framework

初期最优先的目标是验证并建立 i18n 框架，让界面文本从具体实现中解耦。语言包应当可以独立安装、更新、校验和回退，并由世界各地的贡献者分别维护。

The first priority is to validate and establish an i18n framework that decouples interface text from the implementation. Language packs should be independently installable, updatable, verifiable, and removable, so contributors around the world can maintain locales separately.

MVP 执行器与安装编排使用 JavaScript。语言包本身采用声明式资源格式，而不是要求每个翻译包执行任意代码。

The MVP executor and installation orchestration use JavaScript. Language packs use declarative resources instead of requiring every translation pack to execute arbitrary code.

### 2. 高度可定制的主题包框架 / Highly Customizable Theme Packs

主题包不会只停留在配色替换。长期设想包括布局、信息模块、图标、分隔符、密度、终端能力降级，以及其他具有完整主题特征的界面表达。

Theme packs are intended to go beyond color replacement. The long-term vision includes layouts, information modules, icons, separators, density, terminal-capability fallbacks, and other interface behaviors that form a complete theme.

主题方向的第一个落点是高度可定制的状态栏：允许主题作者组合状态片段、设置顺序与优先级、定义格式和样式，并在终端宽度不足时优雅降级。

The first theme milestone is a highly customizable status line: theme authors should be able to compose segments, control order and priority, define formatting and styles, and degrade gracefully when terminal width is limited.

内置 `ccu.hermes` 采用随机模型 emoji、Hermes 调色板、紧凑模型标签、10 格上下文进度和分段降级，完整形态示例为：`🦊 gpt-5.6-sol[xhigh] │ 42.7K/353K │ [█░░░░░░░░░] 9% │ ⏱ 1s ⚡0s │`。其中 `42.7K` 是当前上下文窗口已用令牌，不是 session 累计令牌；默认方案不显示余额。

The bundled `ccu.hermes` theme uses a random model emoji, a shuffled Hermes palette, compact model labels, a ten-cell context bar, and segment-level width fallbacks. Its default four-segment layout does not display account balances.

## 运行与分发入口 / Runtime and distribution entry points

v0.1.3 使用 PowerShell 7 安装/卸载器、Node.js 管理执行器和 Rust Ratatui 管理界面，优先支持 Windows 11。后续平台可以复用相同的 Release manifest、外部语言包和主题包合同。

v0.1.3 uses PowerShell 7 install/uninstall scripts, a Node.js management executor, and a Rust Ratatui manager, with Windows 11 as the first supported platform. Future platforms can reuse the same Release manifest, external language-pack, and theme-pack contracts.

部分适配设计会参考 [Codex 的开源代码](https://github.com/openai/codex)，用于理解现有字符串、TUI 渲染和配置入口。兼容层应保持轻量、可验证，并对 Codex 版本变化明确失败，而不是静默破坏用户安装。

Some adapter design will reference the [open-source Codex codebase](https://github.com/openai/codex) to understand existing strings, TUI rendering, and configuration entry points. Compatibility layers should remain thin, verifiable, and fail clearly on unsupported Codex versions instead of silently damaging an installation.

## 初期路线 / Early Roadmap

1. **验证 i18n 注入与兼容路径。** 找出可稳定识别的用户界面字符串、格式化参数和版本边界。

   **Validate i18n integration and compatibility paths.** Identify user-facing strings, formatting parameters, and version boundaries that can be recognized reliably.

2. **建立 JavaScript 执行器和语言包规范。** 支持包校验、版本匹配、英文回退、安装记录与安全回滚。

   **Establish the JavaScript executor and language-pack specification.** Support package validation, version matching, English fallback, installation records, and safe rollback.

3. **交付第一个可用语言包。** 以简体中文作为参考实现，同时保证规范不绑定某一种语言。

   **Deliver the first usable language pack.** Use Simplified Chinese as the reference implementation while keeping the specification language-agnostic.

4. **实现声明式状态栏主题 V1。** 先开放可控的数据片段、布局、图标、分隔符、格式和样式能力。

   **Implement declarative status-line themes V1.** Start with controlled data segments, layout, icons, separators, formatting, and styling.

5. **再评估更广的主题界面与分发入口。** 当官方扩展或市场接口能够承载所需能力时，提供相应适配；独立安装方式仍应保留。

   **Then evaluate broader themed surfaces and distribution channels.** Add adapters when official extension or marketplace interfaces can carry the required capabilities, while preserving an independent installation path.

## 参与项目 / Contributing

当前阶段最有价值的贡献是：定位不同 Codex 版本中的用户可见字符串、记录可重复的兼容性证据、讨论语言包与主题包的最小稳定规范。

At this stage, the most valuable contributions are locating user-visible strings across Codex versions, recording reproducible compatibility evidence, and discussing the smallest stable specifications for language and theme packs.

在首个规范发布前，任何目录结构和接口都可能调整。初期设计见 [docs/initial-design.md](docs/initial-design.md)，i18n 基础规范见 [docs/i18n/foundation-design.md](docs/i18n/foundation-design.md)。

Until the first specification is released, any directory structure or interface may change. See [docs/initial-design.md](docs/initial-design.md) for the initial design and [docs/i18n/foundation-design.md](docs/i18n/foundation-design.md) for the i18n foundation.

## 许可证 / License

本项目采用 GNU General Public License v3.0 发布，详见 [LICENSE](LICENSE)。

This project is released under the GNU General Public License v3.0. See [LICENSE](LICENSE).

## 非官方声明 / Unofficial Project Notice

Codex CLI Ultra 是社区驱动的非官方项目，与 OpenAI 不存在隶属、赞助或背书关系。“Codex”和“OpenAI”是其各自权利人的名称或商标。

Codex CLI Ultra is an unofficial, community-driven project and is not affiliated with, sponsored by, or endorsed by OpenAI. “Codex” and “OpenAI” are names or trademarks of their respective owners.
