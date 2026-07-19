# Codex CLI Ultra 进度检查点

更新时间：2026-07-19 +08:00

## 战略调整

当前主线已进入 `v0.1.2` 自包含安装交付：fork 自动追踪上游、CCU 自动同步并内置 fork Release、本机安装后由 `codex --yolo` 启动中文 CCU，并可一键卸载回退英文原版。

- fork 自动发布、CCU Release channel、事务更新、PATH 优先级和旧版本清理均已实现。
- Rust TUI 管理器、外部主题包、可选 Hermes 风格状态栏、随机模型 emoji、调色板和欢迎页颜色角色均已实现。
- 交付完成标准是：双仓 PR 合并、fork `0.144.6-ccu.i18n.2` 与 CCU `v0.1.2` Release 发布、本机自包含安装、卸载回退和真实 TUI 验证通过。

2026-07-17 用户确认保留 fork 作为长期二开基础，因此近期主线恢复阶段 B/C，但职责边界已经调整：Rust 机制和自动构建进入 `Cec1c/codex`，CCU 只管理语言包、二进制共存、更新和后续界面预设。

## fork Release 与 CCU 更新契约

- 上游新 Release 不能通过跨仓库 `release` 事件直接触发；fork 使用每 6 小时轮询和手动触发。
- fork release tag 使用 `ccu-rust-vX.Y.Z-rN`，二进制版本使用 `X.Y.Z-ccu.i18n.N`。
- release 分支从上游 `rust-vX.Y.Z` tag 建立，再重放 fork 独有提交；冲突时开 issue 并停止，不 force-push。
- fork 发布 `ccu-fork-manifest.json`、Windows x64 ZIP 和 SHA256；CCU 从 `Cec1c/codex` latest Release 读取 manifest。
- CCU 的 `version/status` 同时显示 CCU 版本、fork 显示版本、上游版本/tag/commit、fork commit 和 i18n API。
- `update` 先比较上游版本，再比较同上游版本的 revision，因此支持 `0.144.5 r1 -> r2` 和 `0.144.5 -> 0.145.0`。

## 当前分支

- CCU 工作树：`D:\codex-cli-ultra\.worktrees\ftl-template-coverage`，分支 `feat/hermes-statusline-install`。
- fork 工作树：`D:\codex-cli-ultra\.worktrees\fork-main-integration`，分支 `feat/hermes-statusline-i18n`。
- 两个分支均基于已合并昨天成果的 `origin/main`，本轮收口 1396 条 FTL、Hermes 状态栏自动配置、命令二级界面汉化、markerless 残留恢复和安全卸载。

## i18n 演示 MVP 已完成

- Rust TUI 使用 Fluent 加载外部 FTL；区域、资源或单条消息失败时回退编译进二进制的英文。
- 129 条上游真实可见文本已接入中文；隐藏自检覆盖 133 条消息：
  - 状态栏设置 4 条；
  - 工作时长 1 条；
  - 登录引导 6 条；
  - 原生斜杠命令说明 51 条；
  - `/status` 状态卡标签与提示 21 条；
  - 命令面板空状态 1 条；
  - 审批标题与常用选项 20 条；
  - 启动会话卡片、提示、MCP 前缀、用量网址提示、输入占位文本、Context/Token 状态和未知命令错误共 25 条。
- Ultra 另有 `/language` 选择器、主题/状态栏配置、额度状态和首次会话帮助文本。
- 新增 `/language`：
  - `/language` 显示当前语言和用法；
  - `/language zh-CN` 与 `/language en` 保存偏好；
  - 重启 Codex 后生效，MVP 暂不实现运行时热切换。
