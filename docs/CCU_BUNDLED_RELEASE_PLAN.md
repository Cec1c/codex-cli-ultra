# CCU 自包含安装包合同

## 目标

用户只从 `Cec1c/codex-cli-ultra` Release 下载一个 Windows x64 ZIP，解压后启动其中的安装脚本，即可让新终端中的 `codex` 命令稳定指向带中文 FTL 的 CCU Codex。安装过程不要求用户另外前往 fork Release 下载二进制。

## 目标包结构

```text
codex-cli-ultra-v0.1.2-windows-x64/
├─ install.ps1
├─ install.cmd
├─ uninstall.ps1
├─ uninstall.cmd
├─ bin/
│  ├─ codex-ultra.mjs
│  ├─ launcher.mjs
│  └─ ccu-manager.exe
├─ fork-release/
│  ├─ ccu-fork-manifest.json
│  └─ codex-ccu-i18n-*.zip
├─ content/
│  ├─ languages/zh-CN/
│  ├─ catalog/tui-messages.jsonl
│  ├─ catalog/messages.en-US.ftl
│  ├─ themes/ccu-hermes/
│  └─ quota.example.json
├─ README.md
└─ LICENSE
```

其中 `fork-release` 必须来自已经发布且验证通过的 `Cec1c/codex` fork Release。CCU 打包 workflow 下载并核对 fork manifest、文件大小和 SHA256，再把原始 Release 资产装入 CCU ZIP；不在 CCU 仓库重复编译 Codex。

## 安装行为

1. 优先读取安装包内的 fork manifest 和 `codex.exe`，默认安装不访问网络。
2. 校验内部 fork ZIP、manifest、FTL、英文模板、主题和内容目录。
3. 发现已有官方 npm Codex 时记录为英文备份，但不修改或删除它。
4. 即使没有预装官方 npm Codex，也允许 CCU 二进制完成首次安装；是否额外打包官方英文二进制作为离线备份，在下一期实现前单独确认。
5. 原子写入 CCU 安装目录和状态文件，安装 `codex`、`codex-ultra`、`ccu-manager` shim。
6. 把 CCU `bin` 放到用户 PATH 中官方 npm shim 之前；不修改系统级 PATH。
7. 安装时询问是否启用 `ccu.hermes` 四段式状态栏，默认关闭；启用时备份并原子更新 `[tui].status_line` 与 `status_line_use_colors`，禁用时仅恢复仍由 CCU 管理的值。
8. 不结束运行中的 Codex。旧 CCU 版本被占用时由隐藏清理器等待会话自然退出后删除。

## 卸载行为

1. `uninstall.cmd` 或 `codex-ultra uninstall` 先从用户 PATH 移除 CCU `bin`。
2. 将活动 CCU 版本清空，删除由 CCU 管理的语言、主题和状态栏偏好，并安全恢复状态栏配置备份。
3. 无文件锁时，管理器先将安装根原子重命名为 tombstone 并立即删除；存在运行中会话锁时，再由隐藏 PowerShell 清理器等待锁释放后完成同一原子流程。调度失败不会误报成功，也不会部分删除原目录。
4. 不删除、不修改官方 npm Codex，也不结束当前正在运行的 Codex。

## 本机验收

全新临时安装根和真实用户安装都必须验证：

```powershell
Get-Command codex
codex --version
codex --i18n-self-check
codex-ultra status --json
ccu-manager --print-status
```

验收条件：

- `Get-Command codex` 指向 CCU shim；
- `codex --version` 显示 fork 版本，例如 `0.144.5-ccu.i18n.2`；
- i18n 自检返回 `active=true` 和 `locale=zh-CN`；
- 安装失败时保留旧状态和旧 PATH；
- 重复运行安装脚本结果幂等；
- 正常稳定状态只保留当前 CCU 与一份官方英文备份。

v0.1.2 已按此合同完成本机自包含打包、幂等安装、可选 Hermes 配置、卸载回退和安装根清理验证。
