# i18n 基础设计 / i18n Foundation Design

> **状态：书面规范待审阅。** 本文记录已经确认的首期架构、文本范围、英文回退契约、测试要求与交付边界。
>
> **Status: written specification under review.** This document records the approved first-phase architecture, text scope, English fallback contract, testing requirements, and delivery boundaries.

## 1. 决策摘要 / Decision Summary

Codex CLI Ultra 的首个实现目标是高频交互 TUI 的 i18n 支持。最初基线为 Codex CLI 0.144.1；当前可运行基线已重放到 0.144.4，对应上游标签 rust-v0.144.4。上游 main 仅用于发现版本漂移，不作为可直接安装的稳定目标。

The first implementation goal of Codex CLI Ultra is i18n support for high-frequency interactive TUI surfaces. The initial baseline was Codex CLI 0.144.1; the current runnable baseline has been replayed onto 0.144.4 at tag rust-v0.144.4. Upstream main is used only to detect version drift and is not treated as a directly installable stable target.

架构采用薄 Rust i18n 桥接层与 JavaScript 安装执行器的组合。Rust 负责运行时消息查询、格式化、富文本插槽和英文回退；JavaScript 负责版本检测、语言包校验、兼容适配、事务式安装、卸载、诊断和回滚。

The architecture combines a thin Rust i18n bridge with a JavaScript installation executor. Rust owns runtime message lookup, formatting, rich-text slots, and English fallback. JavaScript owns version detection, language-pack validation, compatibility adapters, transactional installation, removal, diagnostics, and rollback.

语言包使用声明式 Fluent/FTL 资源，不执行任意 JavaScript。官方英文渲染逻辑编译在 Rust 中，不能被外部语言包删除或覆盖为不可恢复状态。

Language packs use declarative Fluent/FTL resources and do not execute arbitrary JavaScript. The official English rendering logic is compiled into Rust and cannot be removed or overwritten into an unrecoverable state by an external language pack.

## 2. 目标与非目标 / Goals and Non-Goals

### 2.1 首期目标 / First-Phase Goals

- 为选定的高频 TUI 界面建立稳定的语义消息 ID。

  Establish stable semantic message IDs for the selected high-frequency TUI surfaces.

- 生成可追踪到 Codex 源码位置的机器文本目录和人工审阅报告。

  Generate a machine-readable text catalog and a human review report traceable to Codex source locations.

- 允许语言包独立安装、升级、校验和回滚。

  Allow language packs to be independently installed, upgraded, validated, and rolled back.

- 让单条翻译错误只影响该条消息，并自动显示官方英文。

  Ensure that an error in one translation affects only that message and automatically displays the official English text.

- 在整个语言包损坏、版本不兼容或安装中断时保持官方 Codex 可启动、可使用。

  Keep the official Codex installation launchable and usable when an entire language pack is damaged, incompatible, or interrupted during installation.

- 为后续语言贡献者提供不依赖 Codex Rust 内部结构的语言包规范。

  Give future language contributors a language-pack specification that does not require knowledge of Codex Rust internals.

### 2.2 首期非目标 / First-Phase Non-Goals

- 不翻译用户输入、模型输出、远端服务返回的自由文本或第三方插件内容。

  Do not translate user input, model output, free-form remote service text, or third-party plugin content.

- 不翻译斜杠命令名、配置键、路径、URL、模型名称和协议字段。

  Do not translate slash-command names, configuration keys, paths, URLs, model names, or protocol fields.

- 不在首期开放语言包脚本、网络访问、进程启动或任意文件读取能力。

  Do not allow language-pack scripts, network access, process spawning, or arbitrary file reads in the first phase.

- 不对未知 Codex 版本进行模糊文本替换或自动打补丁。

  Do not perform fuzzy text replacement or automatic patching against unknown Codex versions.

- 不在本规范中实现主题包；主题系统继续保持独立边界。

  Do not implement theme packs in this specification; the theme system remains a separate boundary.

## 3. 证据基线与首批界面 / Evidence Baseline and Initial Surfaces

调查时，本机安装版本、npm 发布版本和上游稳定标签均为 0.144.1。上游 main 已继续前进，因此每个目录和适配器都必须记录稳定版本、源码指纹和验证时间。

At investigation time, the locally installed version, npm release, and upstream stable tag were all 0.144.1. Upstream main had already advanced, so every catalog and adapter must record its stable version, source fingerprint, and verification time.

