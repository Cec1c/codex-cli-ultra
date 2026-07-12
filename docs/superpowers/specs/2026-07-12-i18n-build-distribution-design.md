# Codex CLI Ultra i18n 构建与分发设计 / i18n Build and Distribution Design

> **状态：已确认设计，实施计划已拆分定稿。** 本文固定首个可安装 i18n MVP 的构建、分发、启动、降级和升级边界。
>
> **Status: approved design with finalized implementation plans.** This document fixes the build, distribution, launch, fallback, and upgrade boundaries for the first installable i18n MVP.

## 1. 决策摘要 / Decision Summary

Codex CLI Ultra 不直接修改官方 npm 包中的 `codex.exe`。项目发布基于精确上游版本构建的 Codex Ultra 二进制，并通过 JavaScript 启动器接管用户输入的 `codex` 命令。官方 Codex 与 Ultra 构建并排保留。

Codex CLI Ultra does not directly modify `codex.exe` inside the official npm package. The project publishes Codex Ultra binaries built from exact upstream versions and uses a JavaScript launcher to handle the user's `codex` command. The official Codex installation and Ultra build remain installed side by side.

Rust 层提供薄 i18n 接口，运行时加载外部声明式 Fluent/FTL 语言包。JavaScript 执行器负责环境探测、Release 下载、清单与哈希验证、安装事务、语言包管理、诊断、升级和回滚。

The Rust layer provides a thin i18n interface that loads external declarative Fluent/FTL language packs at runtime. The JavaScript executor owns environment detection, Release download, manifest and hash verification, installation transactions, language-pack management, diagnostics, upgrades, and rollback.

任何翻译、语言包、补丁构建、网络或升级故障都不能阻止用户继续使用英文 Codex。启动过程不联网；只有显式的安装、更新或诊断命令可以访问 GitHub。

No translation, language-pack, patched-build, network, or upgrade failure may prevent the user from continuing with English Codex. Launching never accesses the network; only explicit install, update, or diagnostic commands may access GitHub.

## 2. 首期范围 / Initial Scope

首期稳定目标固定为：

The initial stable target is fixed to:

- Windows 11、PowerShell 7、x86_64。

  Windows 11, PowerShell 7, and x86_64.

- Codex CLI `0.144.1`、上游标签 `rust-v0.144.1`、提交 `44918ea10c0f99151c6710411b4322c2f5c96bea`。

  Codex CLI `0.144.1`, upstream tag `rust-v0.144.1`, and commit `44918ea10c0f99151c6710411b4322c2f5c96bea`.

- 一个预编译 Windows x64 Ultra 构建。

  One prebuilt Windows x64 Ultra build.

- 一个外部 `zh-CN` FTL 参考语言包。

  One external `zh-CN` FTL reference language pack.

- 状态栏设置界面的四条静态消息，以及参数化的 `Worked for {duration}` 消息。

  Four static status-line setup messages plus the parameterized `Worked for {duration}` message.

机器可读研究目录可以继续保留已经定位但尚未接入的消息；首期运行时和参考语言包只把上述五条标记为 `wired`。额外目录记录不扩大 MVP 的用户界面翻译范围。

The machine-readable research catalog may retain already located but unwired messages. The initial runtime and reference language pack mark only the five messages above as `wired`; extra catalog records do not expand the MVP translation surface.

“加班了 {duration}”用于验证参数化消息。随机彩蛋短语列表不进入首个 MVP，避免快照不稳定和不可预测输出。

`加班了 {duration}` validates parameterized messages. Random easter-egg phrase lists are excluded from the first MVP to avoid unstable snapshots and unpredictable output.

首期不覆盖完整 TUI、CLI 帮助、模型输出、远端服务文本、日志、协议字段或第三方插件内容。

The initial scope does not cover the complete TUI, CLI help, model output, remote-service text, logs, protocol fields, or third-party plugin content.

## 3. 总体架构 / Overall Architecture

~~~text
用户输入 codex / User runs codex
            |
            v
