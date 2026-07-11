# 初期设计 / Initial Design

> **文档状态：设计草案 v0.1。** 本文用于固定当前研究方向，不是稳定 API 或包格式承诺。
>
> **Document status: design draft v0.1.** This document records the current research direction; it is not a stable API or package-format commitment.

## 1. 目标与边界 / Goals and Boundaries

Codex CLI Ultra 计划提供两个相互解耦的扩展框架：i18n 语言包与高度可定制的主题包。两者共用安装、版本探测、包校验、诊断和回滚基础设施，但不要求彼此绑定。

Codex CLI Ultra plans to provide two decoupled extension frameworks: i18n language packs and highly customizable theme packs. They share installation, version detection, package validation, diagnostics, and rollback infrastructure without requiring either framework to depend on the other.

首期工作以 i18n 为优先，主题系统只先定义状态栏的最小范围。项目不会在这个阶段复制整个 Codex 源码树，也不会承诺支持任意未知版本。

The first phase prioritizes i18n, while the theme system initially defines only the minimum status-line scope. The project will not copy the complete Codex source tree at this stage or promise compatibility with arbitrary unknown versions.

## 2. 设计原则 / Design Principles

1. **包与核心解耦。** 每种语言和主题都应能够独立维护、发布和升级。

   **Decouple packages from the core.** Each language and theme should be independently maintainable, publishable, and upgradable.

2. **兼容性显式化。** 每个适配器与包都必须声明支持的 Codex 版本、规范版本和必要能力。

   **Make compatibility explicit.** Every adapter and package must declare its supported Codex versions, schema version, and required capabilities.

3. **声明式优先。** 语言包和主题包 V1 默认只包含数据，不执行任意 JavaScript；JavaScript 主要存在于受控的核心执行器中。

   **Prefer declarative packages.** Language and theme packs V1 contain data by default and do not execute arbitrary JavaScript; JavaScript primarily lives in the controlled core executor.

4. **失败可见且可回滚。** 指纹、版本或验证不匹配时停止安装，并保留恢复原始状态的记录。

   **Fail visibly and remain reversible.** Stop installation when fingerprints, versions, or validation do not match, and retain enough state to restore the original installation.

5. **Windows 优先，架构跨平台。** PowerShell 7 与 Windows 11 是首个落地点，但包规范不应依赖 Windows 路径或 PowerShell 语义。

   **Windows first, cross-platform by design.** PowerShell 7 and Windows 11 are the first target, but package specifications must not depend on Windows paths or PowerShell semantics.

## 3. 初步架构 / Preliminary Architecture

~~~text
PowerShell 7 入口 / entry
            |
            v
JavaScript 执行器 / executor
    |             |                 |
    v             v                 v
版本适配器      包加载与校验       安装记录、诊断与回滚
Version       Package loading     Install state, doctor,
adapters      and validation      and rollback
                  |
          +-------+-------+
          |               |
          v               v
   i18n 语言包        状态栏主题包
   Language packs     Status-line themes
~~~

PowerShell 7 负责提供 Windows 上的初始用户入口。它应定位可用的 JavaScript 运行环境、启动执行器并展示清晰的权限与错误信息，而不承载核心业务规则。

PowerShell 7 provides the initial Windows-facing entry point. It should locate an available JavaScript runtime, launch the executor, and present clear permission and error information without owning the core business rules.

JavaScript 执行器负责版本探测、包解析、规范校验、适配器选择、变更计划、安装事务、卸载和诊断。具体运行时与最低版本会在原型验证后确定。

The JavaScript executor owns version detection, package resolution, schema validation, adapter selection, change planning, installation transactions, removal, and diagnostics. The exact runtime and minimum version will be selected after prototyping.

版本适配器负责把稳定的包语义映射到特定 Codex 版本。适配器应尽量薄，并包含目标版本范围、文件或符号指纹、变更锚点和安装后的验证规则。

Version adapters map stable package semantics to specific Codex versions. Adapters should remain thin and include target version ranges, file or symbol fingerprints, transformation anchors, and post-install verification rules.

## 4. i18n 语言框架 / i18n Language Framework

### 4.1 首期范围 / Initial Scope

首期只处理 Codex CLI 自身可识别的用户界面文本，包括静态标签、带参数消息、提示、确认文本和可控错误信息。模型生成内容、远端服务返回的自由文本和用户输入不属于翻译范围。

