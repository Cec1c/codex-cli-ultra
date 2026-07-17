# CCU、Codex i18n fork 与上游跟踪实施计划

更新时间：2026-07-17 +08:00

## 1. 当前结论

项目采用两个长期分离的仓库，而不是把 Codex 的完整 Rust 源码塞进 CCU：

- `Cec1c/codex` 是跟踪 `openai/codex` 的二开基础，负责所有必须进入 Rust/TUI 的机制。
- `codex-cli-ultra`（CCU）是 JavaScript/TUI 管家，负责语言包、界面预设、二进制安装、版本选择、同步和诊断。
- 普通用户只下载编译后的二开 Codex 二进制和所需资源包，不需要取得几百 MB 的 Codex 源码。
- CCU 开发仓库中的 `.upstream/codex` 只是被忽略的本地维护工作区，不进入 CCU 提交或发布包。

这条路线允许继续向上游提出 issue 或小型 PR，但不再把项目能否成立依赖于上游接受。

## 2. 职责边界

| 部分 | 负责内容 | 明确不负责 |
| --- | --- | --- |
| `openai/codex` | 官方功能、协议和主线演进 | CCU 语言包与二开发布 |
| `Cec1c/codex` fork | 外部 FTL 接口、`/language`、英文回退、语言包兼容检查、通用 UI 扩展点、自动构建发布 | 下载语言包、管理官方与二开安装共存 |
| CCU | 各语言 FTL、语言包清单和校验、包同步与原子安装、二进制下载、官方/二开切换、默认 `codex` 指向、主题和界面预设管理 | 复制或长期内嵌完整 Codex Rust 源码 |

原则是：机制进入 fork，内容和生命周期管理留在 CCU。

## 3. 本地资源约定

默认语言包根目录：

```text
$CODEX_HOME/ccu/languages/
  <locale>/
    manifest.json
    messages.ftl
```

开发和测试时允许用下列变量覆盖根目录：

```text
CODEX_CCU_LANGUAGE_PACK_ROOT
```

第一阶段继续使用 `$CODEX_HOME/ui-language` 保存当前选择，以兼容现有演示实现。后续若 CCU 引入统一状态文件，再提供一次受控迁移，不同时维护两套活动指针。

语言包清单沿用 CCU 已有的 schema 方向，最低字段为：

```json
{
  "schemaVersion": 1,
  "type": "language",
  "id": "codex-cli-ultra.zh-CN",
  "locale": "zh-CN",
  "i18nApi": { "min": 1, "max": 1 },
  "resources": [
    {
      "path": "messages.ftl",
      "sha256": "sha256:..."
    }
  ]
}
```

可选字段可提供显示名、本地名称、版本、作者和许可证。fork 只读取本地文件并检查 schema、类型、locale、i18n API、资源路径、哈希和 FTL 可解析性；联网下载、升级和原子替换全部由 CCU 执行。

## 4. `/language` 行为

- `/language` 无参数时打开与 `/plugins` 同类的上下选择列表。
- 英文始终由二进制内置并作为第一项，不依赖外部语言包。
- fork 扫描语言包根目录；有效且兼容的包可以选择。
- 无效或 i18n API 不兼容的包仍显示在列表中，但禁用并展示原因，便于诊断。
- 选择后保存 locale，并提示重启 Codex 生效；本阶段不伪装成热切换。
- `/language <locale>` 保留，供脚本、键盘用户和故障恢复使用。
- `/language` 本身不访问网络，也不负责安装或更新语言包。
- 整包加载失败时使用英文；单个键或参数格式失败时只对该条消息回退英文。

## 5. 官方版与二开版共存

CCU 不覆盖或修改官方 Codex 安装目录，而是登记两个独立目标：

```text
official -> OpenAI 官方 codex
fork     -> Cec1c/codex 的 CCU i18n 构建
```

JS 执行器负责：

1. 发现已有官方 Codex。
2. 下载并校验 fork release 中对应平台的二进制。
3. 保存活动目标和上一已知可用目标。
4. 通过 CCU 自己的 shim/launcher 决定默认 `codex` 指向。
5. 支持显式启动官方版、二开版、回滚和 doctor 检查。

因此“默认使用二开”不等于替换官方安装，升级失败也不会破坏官方 Codex。

## 6. fork 自动跟踪与发布

`Cec1c/codex` 增加独立 GitHub Actions：

