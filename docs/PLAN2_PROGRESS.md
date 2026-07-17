# Codex CLI Ultra 进度检查点

更新时间：2026-07-17 +08:00

## 战略调整

当前主线从“持续扩建安装器并追随每个官方版本”收敛为“尽快完成可运行、可演示、可向上游讨论的 i18n MVP”。

- 暂停继续扩大 Task 6/7、自动更新、CI/CD 和跨版本安装策略。
- 保留现有安装器与 launcher 代码作为实验资产，不再把它们视为近期成功标准。
- 近期成功标准是：真实 TUI 文本可翻译、英文逐条回退、`/language` 可选择语言、全新上游源码可重放适配器、演示二进制可构建。
- 上游贡献先走 issue 讨论。`openai/codex` 的贡献指南明确规定外部 PR 仅限维护者邀请，未经邀请的 PR 会直接关闭。
- 若维护者认可方向，首个上游 PR 只提交最小 i18n scaffold、语言入口和少量代表性文本，不包含 Ultra 安装器、兼容 launcher 或发布系统。

2026-07-17 用户确认保留 fork 作为长期二开基础，因此近期主线恢复阶段 B/C，但职责边界已经调整：Rust 机制和自动构建进入 `Cec1c/codex`，CCU 只管理语言包、二进制共存、更新和后续界面预设。

## fork Release 与 CCU 更新契约

- 上游新 Release 不能通过跨仓库 `release` 事件直接触发；fork 使用每 6 小时轮询和手动触发。
- fork release tag 使用 `ccu-rust-vX.Y.Z-rN`，二进制版本使用 `X.Y.Z-ccu.i18n.N`。
- release 分支从上游 `rust-vX.Y.Z` tag 建立，再重放 fork 独有提交；冲突时开 issue 并停止，不 force-push。
- fork 发布 `ccu-fork-manifest.json`、Windows x64 ZIP 和 SHA256；CCU 从 `Cec1c/codex` latest Release 读取 manifest。
- CCU 的 `version/status` 同时显示 CCU 版本、fork 显示版本、上游版本/tag/commit、fork commit 和 i18n API。
- `update` 先比较上游版本，再比较同上游版本的 revision，因此支持 `0.144.5 r1 -> r2` 和 `0.144.5 -> 0.145.0`。

## 当前分支

- 工作树：`D:\codex-cli-ultra\.worktrees\i18n-launcher-installer`
- 分支：`feat/i18n-launcher-installer`
- 已推送检查点：`a1c3de3 docs: 更新 Plan 2 Task 5 检查点`
- Rust Fluent 运行时 PR #2 已于 2026-07-15 合并到 `main`。
- 本分支包含 PR #2 的运行时提交，但尚未合入 `origin/main` 的 merge commit `bf41be7`。
- 当前 i18n 演示改动尚未提交。

## i18n 演示 MVP 已完成

- Rust TUI 使用 Fluent 加载外部 FTL；区域、资源或单条消息失败时回退编译进二进制的英文。
- 129 条上游真实可见文本已接入中文：
  - 状态栏设置 4 条；
  - 工作时长 1 条；
  - 登录引导 6 条；
  - 原生斜杠命令说明 51 条；
  - `/status` 状态卡标签与提示 21 条；
  - 命令面板空状态 1 条；
  - 审批标题与常用选项 20 条；
  - 启动会话卡片、提示、MCP 前缀、用量网址提示、输入占位文本、Context/Token 状态和未知命令错误共 25 条。
- Ultra 另有 `/language` 说明和 4 条语言选择提示，FTL 共 134 个简洁 kebab-case 键。
- 新增 `/language`：
  - `/language` 显示当前语言和用法；
  - `/language zh-CN` 与 `/language en` 保存偏好；
  - 重启 Codex 后生效，MVP 暂不实现运行时热切换。
- launcher 只注入 `CODEX_CCU_LANGUAGE_PACK_ROOT=<CCU install root>/languages`；语言选择、偏好和坏包诊断由 fork Rust 层负责。
- 适配器可受控修改 29 个文件，新增覆盖启动卡片、tooltips、composer、MCP 启动、状态条/footer 和未知斜杠命令入口，并保留此前的斜杠命令、登录引导、`/status` 与审批覆盖。
- 已创建 GitHub fork `https://github.com/Cec1c/codex`；本地部分克隆位于 `.upstream/codex`，由 Ultra 的 `.gitignore` 默认排除。`origin` 指向个人 fork，`upstream` 指向 `openai/codex`。
- 官方 Codex 版本变化时，完整性正常的 Ultra 可进入 `optimistic coexistence` 模式继续运行，同时明确提示不宣称与新版官方 Codex 功能对齐。
- installer 仍保持精确版本安装策略；本阶段不继续放宽它。

## 已完成验证

- 全新 Codex `0.144.4` 上游工作树重放：adapter `plan/apply` 成功，共 29 个受控文件；相对 0.144.1 未出现 i18n 调用点锚点漂移。
- Node 全量测试：`206/206` 通过。
- Rust i18n 聚焦测试：`10/10` 通过。
- Rust slash command 聚焦测试：`5/5` 通过；command popup 测试：`15/15` 通过。
- `npm run build` 成功生成 launcher 与管理 bundle。
- 构建后的 `dist/codex-ultra.mjs version` 已实际启动通过，避免只验证“能打包、不能运行”。
- fork workflow 已通过 `actionlint`；本地打包脚本已验证 ZIP 内部为 `package/bin/codex.exe`。
- 设置 `CODEX_CCU_BUILD_VERSION=0.144.5-ccu.i18n.1` 后，`cargo check -p codex-cli --locked` 通过；隔离 target 已在验证后删除。
- Debug `codex.exe` 构建成功。
- 中文隐藏自检返回 130 条可翻译消息和 1 条缺键回退探针；FTL 缺失时，同一批消息返回原始英文。
- Rust 定向验证：i18n `10/10`、斜杠命令 `5/5`、审批 `34/34`、命令面板 `15/15`、MCP `17/17`、启动卡片 `4 passed / 1 Windows-only ignored`；`cargo fmt --all -- --check` 通过。
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

## 下一步

1. 检查两个工作树的提交边界，把既有阶段 A 与今天新增的阶段 B/C 分成可审查提交。
2. 推送 `feat/ccu-external-language-packs` 与 `feat/i18n-launcher-installer` 检查点；暂不直接创建 Release。
3. fork 功能分支确认后合入默认分支，手动触发一次 `rust-v0.144.5 / r1`，观察云端 Windows x64 构建和 Release 资产。
4. 用真实 `ccu-fork-manifest.json` 验证 CCU 的 `status --check`、首次安装、`r1 -> r2` 更新和 last-known-good。
5. 再继续语言包同步/原子安装管理；Linux/macOS 构建矩阵和界面预设后置。
6. 上游 issue/PR 仍是并行可选路径，不再作为 fork 和 CCU 能否成立的前置条件。

## 保护事项

- 主工作树既有删除 `build/languages/zh-CN/compiled-messages.json` 属于原有状态，禁止恢复或纳入本分支。
- 当前适配器只支持 Codex `0.144.4` 精确提交 `8c68d4c87dc54d38861f5114e920c3de2efa5876`；`optimistic coexistence` 只表示 Ultra 可以与更新的官方安装并存，不表示源码或功能对齐。
- `/language` 是重启生效的 MVP，不是热切换。
- `.upstream/codex` 是独立 fork 工作目录且默认被 Ultra 忽略；不要把完整上游源码提交进 Ultra。
- 不实际发布 issue 评论、不创建上游 PR，除非用户明确确认。

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
