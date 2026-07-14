# Plan 2 进度检查点

更新时间：2026-07-14 14:55 +08:00

## 当前分支

- 工作树：`D:\codex-cli-ultra\.worktrees\i18n-launcher-installer`
- 分支：`feat/i18n-launcher-installer`
- Task 1：`1fe85d6 feat: 添加安装状态原子存储`
- Task 2：`18bf201 feat: 完成官方发现与启动目标选择`
- Task 3：`e8e7010 feat: 添加并排 Codex 启动器`
- 以上提交均已推送到 `origin/feat/i18n-launcher-installer`
- 依赖分支：`feat/i18n-runtime-fluent`；PR #2 仍为 OPEN / MERGEABLE，等待人工批准合并

## 已完成

- Plan 1 已完成、测试和复审通过，PR #2 已创建。
- Plan 2 Task 1 已完成、复审通过并推送：严格状态模式、本地盘路径约束、原子写入、flush/rename/目录同步、清理失败显式报告。
- Plan 2 Task 2 已完成并推送：官方 npm Codex 发现、可信本地 PATH 处理、启动目标选择、locale 环境构造、一次性 notice，以及对应测试。
- Task 2 复审补齐了两个边界：`notices` 目录不存在时自动创建；Ultra 安装根完全丢失时仍可安全回退已发现的官方 Codex。
- Plan 2 Task 3 已完成并推送：透明参数/stdio/退出码转发、launcher 主入口、损坏状态恢复、四个 Windows 包装器、esbuild 双 bundle 和依赖边界测试。
- `src/manage-main.mjs` 当前是明确返回退出码 2 的占位入口；Task 6 实现管理命令时替换，不会误称安装/update/doctor 已经可用。

## 已完成验证

- Task 2 聚焦测试通过：47/47。
- Task 3 完成后的全量测试通过：158/158。
- `npm run build` 成功生成 `dist/launcher.mjs` 与 `dist/codex-ultra.mjs`；launcher bundle 不含 release、installer、HTTP、fetch、yauzl 或 Fluent 实现。
- 真实本机官方发现成功：官方 Codex `0.144.3`，平台包 `0.144.3-win32-x64`，解析到 npm 包内绝对 `codex.exe`。
- 真实损坏状态回退成功：临时 Ultra 根下执行 `dist/launcher.mjs --version` 输出一次修复提示并启动 `codex-cli 0.144.3`，退出码 0。
- 无可信二进制探针成功：退出码 127，输出 `codex-ultra doctor` 建议，且未创建测试安装根。
- Task 2 / Task 3 复审后无剩余 Critical / Important。

## 下一次继续时按顺序执行

1. 继续 Task 4：Release manifest、流式 SHA-256、本地/HTTPS provider 和 ZIP 安全解压。
2. Task 4 先补 RED 测试，再引入计划锁定的 `yauzl 3.2.0`、`yazl 3.3.1`；不得把 provider 或解压模块带进 launcher bundle。
3. Task 4 完成后运行 `npm run build`、`npm test`、launcher metafile 边界测试和 `git diff --check`，再正式提交并推送。
4. PR #2 合并后，把 Plan 2 分支更新到 `main`；若尚未合并，可继续同分支 Task 4，但不要创建声称依赖已落地的最终 PR。
5. 随后依次完成 Task 5-7；Task 6 替换 `src/manage-main.mjs` 占位入口。

## 保护事项

- 主工作树既有删除 `build/languages/zh-CN/compiled-messages.json` 属于原有状态，禁止恢复或纳入本分支。
- 官方 Codex、Ultra 二进制和语言包路径只信任本地盘、预期安装根与 canonical 路径。
- 官方版本升级时不得启动旧 Ultra；有效 state 的 official 优先，`recoveredOfficial` 仅用于 state 缺失或损坏。
- 启动环境必须大小写不敏感地清除两个受管 locale 变量，再应用可信 overlay。
- `D:\t` 下约 89.038 GiB 是 Plan 1 Rust 回放/开发 worktree 与 Cargo target 临时产物，不是本分支正式源码，也不是继续 Task 4 的依赖；本检查点未删除这些目录。