1. GitHub 的 `release` 事件不能订阅其他仓库，因此以每 6 小时 `schedule` 轮询 `openai/codex/releases/latest`，并保留 `workflow_dispatch` 手动补触发。
2. 从上游 `rust-vX.Y.Z` tag 建立临时 release 分支，再按顺序重放 fork 相对 `upstream/main` 的独有提交；不会把含有更前沿主线代码的 fork `main` 直接混入稳定 release。
3. 无冲突时继续验证，有冲突时停止并创建可见 issue；不覆盖已有 release、不 force-push 已存在且不同的 release 分支。
4. 运行格式化、`codex-tui` 聚焦测试、i18n 契约测试和平台构建。
5. 对上游 release 或经维护者确认的同步点生成 CCU i18n 构建版本。
6. 在 fork release 中附加 Windows、Linux、macOS 二进制、SHA256 和机器可读 manifest。

第一阶段版本契约固定为：

```text
上游 tag:       rust-v0.144.5
fork release:   ccu-rust-v0.144.5-r1
二进制显示版本: 0.144.5-ccu.i18n.1
```

同一上游版本若只修复 fork 自身问题，递增 `r2/r3`，不伪造新的上游版本。fork 二进制在编译时注入 `CODEX_CCU_BUILD_VERSION`，因此 `codex --version`、Release manifest 与 CCU 安装状态使用同一个显示版本。

fork Release 的机器 manifest 最小结构为：

```json
{
  "schemaVersion": 1,
  "type": "codex-ccu-i18n-build",
  "releaseTag": "ccu-rust-v0.144.5-r1",
  "displayVersion": "0.144.5-ccu.i18n.1",
  "upstreamVersion": "0.144.5",
  "upstreamTag": "rust-v0.144.5",
  "upstreamCommit": "<40-hex>",
  "forkCommit": "<40-hex>",
  "ultraRevision": 1,
  "i18nApiVersion": 1,
  "platform": "x86_64-pc-windows-msvc",
  "asset": {
    "name": "codex-ccu-i18n-0.144.5-r1-x86_64-pc-windows-msvc.zip",
    "size": 123,
    "sha256": "sha256:<64-hex>"
  }
}
```

CCU 只信任这个 manifest，不根据文件名猜版本；更新顺序先比较上游三段版本，再比较同上游版本内的 `ultraRevision`。

版本状态使用清晰的四类语义：

- `verified coexistence`：CCU 与当前官方安装共存已验证。
- `optimistic coexistence`：上游有更新，但接口和关键锚点尚未发现破坏。
- `known incompatible`：已确认接口、构建或行为不兼容。
- `rebased`：fork 已同步到指定上游提交并通过验证。

## 7. 界面美化是否需要重新构建

不一定，取决于修改层级：

- 自定义语法主题、颜色配置、状态栏项目组合和 fork 已提供的数据化预设，可以由 CCU 下发资源或配置，不必重新构建。
- 新增布局、改变交互状态机、修改组件渲染、增加新的 TUI 小部件，仍然需要修改 Rust 并重新构建 fork。
- 后续应优先在 fork 中增加稳定、通用的数据接口，让 CCU 维护主题和预设；不应让 CCU 对二进制做不可审阅的运行时补丁。

## 8. 分阶段实施

### 阶段 A：fork 外部语言包接口

- 从当前 i18n 演示基线新建功能分支。
- 移除编译进二进制的 `zh-Hans.ftl`。
- 实现 `$CODEX_HOME/ccu/languages` 扫描、manifest/哈希/FTL 校验和英文回退。
- 将 `/language` 无参数行为改为可选择列表，保留内联 locale。
- 为有效包、损坏包、不兼容包和空目录增加测试与 TUI 快照。

### 阶段 B：CCU 语言包管理

- 将现有 `packages/languages/zh-CN` 对齐新的运行时清单。
- 实现语言包索引、下载、校验、临时目录安装、原子切换和回滚。
- 增加 `list/install/update/remove/doctor` 的 JS 服务层，再接入 CCU TUI。
- launcher 启动 fork 时不再注入单个 FTL 路径，只约定语言包根目录。

### 阶段 C：fork 上游跟踪和二进制 release

- 建立上游同步工作流、冲突告警和构建矩阵。
- 发布机器可读 release manifest、各平台二进制和哈希。
- CCU 以 manifest 为唯一下载契约，不猜测 asset 名称。
- 第一批只启用 GitHub 托管的 Windows x64 runner；Linux/macOS 在 Windows 发布链稳定后扩展。

### 阶段 D：共存管理器

- 将官方和 fork 注册为独立 provider。
- 支持设置默认目标、显式启动目标、回滚和 last-known-good。
- 保持 optimistic coexistence；只有真实契约漂移才阻止自动选择。

### 阶段 E：界面预设与通用扩展点

- 盘点现有 theme、statusline、terminal title 等无需构建的配置能力。
- 对确实需要 Rust 支持的美化需求，先在 fork 增加稳定的资源接口。
- CCU 只维护主题/预设内容及安装状态，不维护散落的 Rust UI 补丁。

## 9. 第一阶段验收标准

