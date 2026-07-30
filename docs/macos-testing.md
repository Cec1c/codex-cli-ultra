# macOS 实机验收清单

这份清单用于 CCU 的 macOS 真人验收。代码和 CI 同时覆盖 Apple Silicon（`macos-arm64`）与 Intel（`macos-x64`），但不能替代 Gatekeeper、终端配置和浏览器联动的真实设备测试。

## 测试信息

记录以下信息后再开始：

- Mac 型号、CPU 架构和 macOS 版本；
- `node --version`、`npm --version`，以及安装前是否能找到 `codex`；
- 下载的 CCU ZIP 文件名和 SHA256；
- 默认 shell（通常为 zsh）及所用终端（Terminal、iTerm2 或 VS Code）。

Apple Silicon 和 Intel 各完成一次为完整验收；只有一类设备时，应明确记录另一类仍由 CI 覆盖、未做实机验证。

## 安装与 Gatekeeper

1. 确认 Node.js 不低于 22.19.0。优先在没有官方 Codex 的环境验证 standalone 安装，并记录 `command -v codex || true`；若设备已有官方版，不需要卸载，只需记录其版本。
2. 下载与 CPU 匹配的 ZIP 和 `.sha256`，运行：

   ```bash
   shasum -a 256 -c codex-cli-ultra-v*-macos-*.zip.sha256
   unzip codex-cli-ultra-v*-macos-*.zip
   cd codex-cli-ultra-v*-macos-*
   xattr -lr . | grep -i quarantine || true
   ./install.sh
   ```

3. 如果 Gatekeeper 拦截，保留完整提示和截图。确认文件来自本项目 Release 且 SHA256 已通过后，才可对解压目录执行：

   ```bash
   xattr -dr com.apple.quarantine .
   ./install.sh
   ```

4. 确认 `~/.zshrc` 中只有一组 CCU PATH 标记；重新运行安装器不应重复追加。
5. 打开全新终端，确认 `command -v codex` 指向 CCU 安装目录。

## 功能验收

依次验证：

```bash
codex --version
codex --i18n-self-check
codex-ultra status --json
ccu-manager
```

在 CCU Manager 中：

- `r` 能刷新本地状态；
- `c` 能查询三个版本通道；
- `o` 能使用默认浏览器打开 `https://github.com/Cec1c/codex-cli-ultra/releases`；
- 状态栏开关、内容同步和 TUI 中英文显示正常；
- 若有比当前版本更新的测试 Release，执行一次 CCU 自动更新，确认 Manager 退出后完成切换并重新打开。

再启动一次 `codex --yolo`，确认中文界面、键盘输入、窗口缩放和退出均正常。

## 卸载与可选官方回退

运行：

```bash
codex-ultra uninstall
exec zsh -l
command -v codex
codex --version
```

验收标准：

- CCU 安装目录已删除；
- `~/.zshrc`、`~/.zprofile` 中没有残留 CCU PATH 标记；
- 安装前有官方版时，`codex` 回到该 npm 版本；安装前没有时，`command -v codex` 不再指向 CCU；
- 原有 Codex 登录和配置仍可用。

报告失败时，请附上失败命令、完整 stderr、`codex-ultra status --json` 输出，以及是否经过 Gatekeeper/quarantine 处理；不要包含 API key、token 或其他凭据。