Codex Ultra JavaScript 启动器 / launcher
    |                     |
    | 可用且严格匹配      | 不可用、不匹配或损坏
    | valid exact match   | unavailable, mismatched, or damaged
    v                     v
预编译 Ultra 二进制      官方 Codex 二进制
Prebuilt Ultra binary    Official Codex binary
    |
    v
Rust i18n 运行时 / runtime
    |
    +-- 有效外部 FTL -> 本地化界面
    |   valid external FTL -> localized UI
    |
    +-- 任意消息或语言包故障 -> 编译内置英文
        any message or pack failure -> compiled-in English
~~~

该架构由五个边界清晰的组件组成。

The architecture contains five components with explicit boundaries.

### 3.1 JavaScript 执行器 / JavaScript Executor

执行器提供 `install`、`update`、`uninstall`、`doctor`、`locale` 和内部 `launch` 能力。它不翻译界面，也不在运行时重写 Rust 二进制。

The executor provides `install`, `update`, `uninstall`, `doctor`, `locale`, and internal `launch` capabilities. It does not translate the interface or rewrite the Rust binary at runtime.

执行器负责：

The executor owns:

- 定位官方 Codex npm 包、包装脚本和平台二进制。

  Locating the official Codex npm package, wrapper scripts, and platform binary.

- 检测官方版本、平台、架构和文件指纹。

  Detecting the official version, platform, architecture, and file fingerprints.

- 查询 GitHub Release、下载资产并验证清单与 SHA-256。

  Querying GitHub Releases, downloading assets, and verifying manifests and SHA-256 values.

- 验证语言包清单、资源哈希、区域标识、i18n API 和消息目录兼容性。

  Validating language-pack manifests, resource hashes, locale identifiers, i18n API compatibility, and message-catalog compatibility.

- 事务式安装、活动指针切换、回滚和卸载。

  Transactional installation, active-pointer switching, rollback, and removal.

### 3.2 JavaScript 启动器 / JavaScript Launcher

启动器位于 Codex Ultra 自有目录，并通过用户 PATH 优先于官方 npm 的 `codex` 包装器。安装器不得修改 PowerShell profile，也不得删除官方 npm 包。

The launcher lives in a Codex Ultra-owned directory and appears before the official npm `codex` wrappers on the user's PATH. The installer must not modify the PowerShell profile or remove the official npm package.

启动器只读取本地状态，选择一个已经验证的绝对二进制路径，并透明传递参数、stdin、stdout、stderr、信号和退出码。它不得在正常启动时访问网络或执行更新。

The launcher only reads local state, selects an already verified absolute binary path, and transparently forwards arguments, stdin, stdout, stderr, signals, and exit codes. It must not access the network or perform updates during a normal launch.

官方回退必须通过安装时记录的绝对平台二进制路径执行，不能再次解析裸 `codex` 命令，否则会递归进入 Ultra 启动器。

Official fallback must execute the absolute platform-binary path recorded during installation. It must not resolve the bare `codex` command again, which would recurse into the Ultra launcher.

### 3.3 预编译 Ultra 二进制 / Prebuilt Ultra Binary

每个 Ultra 二进制都从一个精确的上游标签和提交构建，只包含可审阅的薄 i18n 补丁。首期不允许一个构建声明兼容多个未经验证的 Codex 版本。

Each Ultra binary is built from one exact upstream tag and commit and contains only a reviewable thin i18n patch. The initial phase does not allow one build to claim compatibility with multiple unverified Codex versions.

二进制保持官方 Codex 的认证、配置、会话和工具行为，只改变选定用户界面消息的解析入口。语言包缺失时，它必须表现为正常英文 Codex。

The binary preserves official Codex authentication, configuration, sessions, and tool behavior and changes only the lookup path for selected user-interface messages. Without a language pack, it must behave as normal English Codex.

### 3.4 Rust i18n 运行时 / Rust i18n Runtime

首期在 `codex-tui` 内建立隔离的 i18n 模块，公开可测试的 `Localizer` 接口。只有出现第二个生产消费者时，才将其提取为独立 workspace crate。