对 TUI 生产源码的启发式英文字符串扫描产生了约 13,495 个候选。这个数字包含测试块、日志、URL、内部标识和其他噪声，不能作为翻译覆盖率；首期采用界面优先、人工分类的目录流程。

A heuristic English-string scan of the TUI production source produced approximately 13,495 candidates. This includes test blocks, logs, URLs, internal identifiers, and other noise, so it is not a translation coverage metric. The first phase uses a surface-first, human-classified catalog process.

首批 A 类范围包含以下源码区域：

The initial Scope A contains these source areas:

| 界面 / Surface | 主要源码位置 / Primary source locations |
| --- | --- |
| 引导、登录、目录信任 / Onboarding, sign-in, directory trust | codex-rs/tui/src/onboarding/ |
| 输入区、底栏和快捷键提示 / Composer, footer, shortcut hints | codex-rs/tui/src/bottom_pane/chat_composer.rs, bottom_pane/footer.rs |
| 斜杠命令说明 / Slash-command descriptions | codex-rs/tui/src/slash_command.rs |
| 审批、权限和设置 / Approvals, permissions, settings | codex-rs/tui/src/bottom_pane/, codex-rs/tui/src/chatwidget/ |
| 会话状态卡片 / Session status card | codex-rs/tui/src/status/ |
| 状态栏配置 / Status-line setup | codex-rs/tui/src/bottom_pane/status_line_setup.rs |
| 用户可见警告 / User-facing warnings | codex-rs/tui/src/chatwidget/warnings.rs and related render paths |

测试和快照不作为消息来源，但用于确认文本确实可见以及验证渲染结果。

Tests and snapshots are not message sources, but they are used to confirm that text is user-visible and to validate rendering results.

## 4. 系统架构 / System Architecture

~~~text
JavaScript 安装执行器 / JavaScript installation executor
    |
    +-- Codex 版本检测 / Codex version detection
    +-- 版本适配器选择 / Version-adapter selection
    +-- 语言包与哈希校验 / Language-pack and hash validation
    +-- 事务式安装与回滚 / Transactional installation and rollback
    |
    v
薄 Rust i18n 桥接层 / Thin Rust i18n bridge
    |
    +-- 可用翻译消息 / Valid localized message
    |       |
    |       v
    |   FTL 渲染结果 / FTL rendering result
    |
    +-- 任意失败 / Any failure
            |
            v
        编译内置英文 / Compiled-in English renderer
~~~

### 4.1 Rust i18n 桥接层 / Rust i18n Bridge

Rust 桥接层提供始终返回可渲染值的接口。普通文本返回 String 或 Cow，富文本返回 Ratatui Line 或等价的结构化行。翻译错误不会以 Result 传播到 TUI。

The Rust bridge exposes interfaces that always return renderable values. Plain messages return String or Cow, while rich messages return a Ratatui Line or equivalent structured line. Translation errors do not propagate to the TUI as Result values.

概念接口如下：

The conceptual interfaces are:

~~~rust
i18n.text_or(message_id, args, || english_text)

i18n.line_or(message_id, args, rich_slots, || english_line)
~~~

英文闭包保留当前 Codex 的原始英文渲染和样式。即使 FTL 解析器、语言协商或外部文件系统全部失效，回退也不依赖外部资源。

The English closure preserves the existing Codex English rendering and styling. Even if the FTL parser, locale negotiation, or external filesystem fails completely, fallback does not depend on an external resource.

### 4.2 JavaScript 安装执行器 / JavaScript Installation Executor

JavaScript 执行器不参与每帧 TUI 渲染。它只处理安装生命周期，避免把 Node.js 进程或跨进程调用放进交互式渲染热路径。

The JavaScript executor does not participate in per-frame TUI rendering. It handles only the installation lifecycle, avoiding a Node.js process or cross-process calls in the interactive rendering hot path.

执行器必须先确认 Codex 版本和适配器指纹，再生成变更计划。目标不匹配时停止，不修改官方安装。

The executor must verify the Codex version and adapter fingerprints before producing a change plan. When the target does not match, it stops without modifying the official installation.

### 4.3 版本适配器 / Version Adapters

版本适配器只负责把稳定消息语义映射到特定 Codex 版本的源码或构建入口。适配器记录版本范围、目标文件、符号、源码指纹、变换规则、冒烟测试和卸载信息。

A version adapter only maps stable message semantics to source or build entry points for a specific Codex version. It records the version range, target files, symbols, source fingerprints, transformations, smoke tests, and removal information.

