# Plan 2 进度检查点

更新时间：2026-07-14 17:27 +08:00

## 当前分支

- 工作树：`D:\codex-cli-ultra\.worktrees\i18n-launcher-installer`
- 分支：`feat/i18n-launcher-installer`
- Task 1：`1fe85d6 feat: 添加安装状态原子存储`
- Task 2：`18bf201 feat: 完成官方发现与启动目标选择`
- Task 3：`e8e7010 feat: 添加并排 Codex 启动器`
- Task 4：`341ab1c feat: 添加 Release 校验与安全解压`
- Task 5：`b370959 feat: 添加事务式安装更新与回滚`
- 以上提交均已推送到 `origin/feat/i18n-launcher-installer`
- 依赖分支：`feat/i18n-runtime-fluent`；PR #2 仍为 OPEN / MERGEABLE，等待人工批准合并

## 已完成

- Plan 1 已完成、测试和复审通过，PR #2 已创建。
- Plan 2 Task 1 已完成、复审通过并推送：严格状态模式、本地盘路径约束、原子写入、flush/rename/目录同步、清理失败显式报告。
- Plan 2 Task 2 已完成并推送：官方 npm Codex 发现、可信本地 PATH 处理、启动目标选择、locale 环境构造、一次性 notice，以及对应测试。
- Task 2 复审补齐了两个边界：`notices` 目录不存在时自动创建；Ultra 安装根完全丢失时仍可安全回退已发现的官方 Codex。
- Plan 2 Task 3 已完成并推送：透明参数/stdio/退出码转发、launcher 主入口、损坏状态恢复、四个 Windows 包装器、esbuild 双 bundle 和依赖边界测试。
- Plan 2 Task 4 已完成并推送：严格 Release manifest、流式 SHA-256、本地/HTTPS provider、GitHub 重定向白名单、Authorization 剥离和 ZIP 安全解压。
- Task 4 将旧计划固定的漏洞版本 `yauzl 3.2.0` 升到兼容修复版 `3.4.0`；`npm audit` 为 0 漏洞。
- Plan 2 Task 5 已完成并推送：事务式安装/update、14 阶段故障注入、不可变目录比较、所有权 marker、PATH 反向恢复、lastKnownGood 和 rollback。
- `src/manage-main.mjs` 当前是明确返回退出码 2 的占位入口；Task 6 实现管理命令时替换，不会误称安装/update/doctor 已经可用。

## 已完成验证

- Task 2 聚焦测试通过：47/47。
- Task 5 完成后的全量测试通过：198/198。
- `npm run build` 成功生成 `dist/launcher.mjs` 与 `dist/codex-ultra.mjs`；launcher bundle 不含 release、installer、HTTP、fetch、yauzl 或 Fluent 实现。
- 真实本机官方发现成功：官方 Codex `0.144.3`，平台包 `0.144.3-win32-x64`，解析到 npm 包内绝对 `codex.exe`。
- 真实损坏状态回退成功：临时 Ultra 根下执行 `dist/launcher.mjs --version` 输出一次修复提示并启动 `codex-cli 0.144.3`，退出码 0。
- 无可信二进制探针成功：退出码 127，输出 `codex-ultra doctor` 建议，且未创建测试安装根。
- Task 5 binary smoke 已验证全部五条 wired 消息：四条状态栏设置文本和一条 `Worked for` 历史文本；有效 FTL 全部为中文，缺失 FTL 全部逐条回退英文。
- 当前官方 Codex 已是 `0.144.3`，现有 Ultra 构建仍精确绑定 `0.144.1`；launcher/installer 会安全拒绝旧 Ultra 并回退官方英文。要在本机真实启用中文，需要另行移植并发布 `0.144.3` Ultra 构建，不能放宽精确版本保护。
- 当前中文覆盖是 5 条 wired / 11 条 catalogued；另外 6 条 onboarding 文本尚未接入 Rust 调用点，Plan 2 后续安装器任务不会自动扩大文本覆盖。
- Task 2-5 复审后无剩余 Critical / Important。

## 下一次继续时按顺序执行

1. 继续 Task 6：locale negotiation、doctor、Windows 用户 PATH 适配器、管理命令路由、安装入口和安全卸载。
2. Task 6 替换 `src/manage-main.mjs` 占位入口，并把 Task 5 当前注入式 PATH 接口接到真实 PowerShell helper。
3. Task 6 必须继续证明普通 launcher bundle 不含 provider、installer、HTTP、fetch、yauzl 或 Fluent 实现。
4. 随后完成 Task 7 的本地 Release fixture E2E；中文验收至少覆盖现有五条 wired 消息，不得只检查 `Worked for` 一条。
5. PR #2 合并后，把 Plan 2 分支更新到 `main`；未获得 `0.144.3` 对应构建前，不声称当前本机已可启用中文 Ultra。

## 保护事项

- 主工作树既有删除 `build/languages/zh-CN/compiled-messages.json` 属于原有状态，禁止恢复或纳入本分支。
- 官方 Codex、Ultra 二进制和语言包路径只信任本地盘、预期安装根与 canonical 路径。
- 官方版本升级时不得启动旧 Ultra；有效 state 的 official 优先，`recoveredOfficial` 仅用于 state 缺失或损坏。
- 启动环境必须大小写不敏感地清除两个受管 locale 变量，再应用可信 overlay。
- `D:\t` 的三个临时 worktree/Cargo 目录已按 Git 登记安全清理，D 盘实际释放约 81.37 GiB；目前只剩一个 0 文件的空 `D:\t` 根目录被外部句柄暂时占用。