The initial phase creates an isolated i18n module inside `codex-tui` with a testable `Localizer` interface. It is extracted into a dedicated workspace crate only when a second production consumer appears.

普通消息接口始终返回可渲染字符串，不向 TUI 传播翻译错误：

The plain-message interface always returns a renderable string and does not propagate translation failures into the TUI:

~~~rust
localizer.text(
    "tui.history.worked-for",
    args,
    || format!("Worked for {duration}"),
)
~~~

英文闭包保留现有官方英文格式化逻辑。找不到键、参数不匹配、消息格式化失败或结果为空时，只调用该消息的英文闭包。整个 FTL 资源无法解析时，Localizer 不激活该语言包，本次会话完整使用英文。

The English closure preserves the existing official English formatting logic. A missing key, argument mismatch, message-formatting failure, or empty result invokes only that message's English closure. If the complete FTL resource cannot be parsed, the Localizer does not activate that pack and the session runs entirely in English.

默认 Localizer 可以在进程初始化后缓存，但组件测试必须允许注入独立 Localizer。调用点不得依赖不可替换的全局状态。

The default Localizer may be cached after process initialization, but component tests must support injecting an independent Localizer. Call sites must not depend on irreplaceable global state.

语言作者维护 FTL；Rust 运行时是最终格式化者。JavaScript 可以在安装前执行同等严格的预检，但不得把首期格式限制为只能处理预格式化静态 JSON。

Language authors maintain FTL, and the Rust runtime is the final formatter. JavaScript may perform equally strict installation-time preflight, but it must not constrain the initial format to preformatted static JSON only.

### 3.5 语言包 / Language Packs

语言包是纯数据，不执行 JavaScript、Rust、Shell 或 PowerShell。每个包包含 `manifest.json`、一个或多个 FTL 资源、可选术语表和许可证文件。

Language packs are data-only and execute no JavaScript, Rust, shell, or PowerShell. Each pack contains `manifest.json`, one or more FTL resources, an optional glossary, and a license file.

语言包独立于 Ultra 二进制发布。翻译文本、术语和覆盖率更新不需要重新编译 Rust；只有 i18n API、消息目录或上游调用点变化时才需要新的 Ultra 构建。

Language packs are released independently from Ultra binaries. Translation text, terminology, and coverage updates do not require rebuilding Rust; only i18n API, message-catalog, or upstream call-site changes require a new Ultra build.

区域选择按以下优先级解析：单次会话的 `CODEX_ULTRA_LOCALE`、用户通过执行器明确保存的活动语言、与操作系统区域匹配且已验证的已安装语言包、最后是 `en-US`。单次环境变量覆盖不写入持久状态。

Locale selection resolves in this order: per-session `CODEX_ULTRA_LOCALE`, the active locale explicitly saved through the executor, an installed and verified pack matching the operating-system locale, and finally `en-US`. A per-session environment override does not write persistent state.

请求区域不可用时，运行时依次尝试清单声明的无循环后备区域和规范化基础语言，例如 `zh-Hant-TW -> zh-Hant -> zh`，最后进入编译内置英文。

When a requested locale is unavailable, the runtime tries cycle-free manifest fallback locales and canonical base locales, for example `zh-Hant-TW -> zh-Hant -> zh`, before falling back to compiled-in English.

## 4. 安装目录与状态 / Installation Layout and State

Windows 首期使用以下用户级目录：

The Windows-first installation uses this user-level layout:

~~~text
%LOCALAPPDATA%\codex-cli-ultra\
├── bin\
│   ├── codex.cmd
│   ├── codex.ps1
│   ├── launcher.mjs
│   ├── codex-ultra.cmd
│   ├── codex-ultra.ps1
│   ├── codex-ultra.mjs
│   ├── uninstall.ps1
│   └── set-user-path.ps1
├── releases\
│   └── 0.144.1-ultra.1\x86_64-pc-windows-msvc\
│       ├── package\
│       │   ├── codex-package.json
│       │   ├── bin\codex.exe
│       │   ├── codex-resources\
│       │   └── codex-path\rg.exe
│       ├── release-manifest.json
│       └── LICENSES\
├── languages\
│   └── zh-CN\
│       ├── manifest.json
│       ├── messages.ftl
│       └── LICENSE
├── cache\
├── logs\
├── notices\
└── state.json
~~~

