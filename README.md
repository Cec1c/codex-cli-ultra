# Codex CLI Ultra

> **早期状态：** 这是一个非官方、非常早期的实验仓库，目前仍处于“新建文件夹阶段”：方向已经提出，但接口、包规范和实现都尚未稳定。
>
> **Early status:** This is an unofficial, very early experimental repository. It is still at the “new folder” stage: the direction exists, but the interfaces, package specifications, and implementation are not stable yet.

Codex CLI Ultra 希望在不把项目绑定为长期源码分叉的前提下，为 Codex CLI 探索可持续维护的本地化与界面扩展能力。

Codex CLI Ultra explores maintainable localization and interface extension capabilities for Codex CLI without defining the project as a permanent source fork.

## 两个长期方向 / Two Long-Term Directions

### 1. i18n 多语言框架 / i18n Language Framework

初期最优先的目标是验证并建立 i18n 框架，让界面文本从具体实现中解耦。语言包应当可以独立安装、更新、校验和回退，并由世界各地的贡献者分别维护。

The first priority is to validate and establish an i18n framework that decouples interface text from the implementation. Language packs should be independently installable, updatable, verifiable, and removable, so contributors around the world can maintain locales separately.

执行器与安装编排计划采用 JavaScript。语言包本身会优先采用声明式资源格式，而不是要求每个翻译包执行任意代码。

The executor and installation orchestration are planned in JavaScript. Language packs themselves will favor declarative resource formats instead of requiring every translation pack to execute arbitrary code.

### 2. 高度可定制的主题包框架 / Highly Customizable Theme Packs

主题包不会只停留在配色替换。长期设想包括布局、信息模块、图标、分隔符、密度、终端能力降级，以及其他具有完整主题特征的界面表达。

Theme packs are intended to go beyond color replacement. The long-term vision includes layouts, information modules, icons, separators, density, terminal-capability fallbacks, and other interface behaviors that form a complete theme.

主题方向的第一个落点是高度可定制的状态栏：允许主题作者组合状态片段、设置顺序与优先级、定义格式和样式，并在终端宽度不足时优雅降级。

The first theme milestone is a highly customizable status line: theme authors should be able to compose segments, control order and priority, define formatting and styles, and degrade gracefully when terminal width is limited.

## 初期入口 / Initial Entry Point

项目会首先从 PowerShell 7 入口开始，优先支持 Windows 11。这个选择用于尽快跑通探测、安装、卸载、诊断和回滚流程，并不代表未来只支持 Windows。

The project will begin with a PowerShell 7 entry point and prioritize Windows 11. This provides a practical path to validate detection, installation, removal, diagnostics, and rollback, without making the project Windows-only in the long term.

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

在首个规范发布前，任何目录结构和接口都可能调整。初期设计见 [docs/initial-design.md](docs/initial-design.md)。

Until the first specification is released, any directory structure or interface may change. See [docs/initial-design.md](docs/initial-design.md) for the initial design.

## 许可证 / License

本项目采用 GNU General Public License v3.0 发布，详见 [LICENSE](LICENSE)。

This project is released under the GNU General Public License v3.0. See [LICENSE](LICENSE).

## 非官方声明 / Unofficial Project Notice

Codex CLI Ultra 是社区驱动的非官方项目，与 OpenAI 不存在隶属、赞助或背书关系。“Codex”和“OpenAI”是其各自权利人的名称或商标。

Codex CLI Ultra is an unofficial, community-driven project and is not affiliated with, sponsored by, or endorsed by OpenAI. “Codex” and “OpenAI” are names or trademarks of their respective owners.
