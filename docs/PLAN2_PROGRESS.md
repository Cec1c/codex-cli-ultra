# Plan 2 进度检查点

更新时间：2026-07-13 17:38 +08:00

## 当前分支

- 工作树：`D:\codex-cli-ultra\.worktrees\i18n-launcher-installer`
- 分支：`feat/i18n-launcher-installer`
- 已推送基线：`1fe85d6 feat: 添加安装状态原子存储`
- 依赖分支：`feat/i18n-runtime-fluent`（PR #2，等待人工批准合并）

## 已完成

- Plan 1 已完成、测试和复审通过，PR #2 已创建。
- Plan 2 Task 1 已完成、复审通过并推送：严格状态模式、本地盘路径约束、原子写入、flush/rename/目录同步、清理失败显式报告。
- Plan 2 Task 2 已实现主体：官方 npm Codex 发现、可信本地 PATH 处理、启动目标选择、locale 环境构造、一次性 notice，以及对应测试。

## 当前未完成验证

- 最新改动将 Windows npm 探测改为验证 `npm.cmd`、同目录 `node.exe` 和 `node_modules/npm/bin/npm-cli.js`，再直接执行绝对 `node.exe npm-cli.js root -g`。
- 该最后改动之后尚未重新运行测试。
- `src/discovery/official-codex.mjs` 约第 192-196 行只有对象缩进待整理。
- Task 2 只读复审在本检查点被主动停止，尚无最终 Critical/Important 结论。

## 下一次继续时按顺序执行

1. 整理 `src/discovery/official-codex.mjs` 的对象缩进。
2. 运行聚焦测试：
   `node --test test/installer/state.test.mjs test/launcher/discovery.test.mjs test/launcher/select-target.test.mjs`
3. 运行 `npm test` 和 `git diff --check`。
4. 运行真实本机发现探针，安装根使用 `D:\codex-ultra-live-discovery-check`。
5. 恢复 Task 2 只读复审，关闭全部 Critical/Important。
6. 将 Task 2 整理为正式提交并推送。
7. PR #2 合并后，把 Plan 2 分支更新到 `main`，创建并填写 Plan 2 PR。
8. 继续 Task 3：透明进程启动器和 Windows 包装器；随后依次完成 Task 4-7。

## 保护事项

- 主工作树既有删除 `build/languages/zh-CN/compiled-messages.json` 属于原有状态，禁止恢复或纳入本分支。
- 官方 Codex、Ultra 二进制和语言包路径只信任本地盘、预期安装根与 canonical 路径。
- 官方版本升级时不得启动旧 Ultra；有效 state 的 official 优先，`recoveredOfficial` 仅用于 state 缺失或损坏。
- 启动环境必须大小写不敏感地清除两个受管 locale 变量，再应用可信 overlay。