`package/` 保留上游 `scripts/build_codex_package.py` 生成的规范布局。启动器执行 `package/bin/codex.exe` 的绝对路径，不把入口二进制脱离其沙箱辅助程序、code-mode host、ripgrep 和其他伴随资源单独移动。

`package/` preserves the canonical layout produced by upstream `scripts/build_codex_package.py`. The launcher executes the absolute `package/bin/codex.exe` path and does not move the entrypoint away from its sandbox helpers, code-mode host, ripgrep, or other companion resources.

`state.json` 只保存启动所需的稳定事实：官方绝对路径与版本、活动 Ultra 构建、活动语言、文件大小与修改时间、文件哈希和最后已知可用版本。

`state.json` stores only stable facts required for launch: the official absolute path and version, active Ultra build, active locale, file size and modification time, file hashes, and last-known-good build.

状态更新必须先写临时文件、刷新到磁盘，再通过同目录原子重命名替换。启动器永远不会读取半写入状态。

State updates must write a temporary file, flush it to disk, and replace the active file through an atomic same-directory rename. The launcher never reads partially written state.

卸载只移除本项目创建的 PATH 项、目录和状态，不删除用户官方 Codex、认证数据、会话或其他配置。

Removal deletes only PATH entries, directories, and state created by this project. It does not delete the user's official Codex installation, authentication data, sessions, or other configuration.

## 5. 版本与兼容模型 / Version and Compatibility Model

兼容关系分为四层：

Compatibility is separated into four layers:

~~~text
官方 Codex 版本与提交 / upstream version and commit
        |
        v
Ultra 构建修订 / Ultra build revision
        |
        v
i18n API 与消息目录 / i18n API and message catalog
        |
        v
语言包 / language pack
~~~

Ultra Release 清单至少包含：

An Ultra Release manifest contains at least:

~~~json
{
  "schemaVersion": 1,
  "upstreamVersion": "0.144.1",
  "upstreamTag": "rust-v0.144.1",
  "upstreamCommit": "44918ea10c0f99151c6710411b4322c2f5c96bea",
  "ultraRevision": 1,
  "i18nApiVersion": 1,
  "catalogVersion": 1,
  "platform": "x86_64-pc-windows-msvc",
  "executor": {
    "name": "codex-ultra-executor-0.1.0.mjs",
    "size": 123456,
    "sha256": "sha256:..."
  },
  "asset": {
    "name": "codex-ultra-0.144.1-u1-windows-x64.zip",
    "size": 123456789,
    "sha256": "sha256:..."
  },
  "language": {
    "locale": "zh-CN",
    "asset": "codex-ultra-language-zh-CN-v1.zip",
    "size": 1234,
    "sha256": "sha256:..."
  },
  "sourceArchive": {
    "name": "codex-ultra-0.144.1-u1-source.tar.gz",
    "size": 12345678,
    "sha256": "sha256:..."
  },
  "signature": null
}
~~~

语言包清单声明语言包规范版本、BCP 47 locale、兼容的 i18n API 范围、消息目录版本、资源哈希和后备区域。语言包不以某一个 Codex 补丁版本作为唯一兼容依据。

A language-pack manifest declares the language-pack schema version, BCP 47 locale, compatible i18n API range, message-catalog version, resource hashes, and fallback locales. A language pack does not use one Codex patch version as its only compatibility basis.

首期 Ultra 构建只进行精确上游版本匹配。上游提交与适配器指纹在构建流水线中验证；安装器使用官方 npm 包版本、平台包版本和已知发布元数据进行匹配，不假设能从已安装 PE 二进制反推出源码提交。