项目不以长期完整源码分叉作为产品身份。官方扩展接口具备所需能力后，可以新增官方入口适配器，而不改变语言包格式。

The project does not define itself as a permanent full-source fork. When official extension interfaces expose the required capability, an official-entry adapter can be added without changing the language-pack format.

## 5. 文本目录与消息分类 / Text Catalog and Message Classification

机器可读目录使用 JSONL，每行一个消息记录。JSONL 是消息身份、分类、参数和源码追踪信息的权威目录；运行时英文渲染仍由 Rust 中编译的官方英文逻辑提供。CI 必须验证两者保持一致。

The machine-readable catalog uses JSONL with one message record per line. JSONL is authoritative for message identity, classification, parameters, and source tracking. Runtime English rendering remains the compiled official English logic in Rust. CI must verify that the two remain consistent.

人工审阅报告由 JSONL 生成，不单独手工维护同一套字段。

The human review report is generated from JSONL and does not manually maintain a duplicate set of fields.

### 5.1 记录结构 / Record Shape

~~~json
{
  "schemaVersion": 1,
  "id": "tui.onboarding.auth.sign-in-chatgpt",
  "ftlKey": "onboarding-sign-in-chatgpt",
  "surface": "onboarding",
  "english": "Sign in with ChatGPT",
  "kind": "plain",
  "placeholders": [],
  "richSlots": [],
  "translation": "required",
  "source": {
    "repository": "openai/codex",
    "release": "rust-v0.144.1",
    "path": "codex-rs/tui/src/onboarding/auth.rs",
    "symbol": "AuthWidget::render_pick_mode",
    "line": 444,
    "fingerprint": "sha256:acc83c463bb39814895732f7c5e303db4688aa2c7b65dcbdf3dd564da9df3068"
  },
  "firstSeen": "0.144.1",
  "lastVerified": "0.144.1"
}
~~~

行号用于人工定位，不作为兼容锚点。源码指纹由规范化的路径、符号和英文消息内容生成；代码移动但语义不变时可以更新位置而保留消息 ID。

Line numbers are for human navigation and are not compatibility anchors. The source fingerprint is generated from the normalized path, symbol, and English message content. When code moves without a semantic change, the location can be updated while preserving the message ID.

### 5.2 消息 ID / Message IDs

逻辑消息 ID 使用以下结构：

Logical message IDs use this structure:

~~~text
tui.<surface>.<component>.<semantic-name>
~~~

每个段使用小写 kebab-case。消息 ID 不包含英语句子、行号、版本号或翻译语言。

Each segment uses lowercase kebab-case. Message IDs do not contain English sentences, line numbers, version numbers, or translation locales.

Fluent 标识符不使用点号。目录为每条消息显式声明简洁的 `ftlKey`，例如逻辑 ID `tui.onboarding.auth.sign-in-chatgpt` 对应 `onboarding-sign-in-chatgpt`。校验器只要求键符合小写 kebab-case 且全局唯一，不再把目录层级机械编码进语言包。

Fluent identifiers do not use dots. The catalog explicitly declares a concise `ftlKey` for each message; for example, logical ID `tui.onboarding.auth.sign-in-chatgpt` maps to `onboarding-sign-in-chatgpt`. Validation requires lowercase kebab-case and global uniqueness rather than mechanically encoding catalog hierarchy into language-pack keys.

### 5.3 消息类别 / Message Kinds

- plain：完整静态文本，可直接翻译。

  plain: complete static text that can be translated directly.

- parameterized：包含具名参数的完整消息。

  parameterized: a complete message containing named parameters.

- rich：包含带样式插槽、可重排片段或结构化内容的消息。

  rich: a message containing styled slots, reorderable segments, or structured content.

- identifier：命令名、配置键、协议字段等稳定标识，不翻译。

  identifier: stable identifiers such as command names, configuration keys, and protocol fields; not translated.

- dynamic：用户、模型、远端服务或第三方扩展生成的内容，不翻译。

  dynamic: content generated by users, models, remote services, or third-party extensions; not translated.

日志、Tracing、测试断言和开发者错误默认不进入首期目录。若同一字符串同时出现在日志和用户界面，只有实际渲染调用点进入目录。

Logs, tracing text, test assertions, and developer errors do not enter the first-phase catalog by default. If the same string appears in both logs and the user interface, only the actual rendering call site enters the catalog.

## 6. 语言包契约 / Language-Pack Contract

每个语言包是独立、声明式、可校验的目录：

Each language pack is an independent, declarative, verifiable directory:

~~~text
manifest.json
messages.ftl
glossary.md
~~~

manifest.json 必须声明：

manifest.json must declare:

- schemaVersion：语言包规范版本。

  schemaVersion: the language-pack schema version.

- type：固定为 language。

  type: fixed to language.

- id：全局稳定包 ID。

  id: a globally stable package ID.

- locale：规范化 BCP 47 区域标识。

  locale: a canonical BCP 47 locale identifier.

- fallbackLocales：经过校验、无循环的后备区域顺序。

  fallbackLocales: a validated, cycle-free ordered locale fallback list.

- codexVersionRange：支持的 Codex 版本范围。

  codexVersionRange: the supported Codex version range.

- adapterVersion：需要的 i18n 适配器版本。

  adapterVersion: the required i18n adapter version.

- resources：资源路径与 SHA-256 哈希。

  resources: resource paths and SHA-256 hashes.

语言包不包含可执行脚本。glossary.md 只供贡献者审阅，不参与运行时加载。

Language packs contain no executable scripts. glossary.md exists only for contributor review and is not loaded at runtime.

## 7. 语言选择与运行时数据流 / Locale Selection and Runtime Data Flow

区域选择按以下优先级解析：

Locale selection is resolved in this order:

1. JavaScript 执行器记录的用户明确选择。

   The user's explicit selection recorded by the JavaScript executor.

2. 单次会话环境变量 CODEX_ULTRA_LOCALE。

   The per-session CODEX_ULTRA_LOCALE environment variable.

3. 操作系统区域对应且已安装、已验证的语言包。

   An installed and verified language pack matching the operating-system locale.

4. en-US。

   en-US.

环境变量只用于一次性覆盖和诊断，不改变持久配置。

The environment variable is only for one-session overrides and diagnostics and does not change persistent configuration.

请求 zh-CN 时，运行时依次尝试 zh-CN、清单声明的无循环后备区域、规范化基础语言 zh，最后进入编译内置英文。只有已安装且通过校验的语言包会参与协商。

When zh-CN is requested, the runtime tries zh-CN, cycle-free fallback locales declared by the manifest, the canonical base language zh, and finally compiled-in English. Only installed and validated language packs participate in negotiation.

运行时对每条消息执行：

For each message, the runtime:

1. 查询选定语言的 FTL 键。

   Looks up the FTL key in the selected locale.

2. 验证参数和富文本插槽。

   Validates parameters and rich-text slots.

3. 成功时返回翻译渲染结果。

   Returns the localized rendering on success.

4. 任意一步失败时调用该消息的英文闭包。

   Calls that message's English closure when any step fails.

## 8. 富文本与参数规则 / Rich Text and Parameter Rules

不能分别翻译依赖语序的英文碎片。例如 Press、快捷键和 to continue 必须建模为一条完整消息：

English fragments whose order matters cannot be translated separately. For example, Press, the shortcut, and to continue must be modeled as one complete message:

~~~ftl
onboarding-press-to-continue = Press { $key } to continue
~~~

普通参数可以在翻译中重复使用或调整位置。参数名必须与目录声明一致。

Plain parameters may be repeated or reordered in a translation. Parameter names must match the catalog declaration.

富文本插槽携带 Ratatui 样式或交互语义。默认规则是每个必需富文本插槽必须且只能出现一次；目录可以显式声明 repeatable 或 optional，校验器据此处理。

Rich-text slots carry Ratatui styling or interaction semantics. By default, each required rich slot must appear exactly once. The catalog may explicitly declare a slot repeatable or optional, and the validator follows that declaration.

翻译不能改变斜杠命令、按键值、路径或 URL 本身，但可以改变它们周围的说明和语序。

A translation cannot change slash commands, key values, paths, or URLs themselves, but it can change the surrounding explanation and order.

## 9. 英文回退契约 / English Fallback Contract

英文回退是运行时不可违反的行为，不是语言包作者可选功能。

English fallback is a mandatory runtime behavior, not an optional feature for language-pack authors.