- launcher 只注入 `CODEX_CCU_LANGUAGE_PACK_ROOT=<CCU install root>/languages`；语言选择、偏好和坏包诊断由 fork Rust 层负责。
- 适配器可受控修改 29 个文件，新增覆盖启动卡片、tooltips、composer、MCP 启动、状态条/footer 和未知斜杠命令入口，并保留此前的斜杠命令、登录引导、`/status` 与审批覆盖。
- 已创建 GitHub fork `https://github.com/Cec1c/codex`；本地部分克隆位于 `.upstream/codex`，由 Ultra 的 `.gitignore` 默认排除。`origin` 指向个人 fork，`upstream` 指向 `openai/codex`。
- 官方 Codex 版本变化时，完整性正常的 Ultra 可进入 `optimistic coexistence` 模式继续运行，同时明确提示不宣称与新版官方 Codex 功能对齐。
- installer 使用 fork Release manifest 与 i18n API 合同，支持同上游 revision 更新和跨上游版本更新。
- 仅保留官方 npm 英文备份与一个当前 CCU Release；launcher PATH 优先级保证 `codex` 默认进入 CCU。
- Rust 管理器提供状态、语言包、主题包页面；内容同步会把历史 `zh-Hans` 偏好迁移为 `zh-CN`。

## FTL 模板与中文包收口

- 新增 `templates/languages/messages.en-US.ftl`，作为不安装到运行时的英文翻译模板。
- 英文模板与 `zh-CN` 包统一为 1396 个实际使用的消息键，校验器要求键集合、Fluent 变量集合和资源 SHA256 完全一致。
- 129 条上游源码消息目录已在原始 `rust-v0.144.5` / `87db9bc18ba5bc82c1cb4e4381b44f693ee35623` 上重新提取，保留真实源码行号和指纹。
- CCU 内容同步与 Release 内容包会携带模板，并在写入安装目录前校验全部 1396 个键；目录级 smoke test 保留上游可追溯消息证据。
- `/model`、Tips、命令列表和二级界面的调用点已进入 fork 分支；仅修改既有 FTL 文案时仍无需重新编译 Codex。
- 自包含安装已实现：CCU ZIP 内置 fork manifest/资产、安装/卸载脚本、FTL、模板、主题和管理器。
- 状态栏 `ContextTokens` 已从 session 累计令牌改为 `last_token_usage.tokens_in_context_window()`；`11.6M/353K` 回归为 `42.7K/353K`，百分比仍为 9%。
- `ccu.hermes` 四段式状态栏安装时可选，默认关闭；启用后自动备份并写入 `[tui].status_line`，禁用或卸载时安全恢复，用户后续修改不会被覆盖。

## 已完成验证

- 全新 Codex `0.144.4` 上游工作树重放：adapter `plan/apply` 成功，共 29 个受控文件；相对 0.144.1 未出现 i18n 调用点锚点漂移。
- Node 全量测试：`234/234` 通过，覆盖可选状态栏、markerless 残留接管、自包含安装、幂等重装和原子卸载。
- Rust i18n 聚焦测试：`15/15` 通过。
- Rust slash command 聚焦测试：`5/5` 通过；command popup 测试：`15/15` 通过。
- `npm run build` 成功生成 launcher 与管理 bundle。
- 构建后的 `dist/codex-ultra.mjs version` 已实际启动通过，避免只验证“能打包、不能运行”。
- fork workflow 已通过 `actionlint`；本地打包脚本已验证 ZIP 内部为 `package/bin/codex.exe`。
- 设置 `CODEX_CCU_BUILD_VERSION=0.144.5-ccu.i18n.1` 后，`cargo check -p codex-cli --locked` 通过；隔离 target 已在验证后删除。
- Debug `codex.exe` 构建成功。
- 正式二进制中文隐藏自检返回 `active=true`、`locale=zh-CN`、133 条消息；YOLO、额度与 `/language` 为中文，FTL 目录缺失时回退英文。
- Rust 定向验证：i18n `15/15`、status line `61/61`、footer `6/6`、session header `5 passed / 1 Windows-only ignored`、theme `2/2`；`cargo fmt --all -- --check` 通过。
- Rust `codex-tui` 全量验证：业务与快照改动已收口；本机 `C:\.git` 会污染 11 项使用 `C:\tmp\project` 的项目根测试，其余 `3091` 项通过。Hermes、feedback、mentions_v2 定向测试分别 `6/6`、`27/27`、`2/2` 通过。
- 两轮可见文本审计完全一致：8 个关键文件、394 个候选；welcome 44、tips/help 18、secondary 43、commands 53；SHA256 `80afdd17aab18cf0db840f1da976b76e24aa724ee1b367ef933f7920cf7a4e7f`。
- v0.1.2 自包含 ZIP 已本地组装并校验，包含 fork r2、`install.cmd`、`uninstall.ps1/cmd`、1396 条 FTL 和 Hermes 主题。
- `git diff --check` 通过。
- 0.144.4 全新工作树首次 Rust 测试编译约 8 分 49 秒，随后 Debug `codex.exe` 构建约 4 分 6 秒；缓存完成后的单组聚焦测试约 4 至 6 秒。