Initial Ultra builds require an exact upstream version match. The upstream commit and adapter fingerprints are verified in the build pipeline. The installer matches the official npm package version, platform-package version, and known release metadata and does not assume it can recover a source commit from an installed PE binary.

## 6. 安装与更新数据流 / Install and Update Data Flow

显式 `install` 或 `update` 执行以下事务：

An explicit `install` or `update` performs this transaction:

1. 定位官方安装并记录绝对平台二进制路径，避免后续启动递归。

   Locate the official installation and record its absolute platform-binary path to avoid launch recursion.

2. 读取官方版本、平台、架构和指纹。

   Read the official version, platform, architecture, and fingerprints.

3. 查询兼容 Release；没有精确匹配时停止安装，不改变现有活动状态。

   Query compatible Releases. If no exact match exists, stop without changing active state.

4. 下载 Release 清单、二进制资产、许可证与必要资源到临时目录。

   Download the Release manifest, binary asset, licenses, and required resources into a temporary directory.

5. 校验清单版本、上游版本与提交、平台、资源大小和 SHA-256。

   Validate manifest version, upstream version and commit, platform, resource sizes, and SHA-256 values.

6. 验证语言包清单、FTL、消息键、参数、后备区域和资源哈希。

   Validate the language-pack manifest, FTL, message keys, arguments, fallback locales, and resource hashes.

7. 在隔离目录运行 `--version`、i18n 自检、英文回退和选定中文消息冒烟测试。

   Run `--version`, i18n self-check, English fallback, and selected Chinese-message smoke tests in isolation.

8. 将完整构建移动到不可变版本目录，并原子切换 `state.json` 中的活动指针。

   Move the complete build into an immutable version directory and atomically switch the active pointer in `state.json`.

9. 保留当前版本和上一个最后已知可用版本；其他历史版本只由显式清理命令删除。

   Retain the current build and the previous last-known-good build. Older builds are deleted only by an explicit cleanup command.

下载、解压、校验或冒烟测试任一步骤失败时，临时目录可以清理，但当前活动版本和 PATH 不得改变。

If download, extraction, validation, or smoke testing fails, the temporary directory may be cleaned, but the active version and PATH must remain unchanged.

## 7. 启动数据流 / Launch Data Flow

每次运行 `codex` 时，启动器执行本地快速路径：

Each `codex` invocation follows a local fast path:

1. 读取并验证 `state.json` 的最小结构。若状态不存在或损坏，使用排除 Ultra 自有 PATH 目录的确定性解析器重新发现官方 npm 安装；不能安全发现时给出修复命令。

   Read and validate the minimal `state.json` structure. If state is missing or damaged, deterministically rediscover the official npm installation while excluding the Ultra-owned PATH directory. If safe discovery fails, provide a repair command.

2. 读取官方 npm `package.json` 或等价轻量版本来源，检测官方版本是否变化。

   Read the official npm `package.json` or an equivalent lightweight version source to detect upstream changes.

3. 若活动 Ultra 构建严格匹配，比较安装时记录的文件大小和修改时间。元数据未变化时直接启动；元数据变化时不在启动路径计算大型文件哈希，而是回退官方 Codex，并提示运行 `codex-ultra doctor` 重新验证。

   If the active Ultra build is an exact match, compare its recorded file size and modification time. Launch immediately when metadata is unchanged. If metadata changed, do not hash a large binary on the launch path; fall back to official Codex and suggest `codex-ultra doctor` for full verification.

4. 若版本变化、Ultra 缺失或校验失败，启动记录的官方绝对二进制。

   If the version changed or Ultra is missing or invalid, launch the recorded official absolute binary.

5. 若有效 Ultra 仍存在但官方安装被移除，允许继续运行最后已知可用 Ultra；只有两个二进制都不可用时才失败。

   If a valid Ultra build remains after the official installation is removed, continue using the last-known-good Ultra. Fail only when neither binary is available.

6. 完整转发进程参数、环境、stdio、终端尺寸、信号和退出码。

   Fully forward process arguments, environment, stdio, terminal dimensions, signals, and exit code.