The first phase handles identifiable Codex CLI interface text: static labels, parameterized messages, prompts, confirmations, and controlled error messages. Model-generated content, free-form text returned by remote services, and user input are outside the translation scope.

候选资源格式是 Fluent/FTL，因为它适合具名参数、复数和面向译者的消息组织；最终选择需要用当前 Codex 字符串样本验证后再固定。

Fluent/FTL is the candidate resource format because it supports named parameters, plurals, and translator-oriented message organization. The final choice will be fixed only after validation against current Codex string samples.

语言键应使用稳定的语义标识，而不是把完整英文原文直接作为键。缺失、失效或无法渲染的翻译必须回退到上游英文。

Message keys should use stable semantic identifiers instead of complete English source strings. Missing, invalid, or unrenderable translations must fall back to upstream English.

### 4.2 语言包职责 / Language-Pack Responsibilities

语言包预计包含包清单、语言元数据、消息资源、术语表和可选的覆盖率信息。它不得直接修改 Codex 安装，也不得默认执行安装脚本。

A language pack is expected to contain a manifest, locale metadata, message resources, a glossary, and optional coverage information. It must not directly modify a Codex installation or execute installation scripts by default.

包清单至少需要表达包类型、包 ID、规范版本、语言区域、目标 Codex 版本范围、资源文件和完整性信息。具体字段名仍是草案。

At minimum, the manifest needs to express package type, package ID, schema version, locale, target Codex version range, resource files, and integrity information. Exact field names remain a draft.

### 4.3 主要难点 / Main Challenges

- Rust 编译产物没有天然的外部翻译注入点时，适配可能需要上游扩展接口、受控源码变换或按版本构建的兼容层。

  When Rust build artifacts provide no native external translation hook, integration may require an upstream extension point, controlled source transformations, or a version-specific compatibility layer.

- Codex 更新会移动字符串、改变参数或重构渲染路径，因此不能只依赖模糊文本替换。

  Codex updates may move strings, change parameters, or refactor rendering paths, so fuzzy text replacement alone is not a safe compatibility strategy.

- 中文、阿拉伯文等语言会改变终端宽度、换行和双向文本行为，测试必须覆盖 Unicode 宽度与窄终端降级。

  Languages such as Chinese and Arabic affect terminal width, wrapping, and bidirectional behavior, so tests must cover Unicode width and narrow-terminal fallbacks.

- 翻译不能破坏占位参数、快捷键提示、命令名、日志可搜索性或无障碍语义。

  Translations must not break placeholders, shortcut hints, command names, log searchability, or accessibility semantics.

## 5. 主题包框架 / Theme-Pack Framework

主题包的目标不是简单覆盖颜色，而是描述一套受约束、可组合、可降级的终端界面。首期只实现状态栏，其他 TUI 区域在兼容接口明确后再评估。

The goal of a theme pack is not merely to override colors, but to describe a constrained, composable, and degradable terminal interface. The first phase implements only the status line; other TUI surfaces will be evaluated after compatible extension points are clear.

### 5.1 状态栏 V1 / Status Line V1

状态栏主题预计能够选择内置数据片段，并声明顺序、分组、优先级、最小宽度、隐藏条件、格式模板、图标、分隔符、颜色和文本属性。

A status-line theme is expected to select built-in data segments and declare order, grouping, priority, minimum width, visibility conditions, format templates, icons, separators, colors, and text attributes.

候选内置片段包括模型、当前目录、Git 分支、上下文或令牌状态、沙箱与审批状态等；只有 Codex 当前版本能够可靠提供的数据才会开放。

Candidate built-in segments include model, current directory, Git branch, context or token status, and sandbox or approval state. Only data that the current Codex version can provide reliably will be exposed.

主题包 V1 不允许运行任意 JavaScript、启动进程或读取任意文件。自定义数据提供器需要单独的权限模型、超时与性能预算，因此推迟到后续版本研究。

Theme packs V1 cannot run arbitrary JavaScript, start processes, or read arbitrary files. Custom data providers require a separate permission model, timeouts, and performance budgets, so they are deferred to later research.

状态栏渲染必须按终端能力降级：无真彩时回落到较小色板，无 Nerd Font 时回落到文本符号，宽度不足时按片段优先级收缩或隐藏。