| 故障 / Failure | 行为 / Required behavior |
| --- | --- |
| 没有安装所选语言 / Selected locale is not installed | 完整使用英文启动 / Start fully in English |
| 清单、哈希或 FTL 在安装时无效 / Invalid manifest, hash, or FTL during installation | 拒绝激活，保留当前安装 / Reject activation and preserve the current installation |
| 整个语言包在运行时无法加载 / Entire pack cannot load at runtime | 本次会话使用英文 / Use English for the session |
| 单个消息键缺失 / One message key is missing | 仅该消息使用英文 / Use English only for that message |
| 参数名称或类型不匹配 / Parameter name or type mismatch | 仅该消息使用英文 / Use English only for that message |
| 富文本插槽缺失或非法 / Missing or invalid rich slot | 使用原始英文 Line 和样式 / Use the original English Line and styling |
| Codex 版本不受支持 / Unsupported Codex version | 不修改官方安装 / Do not modify the official installation |
| 安装进程中断 / Installation process is interrupted | 不切换活动版本，清理临时状态 / Do not switch the active version; clean temporary state |

翻译层不会向界面返回消息 ID、空字符串、部分格式化模板或异常对象。英文回退闭包本身由现有 Rust 代码提供；构建测试验证它总能产生可渲染结果。

The translation layer never returns a message ID, an empty string, a partially formatted template, or an exception object to the interface. The English fallback closure is provided by existing Rust code, and build tests verify that it always produces a renderable result.

若整个非英语语言包失效，每次会话最多显示一次非阻塞英文提示：

If an entire non-English language pack fails, the session displays at most one non-blocking English notice:

~~~text
Could not load zh-CN; continuing in English.
~~~

单条消息回退不在 TUI 中重复提示，只进入去重诊断记录。

Per-message fallback does not repeatedly notify the user in the TUI and is recorded only in deduplicated diagnostics.

## 10. 安装事务与回滚 / Installation Transaction and Rollback

安装必须按以下顺序执行：

Installation must follow this order:

1. 下载或读取语言包到临时目录。

   Download or read the language pack into a temporary directory.

2. 校验清单、规范版本、哈希、FTL、消息键、参数和插槽。

   Validate the manifest, schema version, hashes, FTL, message keys, parameters, and slots.

3. 检测 Codex 版本并验证适配器指纹。

   Detect the Codex version and verify adapter fingerprints.

4. 生成可审阅的变更计划。

   Generate a reviewable change plan.

5. 在隔离目标上安装并运行冒烟测试。

   Install into an isolated target and run smoke tests.

6. 仅在所有验证成功后原子切换活动版本。

   Atomically switch the active version only after every validation succeeds.

7. 保留上一个已知可用版本的清单、哈希和恢复信息。

   Preserve the previous known-good version's manifest, hashes, and restoration information.

卸载恢复官方英文状态，并删除由本项目安装的活动指针和资源；不删除用户自行安装的 Codex 配置或其他插件。

Removal restores the official English state and removes active pointers and resources installed by this project. It does not delete user-managed Codex configuration or other plugins.

## 11. 诊断 / Diagnostics

JavaScript 执行器提供 doctor 命令，至少报告：

The JavaScript executor provides a doctor command that reports at least:

- 当前 Codex 版本、适配器和源码指纹。

  Current Codex version, adapter, and source fingerprints.

- 当前选择区域、实际加载区域和英文回退状态。

  Requested locale, actually loaded locale, and English fallback state.

- 语言包版本、清单规范与文件哈希。

  Language-pack version, manifest schema, and file hashes.

- 缺失键、未知键、参数不一致和富文本插槽错误。

  Missing keys, unknown keys, parameter mismatches, and rich-slot errors.

- 最近一次安装、回滚和失败恢复结果。

  Results of the most recent installation, rollback, and failure recovery.

运行时诊断按 locale、message ID 和错误类型去重，避免错误语言包产生持续日志洪水。

Runtime diagnostics are deduplicated by locale, message ID, and error type to prevent a broken language pack from producing continuous log floods.

## 12. 测试策略 / Testing Strategy

### 12.1 文本目录测试 / Catalog Tests

- 消息 ID 唯一并符合命名规则。

  Message IDs are unique and conform to the naming rules.

- 英文文本非空，源码路径和符号存在。

  English text is non-empty, and source paths and symbols exist.

- 参数、富文本插槽和消息类别完整。

  Parameters, rich slots, and message kinds are complete.

- Scope A 的每个用户可见文本都被分类为 required、excluded 或 refactor-required。

  Every user-visible Scope A message is classified as required, excluded, or refactor-required.

### 12.2 语言包测试 / Language-Pack Tests

- FTL 可以解析，键唯一且属于目录。

  FTL parses successfully, keys are unique, and keys belong to the catalog.

- 必需参数与插槽满足目录约束。

  Required parameters and slots satisfy catalog constraints.

- 清单版本、Codex 范围、适配器版本和资源哈希有效。

  Manifest version, Codex range, adapter version, and resource hashes are valid.