启动器不下载、不更新、不修改安装状态，也不调用 GitHub API。为了避免重复提示，它可以尽力创建以故障指纹命名的微型 notice 标记；标记写入失败不得影响启动。需要修复时只输出简短命令，例如 `codex-ultra doctor` 或 `codex-ultra update`。

The launcher does not download, update, mutate installation state, or call the GitHub API. To avoid repeated notices, it may best-effort create a tiny marker named by the failure fingerprint; marker-write failure must not affect launch. When repair is needed, it prints only a concise command such as `codex-ultra doctor` or `codex-ultra update`.

## 8. 优雅降级契约 / Graceful Degradation Contract

| 故障 / Failure | 必须行为 / Required behavior |
| --- | --- |
| 单条键缺失、参数错误或结果为空 / Missing key, bad arguments, or empty result | 只显示该消息的编译内置英文 / Show compiled-in English for that message only |
| FTL 损坏或语言包无法加载 / Damaged FTL or unloadable pack | Ultra 本次会话完整使用英文 / Run the Ultra session entirely in English |
| 活动 Ultra 二进制缺失或哈希错误 / Missing or hash-invalid active Ultra binary | 启动官方绝对二进制 / Launch the official absolute binary |
| 官方版本升级但没有匹配 Ultra / Upstream upgraded without matching Ultra | 启动新版官方 Codex，并只提示一次 / Launch new official Codex and notify once |
| 下载、安装或更新中断 / Interrupted download, install, or update | 保留现有活动版本，不切换指针 / Preserve the active build and do not switch pointers |
| GitHub 或网络不可用 / GitHub or network unavailable | 使用本地已验证资产 / Use locally verified assets |
| `state.json` 损坏 / Damaged `state.json` | 排除 Ultra PATH 后重新发现官方安装；失败时给出明确修复命令 / Rediscover official installation with the Ultra PATH excluded; provide a clear repair command on failure |
| Ultra 与官方二进制都不可用 / Neither Ultra nor official binary is available | 非零退出并给出诊断命令，不运行未知文件 / Exit non-zero with a diagnostic command and run no unknown file |

单条消息回退只写入去重诊断，不在 TUI 中刷屏。整个语言包失效或官方版本变更的提示，每个故障指纹最多显示一次。

Per-message fallback is recorded only in deduplicated diagnostics and does not spam the TUI. A whole-pack failure or upstream-version change is displayed at most once per failure fingerprint.

## 9. Release 构建与发布 / Release Build and Publication

GitHub Actions 对每个支持目标执行：

GitHub Actions performs the following for each supported target:

1. 检出精确上游标签与提交。

   Check out the exact upstream tag and commit.

2. 应用可审阅、可重复的薄 i18n 补丁。

   Apply the reviewable and reproducible thin i18n patch.

3. 运行 Rust 单元测试、TUI 快照、格式化和聚焦 lint。

   Run Rust unit tests, TUI snapshots, formatting, and focused lint.

4. 构建平台二进制和官方布局需要的伴随资源。

   Build the platform binary and companion resources required by the official layout.

5. 生成 Release 清单、SHA-256、许可证集合、构建元数据和完整对应源码归档。

   Generate the Release manifest, SHA-256 values, license collection, build metadata, and complete corresponding-source archive.

6. 从干净环境安装 Release 资产并运行最终启动冒烟测试。

   Install the Release assets from a clean environment and run final launch smoke tests.

7. 仅在所有验证通过后发布不可变 Release。

   Publish an immutable Release only after all verification passes.

首期完整性依赖 GitHub Release 来源、不可变版本标识和 SHA-256。清单模式预留签名字段，后续可增加 Ed25519 签名或构建证明，而不破坏旧安装器。

Initial integrity relies on the GitHub Release origin, immutable version identifiers, and SHA-256. The manifest schema reserves signature fields so Ed25519 signatures or build attestations can be added later without breaking older installers.

## 10. 更新策略 / Update Policy

