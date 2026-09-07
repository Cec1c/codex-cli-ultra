<div align="center">

# Codex-Cli-Ultra

[![运行时：Node.js 24+](https://img.shields.io/static/v1?label=%E8%BF%90%E8%A1%8C%E6%97%B6&message=Node.js%2024%2B&color=5FA04E&style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![管理器：Rust + Ratatui](https://img.shields.io/static/v1?label=%E7%AE%A1%E7%90%86%E5%99%A8&message=Rust%20%2B%20Ratatui&color=7C3AED&style=flat-square&logo=rust&logoColor=white)](#ccu-manager)
[![语言包：Fluent FTL](https://img.shields.io/static/v1?label=%E8%AF%AD%E8%A8%80%E5%8C%85&message=Fluent%20FTL&color=E66000&style=flat-square)](#语言包格式)
[![平台：Windows / Linux / macOS](https://img.shields.io/static/v1?label=%E5%B9%B3%E5%8F%B0&message=Windows%20%2F%20Linux%20%2F%20macOS&color=0078D4&style=flat-square)](#安装与卸载)

[![Release](https://img.shields.io/github/v/release/Cec1c/codex-cli-ultra?display_name=tag&style=flat-square&label=Release&color=2563EB)](https://github.com/Cec1c/codex-cli-ultra/releases/latest)
[![Stars](https://img.shields.io/github/stars/Cec1c/codex-cli-ultra?style=flat-square&label=Stars&color=E3B341)](https://github.com/Cec1c/codex-cli-ultra/stargazers)
[![许可：GPLv3](https://img.shields.io/static/v1?label=%E8%AE%B8%E5%8F%AF&message=GPLv3&color=2563EB&style=flat-square)](LICENSE)

为 Codex CLI 提供界面本地化、跨平台安装管理，以及可选的主题与状态栏扩展。

CCU 将语言包与 Codex 运行时分开维护，通过 CCU-I18N fork 加载外部 Fluent FTL 翻译。当前参考语言包为简体中文。

[English](README.en.md) ｜ [安装与卸载](#安装与卸载) ｜ [CCU Manager](#ccu-manager) ｜ [文档与贡献](#文档与贡献) ｜ [Linux DO](https://linux.do)

</div>

## 能做什么

- **使用与维护界面翻译。** CCU-I18N 提供 `/language` 和 i18n 接口，每种语言以独立 FTL 包维护。翻译缺失或校验失败时，对应消息回退到内置英文。
- **调整主题与状态栏。** 提供可选的终端界面扩展。全新安装默认启用 Rainbow Color 状态栏，安装时可以关闭；升级会保留已有选择，Hermes 旧主题也继续随包提供。
- **安装和更新 CCU。** Release 包含管理器、语言包、主题及对应平台的 fork 二进制。通过 Manager 或命令行检查版本、更新完整发布包、安装本地 fork Release，以及卸载。
- **了解三个组件的版本。** 分别查看 CCU 本体、CCU-I18N fork 和 OpenAI Codex 的状态。官方 Codex 可以作为可选回退目标，三者的职责与更新方式见[工作原理](#工作原理)。

## 效果演示

当前截图使用简体中文语言包。其他语言可基于 [英文模板](templates/languages/messages.en-US.ftl) 开发，具体流程见 [贡献指南](CONTRIBUTING.md)。

> [!NOTE]
> 截图中的终端背景、字体和配色来自独立的终端配置；CCU 负责图中 Codex 界面的本地化和可选状态栏。

<table>
  <tr>
    <td width="50%"><strong>启动首页</strong><br><img src="docs/assets/readme/home.webp" alt="中文启动首页" width="100%"></td>
    <td width="50%"><strong>斜杠命令</strong><br><img src="docs/assets/readme/slash-commands.webp" alt="中文斜杠命令页面" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><strong>帮助页面</strong><br><img src="docs/assets/readme/help.webp" alt="中文帮助页面" width="100%"></td>
    <td width="50%"><strong>二级页面</strong><br><img src="docs/assets/readme/secondary-screen.webp" alt="中文二级页面" width="100%"></td>
  </tr>
</table>

## 安装与卸载

### 环境要求

- Windows x64、Linux x64/ARM64，或 macOS Intel/Apple Silicon
- Node.js 24 或更高版本
- Windows 安装需要 PowerShell 7；Linux/macOS 安装需要 Bash

> [!IMPORTANT]
> Release ZIP 已包含经过 manifest、文件大小和 SHA256 校验的 fork 二进制，但仍需要本机安装 Node.js 24+。官方 Codex 为可选项：安装 CCU 时若检测到它，会登记为故障回退目标；没有官方版也可以独立使用。

可选：若希望保留官方 Codex 作为回退目标，可先安装：

```powershell
npm install -g @openai/codex
```

### Release 安装（推荐）

1. 从 [Releases](https://github.com/Cec1c/codex-cli-ultra/releases/latest) 下载当前系统对应的 ZIP 和 `.sha256`。
2. 校验 SHA256 并解压 ZIP。
3. 在解压后的目录中，Windows 运行 `install.cmd`；Linux/macOS 运行 `./install.sh`。
4. 打开新终端并验证安装状态：

```powershell
codex --version
codex --i18n-self-check
codex-ultra status
```

`codex --version` 应显示带 `ccu.i18n` 的 fork 版本，`codex --i18n-self-check` 应成功完成自检，`codex-ultra status` 则列出管理器、fork 和官方版的本地状态。随后运行 `codex` 开始使用，或运行 `ccu-manager` 打开管理界面。

需要跳过审批与沙箱时，可以自行选择 `codex --yolo`；它不是验证安装所需的参数。

| 系统 | Release 文件后缀 | 安装入口 |
| --- | --- | --- |
| Windows x64 | `windows-x64.zip` | `install.cmd` |
| Linux x64 | `linux-x64.zip` | `./install.sh` |
| Linux ARM64 | `linux-arm64.zip` | `./install.sh` |
| macOS Intel | `macos-x64.zip` | `./install.sh` |
| macOS Apple Silicon | `macos-arm64.zip` | `./install.sh` |

以下示例使用 `v0.1.24`，下载其他版本时将文件名替换为对应 Release 的名称。

Windows PowerShell 7：

```powershell
$archive = 'codex-cli-ultra-v0.1.24-windows-x64.zip'
$expectedHash = ((Get-Content -LiteralPath "$archive.sha256" -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'SHA256 mismatch'
}
Expand-Archive -LiteralPath $archive -DestinationPath .
Set-Location ($archive -replace '\.zip$', '')
.\install.cmd
```

Linux x64；ARM64 使用 `linux-arm64` 文件：

```bash
archive='codex-cli-ultra-v0.1.24-linux-x64.zip'
sha256sum -c "$archive.sha256" &&
  unzip "$archive" &&
  cd "${archive%.zip}" &&
  ./install.sh
```

macOS Apple Silicon；Intel 使用 `macos-x64` 文件：

```bash
archive='codex-cli-ultra-v0.1.24-macos-arm64.zip'
shasum -a 256 -c "$archive.sha256" &&
  unzip "$archive" &&
  cd "${archive%.zip}" &&
  ./install.sh
```

请使用与系统和架构匹配的 ZIP。安装后打开新终端；也可以在 Bash 中执行 `source ~/.bashrc`，在 zsh 中执行 `source ~/.zshrc`，加载安装器写入的 PATH。

### 卸载

卸载 CCU：

```powershell
codex-ultra uninstall
# 或运行 Release 包中的 uninstall.cmd / ./uninstall.sh
```

卸载会移除 CCU 的命令入口和受其管理的配置。若原先安装了官方 Codex，新终端中的 `codex` 会重新使用官方版；独立安装模式下，卸载不会额外安装官方 Codex。

### 我非要源码安装

源码安装还需要 Rust 工具链：

```powershell
git clone https://github.com/Cec1c/codex-cli-ultra.git
cd codex-cli-ultra
npm ci
.\install.ps1
```

Linux/macOS：

```bash
git clone https://github.com/Cec1c/codex-cli-ultra.git
cd codex-cli-ultra
npm ci
./install.sh
```

本仓库只编译 CCU 管理器，不编译完整的 Codex Rust 项目。运行 CCU-I18N 仍需要符合发布 manifest 的 fork 二进制。

安装器按以下顺序查找 fork Release：

1. `-ForkReleaseDir`（Windows）或 `--fork-release-dir`（Linux/macOS）指定的目录；
2. 仓库根目录的 `fork-release/`；
3. [`Cec1c/codex` Releases](https://github.com/Cec1c/codex/releases) 中的最新稳定版本。

需要自行编译 fork 时，请使用 [`Cec1c/codex`](https://github.com/Cec1c/codex) 仓库。

## CCU Manager

运行 `ccu-manager` 打开基于 Rust / Ratatui 的管理界面。它提供状态与安装、语言包、主题包三个页面，网络与文件任务在后台线程执行。

<p align="center">
  <img src="docs/assets/readme/manager.webp" alt="CCU Manager TUI" width="900">
</p>

| 按键 | 操作 |
| --- | --- |
| `Tab` / `1` / `2` / `3` | 切换状态与安装、语言包、主题包页面 |
| `r` | 刷新本地状态 |
| `c` | 查询 CCU、CCU-I18N 和 OpenAI Codex 的远程版本 |
| `i` | 安装检测到的本地 fork Release |
| `u` | 下载并升级完整 CCU 发布包，包含随包 fork 和内容 |
| `f` | 同步语言包和主题 |
| `o` | 在浏览器中打开 CCU Release 页面 |
| `p` / `Shift+P` | 开关下载代理 / 编辑代理地址 |
| `Esc` | 升级准备过程中请求取消；空闲时退出 |
| `x` | 二次确认卸载 |
| `q` | 退出 |

### 命令行管理

| 命令 | 用途 |
| --- | --- |
| `codex-ultra version` | 查看 CCU 与已安装 fork 的版本 |
| `codex-ultra status --check` | 查看本地状态，并查询三个组件的远端版本 |
| `codex-ultra upgrade check` | 检查完整 CCU 发布包更新 |
| `codex-ultra upgrade` | 升级完整 CCU 发布包 |
| `codex-ultra update` | 用当前管理器安装较新的 fork，并同步已有内容源 |
| `codex-ultra install --release-dir <目录>` | 从本地 Release 目录安装 fork |
| `codex-ultra content sync` | 将已有内容源中的语言包和主题同步到安装目录 |
| `codex-ultra proxy status` | 查看下载代理设置 |

这些管理命令支持 `--json`，便于脚本读取结果。

> [!IMPORTANT]
> `upgrade` 更新完整 CCU 发布包，`update` 更新 fork。希望一并获取新版管理器、语言包和主题时，使用 `codex-ultra upgrade` 或 Manager 的 `u` 键；`content sync` 只同步已有内容源，不会下载新的 CCU 发布包。

## 工作原理

项目分为三个版本通道：

| 组件 | 仓库 | 职责 |
| --- | --- | --- |
| OpenAI Codex | [`openai/codex`](https://github.com/openai/codex) | 官方上游稳定版本 |
| CCU-I18N fork | [`Cec1c/codex`](https://github.com/Cec1c/codex) | Rust/TUI i18n 接口、`/language`、英文回退和编译后的 Codex 二进制 |
| CCU | 本仓库 | 语言包、主题、安装器、管理 TUI、版本同步和 Release 分发 |

```text
OpenAI Codex stable tag
          │
          ▼
CCU-I18N fork ── i18n API + built-in English fallback
          │
          ├── external FTL language packs
          ▼
CCU manager ── install / update / uninstall / sync
```

官方 npm Codex 是可选回退目标；没有官方版时，CCU 以 standalone 状态安装并直接启动已校验的 fork。若已登记官方版且 fork 状态无效，启动器才回退到官方二进制。

是的，这么追着codex的更新其实很累很低效，但相关维护人员暂时并没有理会我的关于添加i18n接口的issues，尽管我当时提交了一版示范

## 项目结构

```text
codex-cli-ultra/
├── .github/workflows/       # CI、Release 和 fork 通道同步
├── docs/                    # 设计、发布合同和项目进度文档
├── packages/
│   ├── languages/zh-CN/     # 简体中文语言包
│   └── themes/              # rainbow_color 默认主题与 Hermes 旧主题
├── release-channels/
│   └── stable.json          # 当前稳定 fork Release 元数据
├── research/                # Codex 可见文本目录与版本调查结果
├── scripts/                 # 构建、审计、打包和同步脚本
├── src/
│   ├── content/             # 语言包与主题内容同步
│   ├── discovery/           # 官方 npm Codex 发现
│   ├── installer/           # 安装、更新、回滚与卸载
│   ├── language/            # FTL 语言包校验
│   ├── launcher/            # 官方版与 fork 的运行时选择
│   ├── release/             # GitHub Release、manifest 和下载校验
│   ├── state/               # 本地安装状态
│   ├── theme/               # 主题包校验与应用
│   └── manage-main.mjs      # codex-ultra 管理命令入口
├── templates/languages/     # 英文 FTL 模板
├── test/                    # Node.js 测试
├── tui/                     # Rust Ratatui 管理器
├── install.ps1 / install.cmd / install.sh
└── uninstall.ps1 / uninstall.cmd / uninstall.sh
```

`dist/`、`tui/target/` 和 `artifacts/` 为构建产物，不是语言包或主题的维护入口。

## 语言包格式

每个语言包包含 manifest 和 FTL 资源：

```text
packages/languages/<locale>/
├── manifest.json
└── messages.ftl
```

```ftl
status-line-configure-title = 配置状态栏
status-line-save-failed = 保存状态栏设置失败：{ $error }
```

基本要求：

- 消息键和 Fluent 变量与 [英文模板](templates/languages/messages.en-US.ftl) 一致；
- manifest 声明 locale、显示名称、许可证、i18n API 范围和资源 SHA256；
- 不完整或无效的消息由运行时回退到内置英文。

校验命令：

```powershell
node src/cli.mjs language validate `
  --pack packages/languages/<locale> `
  --catalog research/codex-0.144.5/tui-messages.jsonl `
  --template templates/languages/messages.en-US.ftl
```

## 版本体系与同步

| 组件 | 版本格式与来源 | 更新内容 |
| --- | --- | --- |
| CCU | `v0.1.24`；源码版本见 [package.json](package.json)，已发布版本见 [Releases](https://github.com/Cec1c/codex-cli-ultra/releases/latest) | 安装器、管理器、内容包与分发 |
| CCU-I18N fork | `X.Y.Z-ccu.i18n.N`；稳定通道记录在 [stable.json](release-channels/stable.json) | 基于上游版本的 Codex 运行时与 i18n 接口 |
| OpenAI Codex | `X.Y.Z`；见[上游 Releases](https://github.com/openai/codex/releases/latest) | 官方上游版本 |

fork 自动化定期检查上游稳定 Release；本仓库的[通道同步工作流](.github/workflows/sync-fork-channel.yml)每 6 小时检查 fork 稳定 Release。发现新的 fork 通道后，会更新元数据、准备下一个 CCU 补丁版本并触发打包。CCU 安装器、管理器或内容包的独立修改可以单独发布，无需重编译 fork。

`stable.json` 表示仓库已同步的稳定通道；某个已下载 ZIP 实际携带的 fork，以该包的 manifest 为准。安装后的实际版本可以用 `codex-ultra version` 查看；排查更新时，用 `codex-ultra status --check` 比较本地与远端状态。

## 当前状态

| 项目 | 状态 |
| --- | --- |
| 支持平台 | Windows x64；Linux x64/ARM64；macOS Intel/Apple Silicon |
| CCU | `v0.1.24` |
| CCU-I18N | [当前稳定通道](release-channels/stable.json)；已安装版本以 `codex-ultra version` 为准 |
| 参考语言包 | 简体中文 `zh-CN` |
| FTL 资源 | 当前英文模板与中文包各包含 1,396 个消息键；新增界面文本仍需在 fork 中接入 |
| 回退机制 | 按消息回退到内置英文 |
| 个性化 | 全新安装默认启用 Rainbow Color 状态栏；已有选择在升级时保留，Hermes 旧主题仍随包提供 |

项目已有 Windows x64 回归与 Linux x64 真环境安装/卸载冒烟记录。五个平台均已提供 Release 资产，Linux ARM64 和两种 macOS 架构已接入构建矩阵。

> [!NOTE]
> macOS 仍需要真人实机验收。CI 构建不能替代 Gatekeeper、终端配置与浏览器联动的设备测试，具体验证步骤见 [macOS 验收清单](docs/macos-testing.md)。

## 文档与贡献

| 内容 | 入口 |
| --- | --- |
| 新语言包、开发检查与仓库职责 | [贡献指南](CONTRIBUTING.md) |
| 英文消息模板与中文参考实现 | [英文 FTL](templates/languages/messages.en-US.ftl) · [中文语言包](packages/languages/zh-CN/) |
| macOS 安装与实机验收 | [验收清单](docs/macos-testing.md) |
| 当前稳定 fork 元数据 | [stable.json](release-channels/stable.json) |
| fork 运行时源码与发行包 | [Cec1c/codex](https://github.com/Cec1c/codex) · [fork Releases](https://github.com/Cec1c/codex/releases) |
| 设计背景与历史进度 | [fork 方案](docs/CCU_I18N_FORK_PLAN.md) · [进度记录](docs/PLAN2_PROGRESS.md) |

设计与进度文档保留了历史阶段的信息；当前安装行为以本文、源码和对应 Release 说明为准。

欢迎提交新的语言包、翻译修正、兼容性报告和界面扩展。其他语言的贡献者可直接使用英文模板、英文 Issue 和英文 Pull Request，不需要了解中文语言包。

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

本项目使用 [GNU General Public License v3.0](LICENSE)。语言包需在 manifest 中单独声明许可证。

## 非官方说明

Codex-Cli-Ultra 是非官方社区项目，与 OpenAI 不存在隶属、赞助或背书关系。Codex 和 OpenAI 是其各自权利人的名称或商标。