- fork 二进制不再内置任何非英语 FTL。
- 正确安装的 `zh-CN` 包可被启动时加载。
- `/language` 能列出英文、有效外部包和带原因的禁用包。
- `/language zh-CN` 与列表选择写入相同偏好。
- 缺目录、坏 manifest、坏哈希、坏 FTL、API 不兼容和缺键均不 panic，并按约定回退英文。
- `just fmt`、`just test -p codex-tui` 和快照检查通过。
- CCU 仓库不新增 Codex 源码副本。

## 10. 临时目录清理记录

2026-07-17 已清理 `D:\t` 中约 140 GiB 的历史 Codex/Rust 构建树并注销相关 Git worktree。当前只保留：

```text
D:\t\artifacts\codex-fork-i18n-main-75c87d4.exe
SHA256 f0ae0373cff88ae773edb42faddb04c58485a67e005353a177612dea7e1d099d
```

后续大型 Rust 构建必须复用明确的工作目录和缓存，并在验证完成后清理临时 target/replay 树，避免再次把 `D:\t` 当作无生命周期的构建仓库。

## 11. 2026-07-17 实施进度

已在 fork 分支 `feat/ccu-external-language-packs` 完成阶段 A 的第一批代码：

- 删除编译进二进制的 `codex-rs/tui/i18n/zh-Hans.ftl`。
- 新增 `$CODEX_HOME/ccu/languages` 与 `CODEX_CCU_LANGUAGE_PACK_ROOT` 语言包发现。
- 实现 schema、类型、locale、i18n API、`messages.ftl` SHA256、UTF-8 和 Fluent 语法检查。
- 英文保持内置；整包失效回退英文；重复 locale 和不兼容包禁用并提供原因。
- `/language` 无参数改为上下选择列表；`/language <locale>` 保留并使用同一偏好文件。
- 新增选择器快照，以及外部包、哈希错误、API 不兼容、别名和偏好写入测试。
- CCU 的 `zh-CN` manifest 已增加中英文显示名，FTL 已增加选择器文案并更新资源哈希。

当前验证：

- Rust i18n 聚焦测试：15/15 通过。
- `/language` 列表与内联选择测试：2/2 通过。
- 原有侧会话 `/language` 允许列表断言已对齐并单测通过。
- `just fix -p codex-tui`、`just fmt`、`cargo fmt --all -- --check` 和 `git diff --check` 通过。
- `codex-tui` 全量测试实际运行 3090 项；首次结果为 3069 通过、21 失败，其中 2 个与 `/language` 相关的断言已随后修复并分别通过。剩余 19 个是当前 Windows 环境下既有的 home 路径缩写和状态卡快照差异，未接受或改写这些无关快照。
- CCU Node 测试：206/206 通过；`npm run build` 和构建后管理 bundle 启动通过；`zh-CN` 语言包校验通过。

阶段 B/C 第一批已经完成；下一批工作转为提交边界整理、推送 checkpoint 和 GitHub runner 首次真实 Release 验证。

### 阶段 B/C 新增进度

- fork 已新增 `CCU i18n release` workflow：轮询上游稳定 Release、从上游 tag 重放 fork 独有提交、冲突开 issue、Windows x64 测试构建并发布机器 manifest。
- fork CLI 已支持编译期 `CODEX_CCU_BUILD_VERSION`，官方构建未设置时仍保持原版 Cargo 版本行为。
- CCU 已新增 fork manifest 校验和 GitHub latest Release 解析，支持同一上游版本 `r1 -> r2` 与跨上游版本比较。
- CCU 管理执行器已接入 `version`、`status --check`、`install`、`update`，安装状态显示 fork 显示版本、上游 tag/commit、fork commit 和 i18n API。
- 新 fork 安装路径不再依赖 `STABLE_COMMITS` 硬编码；旧的整包实验安装器仍保留精确官方版本校验。
- launcher 已迁移为只注入 `CODEX_CCU_LANGUAGE_PACK_ROOT=<CCU install root>/languages`；语言选择和坏包诊断由 fork Rust 层统一处理。
- 当前代码尚未推送或实际创建 GitHub Release；workflow 必须先合入 fork 默认分支才会按计划定时执行。

## 12. 2026-07-17 下班状态

- 阶段 A 第一批、fork Release workflow、编译期版本和 CCU 更新/状态链路均已在本地工作树实现。
- 最终验证：CCU Node `206/206`、管理 bundle 启动、Rust `codex-cli` check、workflow `actionlint`、本地 Release ZIP/manifest 布局全部通过。
- 今天没有提交、推送、合并默认分支或发布 GitHub Release。
- 明天优先做提交边界检查与分仓 checkpoint，然后用 GitHub runner 手动验证首个 `ccu-rust-v0.144.5-r1`。