普通 `codex` 启动永远不检查更新。`codex-ultra update` 显式执行网络查询、兼容性解析和安装事务。

A normal `codex` launch never checks for updates. `codex-ultra update` explicitly performs network lookup, compatibility resolution, and the installation transaction.

当官方 npm Codex 被用户更新时，启动器只做本地版本比较。若没有已安装的精确匹配 Ultra，则立即回退新版官方 Codex，不尝试继续运行旧 Ultra。

When the user updates the official npm Codex, the launcher performs only a local version comparison. If no exact matching Ultra build is installed, it immediately falls back to the new official Codex and does not attempt to run the old Ultra build.

未来可以增加用户明确开启的定期检查，但默认关闭，且检查结果不能阻塞 Codex 启动。

A user-enabled periodic check may be added later, but it remains disabled by default and its result may never block Codex launch.

## 11. 安全与信任边界 / Security and Trust Boundaries

- 语言包只包含数据，不能执行代码、启动进程或读取任意路径。

  Language packs contain data only and cannot execute code, spawn processes, or read arbitrary paths.

- 安装器只写入项目目录、自己的 PATH 项和明确的临时目录。

  The installer writes only to the project directory, its own PATH entry, and explicit temporary directories.

- 未知版本、未知清单版本、未知平台和哈希不匹配默认拒绝安装。

  Unknown versions, manifest schemas, platforms, and hash mismatches are rejected by default.

- Release 清单不得指定安装根目录之外的目标路径。

  Release manifests may not specify destination paths outside the installation root.

- 解压必须拒绝绝对路径、父目录穿越、符号链接逃逸和重复冲突文件。

  Extraction must reject absolute paths, parent traversal, symlink escape, and duplicate conflicting files.

- 启动器只运行状态文件中带已验证哈希的 Ultra 二进制或安装时记录的官方绝对二进制。

  The launcher runs only a hash-verified Ultra binary from state or the official absolute binary recorded during installation.

## 12. 许可证与源码交付 / Licensing and Source Delivery

Codex 上游采用 Apache-2.0，本项目采用 GPL-3.0。每个修改版二进制 Release 必须保留上游许可证与声明，并提供与二进制精确对应的完整源码、补丁和构建脚本。

Upstream Codex uses Apache-2.0, while this project uses GPL-3.0. Every modified-binary Release must preserve upstream licenses and notices and provide the complete source, patches, and build scripts corresponding exactly to the binary.

对应源码不必包含在用户安装器中，但必须与二进制从同一 Release 或不可变源码标签免费获取。正式发布前应再次进行许可证合规复核。

Corresponding source does not need to be embedded in the user installer, but it must be freely available from the same Release or an immutable source tag. License compliance is reviewed again before a public production release.

## 13. 测试策略 / Testing Strategy

### 13.1 Rust i18n 测试 / Rust i18n Tests

- 有效 FTL 翻译静态消息和 `{duration}` 参数消息。

  Valid FTL translates static messages and the `{duration}` parameterized message.

- 缺失键、空结果、损坏 FTL 和参数不匹配逐条回退英文。

  Missing keys, empty results, damaged FTL, and argument mismatches fall back to English per message.

- 没有语言包时，英文快照与未启用 i18n 的官方渲染一致。

  Without a language pack, English snapshots match official rendering with i18n disabled.

- zh-CN 在窄、中、宽终端下验证 CJK 宽度、换行和截断。

  zh-CN snapshots validate CJK width, wrapping, and truncation at narrow, medium, and wide terminal sizes.

### 13.2 启动器测试 / Launcher Tests

- 精确匹配时选择 Ultra，参数和退出码透明传递。

  Exact matches select Ultra and transparently forward arguments and exit codes.

- Ultra 缺失、损坏或版本不匹配时选择官方绝对二进制。

  Missing, damaged, or mismatched Ultra selects the official absolute binary.

- 官方升级时不运行旧 Ultra。

  An upstream upgrade never runs an older Ultra build.