### 12.3 回退测试 / Fallback Tests

自动测试语言包不存在、FTL 损坏、随机键删除、参数名称改变、插槽缺失、未知 Codex 版本和安装中断。每个场景都必须正常启动或安全拒绝安装，受影响界面显示英文，不 panic，不显示消息 ID，不留下半安装状态。

Automated tests cover a missing pack, damaged FTL, random key deletion, changed parameter names, missing slots, unknown Codex versions, and interrupted installation. Every case must start normally or reject installation safely, show English on affected surfaces, avoid panics and message IDs, and leave no partial installation state.

### 12.4 TUI 快照测试 / TUI Snapshot Tests

en-US 和参考 zh-CN 语言包生成窄、中、宽终端快照。Windows 11 测试覆盖 CJK 字符宽度、换行、截断、无真彩和无 Nerd Font 场景。

The en-US and reference zh-CN packs generate snapshots for narrow, medium, and wide terminals. Windows 11 tests cover CJK character width, wrapping, truncation, no-true-color, and no-Nerd-Font scenarios.

故障场景中的英文快照必须与未启用语言包的官方英文渲染一致。

English snapshots in failure scenarios must match the official English rendering with no language pack enabled.

### 12.5 安装与适配器测试 / Installer and Adapter Tests

适配器仅在版本和源码指纹同时匹配时执行。测试覆盖预检、隔离安装、冒烟启动、原子切换、卸载、上一版本回滚和中断恢复。

An adapter runs only when both the version and source fingerprints match. Tests cover preflight, isolated installation, smoke launch, atomic switching, removal, previous-version rollback, and interrupted recovery.

## 13. 上游漂移检测 / Upstream Drift Detection

首份目录固定到 rust-v0.144.1。自动化任务定期读取上游 main，并生成以下差异：

The first catalog is pinned to rust-v0.144.1. Automation periodically reads upstream main and generates these differences:

- 新增用户可见文本。

  Added user-visible text.

- 删除的消息。

  Removed messages.

- 英文原文、参数或富文本插槽变化。

  Changes to English text, parameters, or rich slots.

- 源码位置移动但语义未变。

  Source movement without semantic change.

- 适配器目标或源码指纹失效。

  Invalidated adapter targets or source fingerprints.

漂移任务只生成报告和维护者操作建议，不自动翻译，不自动更新消息语义，也不对未知版本应用变换。

The drift job only generates a report and maintainer actions. It does not translate automatically, change message semantics automatically, or apply transformations to unknown versions.

## 14. 首批交付物与验收 / Initial Deliverables and Acceptance

首批公开交付物为：

The first public deliverables are:

~~~text
docs/i18n/foundation-design.md
research/codex-0.144.4/tui-messages.jsonl
docs/i18n/codex-0.144.4-text-inventory.md
~~~

本设计规范审阅通过后，下一份实施计划负责生成真实 JSONL 目录和 Markdown 报告。提取器、Rust 桥接层与 JavaScript 执行器分别进入后续可测试任务，不在设计提交中提前创建空实现。

After this design specification passes review, the next implementation plan generates the real JSONL catalog and Markdown report. The extractor, Rust bridge, and JavaScript executor enter later testable tasks and are not added as empty implementations in the design commit.

首期目录完成的验收标准：

The acceptance criteria for the initial catalog are:

- Scope A 中每个用户可见文本都有明确分类和源码证据。

  Every user-visible Scope A message has an explicit classification and source evidence.

- 消息 ID、FTL 键、参数和插槽通过自动校验。

  Message IDs, FTL keys, parameters, and slots pass automated validation.

- 目录可以针对 rust-v0.144.1 重复生成，并产生稳定排序和可审阅差异。

  The catalog can be regenerated against rust-v0.144.1 with stable ordering and reviewable diffs.

- 所有模拟语言包故障都保持英文可用。

  Every simulated language-pack failure preserves usable English output.

## 15. 后续边界 / Later Boundaries

更广的 CLI 帮助、登录网页、doctor、执行错误和完整 workspace 文本属于下一轮范围扩展。状态栏主题包、主题数据提供器和官方市场分发属于独立设计，不改变本规范的消息 ID、语言包或英文回退原则。

Broader CLI help, login web pages, doctor output, execution errors, and full-workspace text belong to later scope expansion. Status-line theme packs, theme data providers, and official marketplace distribution have separate designs and do not change this specification's message IDs, language packs, or English fallback principles.