Status-line rendering must degrade according to terminal capabilities: use a smaller palette without true color, use text symbols without a Nerd Font, and shrink or hide segments by priority when width is limited.

## 6. 安装与分发方向 / Installation and Distribution

首期安装流程计划由 PowerShell 7 启动 JavaScript 执行器，依次完成环境检查、Codex 版本探测、包下载或本地读取、完整性验证、兼容性预检、事务式安装和安装后验证。

The initial installation flow is planned to launch the JavaScript executor from PowerShell 7, then perform environment checks, Codex version detection, package download or local loading, integrity verification, compatibility preflight, transactional installation, and post-install validation.

每次安装都应记录原版本、适配器、包版本、变更文件和校验值，以支持卸载、回滚和 doctor 诊断。未知版本默认拒绝修改。

Each installation should record the original version, adapter, package version, changed files, and checksums to support removal, rollback, and doctor diagnostics. Unknown versions are rejected by default.

如果官方插件或市场接口能够分发所需资源，项目可以提供对应清单与适配器；核心包规范和独立安装器不应依赖单一市场。

If an official plugin or marketplace interface can distribute the required resources, the project can provide the corresponding manifests and adapters. The core package specifications and independent installer should not depend on a single marketplace.

正式发布一键安装命令前，需要先解决发布签名、校验值、失败恢复和脚本可审计性。设计阶段不鼓励直接执行未经检查的远程脚本。

Before publishing a one-command installer, release signing, checksums, failure recovery, and script auditability must be addressed. During the design stage, directly executing unreviewed remote scripts is discouraged.

## 7. 建议的未来目录 / Proposed Future Layout

以下只是后续实现候选，当前仓库不会为了占位而创建空目录。

The following is only a candidate for later implementation; the current repository will not create empty directories merely as placeholders.

~~~text
packages/
  core/                 # JavaScript executor
  adapters/             # Codex version adapters
  languages/            # Reference language packs
  themes/               # Reference theme packs
schemas/                # Versioned package schemas
scripts/
  install.ps1           # Windows / PowerShell 7 entry
tests/
  fixtures/             # Version and rendering fixtures
~~~

## 8. 阶段目标 / Milestones

### 阶段 0：可行性证据 / Phase 0: Feasibility Evidence

建立当前 Codex 版本的字符串与状态栏数据清单，记录源代码位置、渲染上下文、参数和版本指纹。

Build an inventory of strings and status-line data for the current Codex version, recording source locations, rendering context, parameters, and version fingerprints.

### 阶段 1：i18n 最小可用版本 / Phase 1: i18n MVP

完成 Windows 11 与 PowerShell 7 入口、JavaScript 执行器、语言包校验、一个参考语言包、英文回退以及可验证的安装和回滚。

Complete the Windows 11 and PowerShell 7 entry point, JavaScript executor, language-pack validation, one reference language pack, English fallback, and verifiable installation and rollback.

### 阶段 2：状态栏主题 V1 / Phase 2: Status-Line Themes V1

完成版本化主题规范、内置数据片段、布局与宽度策略、终端能力降级，以及至少两个差异明显的参考主题。

Complete a versioned theme specification, built-in data segments, layout and width policies, terminal-capability fallback, and at least two meaningfully different reference themes.

### 阶段 3：生态与更多界面 / Phase 3: Ecosystem and More Surfaces

在核心规范稳定后，再设计包索引、贡献者验证流程、官方分发适配和更广的 TUI 主题能力。

After the core specifications stabilize, design a package index, contributor validation workflow, official distribution adapters, and broader TUI theming capabilities.

## 9. 尚待验证的问题 / Open Questions

- 当前 Codex 版本中，哪些字符串和状态栏数据能够通过稳定入口扩展，哪些只能通过版本适配处理？

  Which strings and status-line data in current Codex versions can be extended through stable entry points, and which require version-specific adapters?

- i18n 应该成为上游可合并的 Rust 接口、独立构建层，还是两者并存？

  Should i18n become an upstreamable Rust interface, an independent build layer, or a combination of both?

- 包签名、可信发布者、权限声明与撤销机制应采用什么最小模型？

  What minimum model should be used for package signing, trusted publishers, permission declarations, and revocation?

- 在不牺牲启动速度和稳定性的前提下，主题系统最终可以开放多少动态能力？

  How much dynamic behavior can the theme system eventually expose without sacrificing startup speed and stability?