- 启动路径不产生网络请求或安装状态写入；可选 notice 标记不得参与二进制选择。

  The launch path performs no network requests or installation-state writes; optional notice markers never participate in binary selection.

- 官方与 Ultra 都缺失时安全失败且不递归。

  Missing official and Ultra binaries fail safely without recursion.

### 13.3 安装器与更新测试 / Installer and Update Tests

- 下载中断、错误哈希、路径穿越、未知清单和冒烟失败均不改变活动状态。

  Interrupted downloads, bad hashes, path traversal, unknown manifests, and failed smoke tests leave active state unchanged.

- 重复安装幂等，卸载只删除项目拥有的文件和 PATH 项。

  Repeated installation is idempotent, and removal deletes only project-owned files and PATH entries.

- 离线启动使用缓存资产；离线更新给出清晰错误而不损坏现状。

  Offline launch uses cached assets, while offline update reports a clear error without damaging current state.

- 回滚恢复上一个完整版本及其语言包选择。

  Rollback restores the previous complete build and its language-pack selection.

### 13.4 Release 验证 / Release Verification

- 从干净 Windows 环境安装 GitHub Release 资产。

  Install GitHub Release assets in a clean Windows environment.

- 验证 `codex --version`、中文界面、英文回退、官方回退、卸载和重新安装。

  Verify `codex --version`, localized UI, English fallback, official fallback, removal, and reinstallation.

- Release 源码归档能够复现相同补丁集和版本元数据。

  The Release source archive reproduces the same patch set and version metadata.

## 14. MVP 验收标准 / MVP Acceptance Criteria

首个可安装版本只有在以下全部满足时完成：

The first installable version is complete only when all of the following hold:

- Windows x64 用户通过一个 PowerShell 7 入口安装，不需要本地 Rust 工具链。

  A Windows x64 user installs through one PowerShell 7 entry without a local Rust toolchain.

- 安装后在新终端直接输入 `codex`，进入预编译 Ultra 二进制。

  After installation, entering `codex` in a new terminal launches the prebuilt Ultra binary.

- 外部 zh-CN FTL 至少翻译四条状态栏设置消息和 `加班了 {duration}`。

  External zh-CN FTL translates at least four status-line setup messages and `加班了 {duration}`.

- 删除、损坏语言包或删除单个键时，Codex 仍启动并显示正确英文。

  Deleting or damaging the language pack or one key still launches Codex with correct English.

- 破坏 Ultra 二进制或模拟官方版本升级时，启动器运行官方 Codex。

  Damaging the Ultra binary or simulating an upstream upgrade makes the launcher run official Codex.

- 启动时断网不影响已安装版本。

  Disconnecting the network does not affect the installed version at launch.

- `doctor` 能解释当前官方版本、Ultra 版本、locale、哈希、活动路径和任何回退原因。

  `doctor` explains the current official version, Ultra version, locale, hashes, active path, and any fallback reason.

- 卸载后官方 `codex` 恢复，用户认证、会话和配置不受影响。

  After removal, official `codex` is restored and user authentication, sessions, and configuration are unaffected.

## 15. 与现有文档的关系 / Relationship to Existing Documents

本设计扩展 `docs/i18n/foundation-design.md` 的 Rust 桥、语言包和英文回退原则，并固定之前未确定的二进制构建、并排安装、Release、启动器和升级架构。

This design extends the Rust bridge, language-pack, and English-fallback principles in `docs/i18n/foundation-design.md` and fixes the previously unresolved binary build, side-by-side installation, Release, launcher, and upgrade architecture.

现有 `docs/superpowers/plans/2026-07-12-i18n-mvp.md` 中的文本目录和适配器测试思想仍然有效，但其本地源码工作树启动和预格式化静态 JSON 运行时方案已被本文取代。该计划不得直接执行，必须根据本文重写。

The catalog and adapter-testing ideas in `docs/superpowers/plans/2026-07-12-i18n-mvp.md` remain useful, but its local source-worktree launch and preformatted static-JSON runtime are superseded by this design. That plan must not be executed directly and must be rewritten against this document.