当前保留的演示二进制：

```text
D:\t\artifacts\codex-fork-i18n-main-75c87d4.exe
```

构建时若 `rusty_v8` 下载受阻，使用本机代理：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7890'
$env:HTTP_PROXY = 'http://127.0.0.1:7890'
```

## 发布收口顺序

1. 提交并推送 fork，创建并合并到 `Cec1c/codex:main` 的 PR。
2. 发布 `ccu-rust-v0.144.6-r2`，验证 manifest/ZIP/SHA256。
3. 用真实 fork Release 运行 CCU 安装与更新，检查 PATH、版本、中文 TUI 和“两份保留”合同。
4. 提交并推送 CCU，创建并合并到 `main` 的 PR。
5. 创建 `v0.1.2` tag 和 CCU Release，验证自包含安装 ZIP、SHA256、卸载回退与 stable channel。

## 保护事项

- 主工作树既有删除 `build/languages/zh-CN/compiled-messages.json` 属于原有状态，禁止恢复或纳入本分支。
- 历史适配器仍记录 Codex `0.144.4` 精确提交；正式运行 fork Release 当前基于 `rust-v0.144.5`，不得混淆两条证据链。
- `/language` 是重启生效的 MVP，不是热切换。
- `.upstream/codex` 是独立 fork 工作目录且默认被 Ultra 忽略；不要把完整上游源码提交进 Ultra。
- 本轮用户已明确要求向两个自有仓库提交 PR 并发布 Release；这不代表向 `openai/codex` 创建未经邀请的 PR。

## 2026-07-17 下班检查点

今天已完成：

- 清理历史 `D:\t` 大型 Rust/Codex 构建树；当前仅保留约 `0.353 GiB` 的演示二进制。
- 完成 fork 外部语言包扫描、`/language` 选择器第一批实现和验证。
- 新增 fork 自动跟踪上游稳定 Release 的 workflow、冲突告警、Windows x64 构建、SHA256 和机器 manifest。
- 新增 fork 编译期版本注入：`X.Y.Z-ccu.i18n.N`。
- CCU 新增 fork latest Release 发现、manifest 校验、安装/更新事务、版本与状态显示。
- launcher 从单 FTL 注入迁移为固定语言包目录契约。
- 修复管理 bundle 中 CommonJS 依赖导致的启动崩溃，并增加启动级 smoke test。

当前未完成：

- 两个工作树均未提交、未推送。
- workflow 尚未在 GitHub runner 上真实执行，fork 仍无 GitHub Release。
- 默认在线 `codex-ultra update` 要等首个 fork Release 发布后才可实际下载。

明天恢复入口：

```powershell
cd D:\codex-cli-ultra\.worktrees\i18n-launcher-installer
git status --short
npm test

cd .upstream\codex
git status --short
go run github.com/rhysd/actionlint/cmd/actionlint@latest .github/workflows/ccu-i18n-release.yml
```
