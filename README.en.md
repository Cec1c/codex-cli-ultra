<div align="center">

# Codex-Cli-Ultra

[![Runtime: Node.js 24+](https://img.shields.io/static/v1?label=Runtime&message=Node.js%2024%2B&color=5FA04E&style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Manager: Rust + Ratatui](https://img.shields.io/static/v1?label=Manager&message=Rust%20%2B%20Ratatui&color=7C3AED&style=flat-square&logo=rust&logoColor=white)](#ccu-manager)
[![Language packs: Fluent FTL](https://img.shields.io/static/v1?label=Language%20packs&message=Fluent%20FTL&color=E66000&style=flat-square)](#language-pack-format)
[![Platforms: Windows / Linux / macOS](https://img.shields.io/static/v1?label=Platforms&message=Windows%20%2F%20Linux%20%2F%20macOS&color=0078D4&style=flat-square)](#installation-and-removal)

[![Release](https://img.shields.io/github/v/release/Cec1c/codex-cli-ultra?display_name=tag&style=flat-square&label=Release&color=2563EB)](https://github.com/Cec1c/codex-cli-ultra/releases/latest)
[![Stars](https://img.shields.io/github/stars/Cec1c/codex-cli-ultra?style=flat-square&label=Stars&color=E3B341)](https://github.com/Cec1c/codex-cli-ultra/stargazers)
[![License: GPLv3](https://img.shields.io/static/v1?label=License&message=GPLv3&color=2563EB&style=flat-square)](LICENSE)

Interface localization, cross-platform installation management, and optional themes and status-line extensions for Codex CLI.

CCU maintains language packs separately from the Codex runtime. The CCU-I18N fork loads external Fluent FTL translations, with Simplified Chinese as the current reference language pack.

[简体中文](README.md) ｜ [Installation](#installation-and-removal) ｜ [CCU Manager](#ccu-manager) ｜ [Docs and Contributing](#documentation-and-contributing) ｜ [Linux DO](https://linux.do)

</div>

## What it does

- **Use and maintain interface translations.** CCU-I18N provides `/language` and an i18n interface, allowing each locale to be maintained as an independent FTL package. Missing or invalid translations fall back to built-in English per message.
- **Customize themes and the status line.** Terminal interface extensions are optional. Fresh installs enable the Rainbow Color status line by default, with an option to disable it during installation. Upgrades preserve existing choices, and the legacy Hermes theme remains bundled.
- **Install and update CCU.** Each Release includes the manager, language packs, themes, and a fork binary for the selected platform. Use the Manager or CLI to check versions, upgrade the full package, install a local fork Release, or remove CCU.
- **Track three components.** Inspect CCU, the CCU-I18N fork, and OpenAI Codex separately. Official Codex can serve as an optional fallback; see [Architecture](#architecture) for their responsibilities and update paths.

## Demo

The current screenshots use the Simplified Chinese language pack. Other locales can be built from the [English template](templates/languages/messages.en-US.ftl); see [CONTRIBUTING.md](CONTRIBUTING.md).

> [!NOTE]
> The terminal background, font, and colors are provided by a separate terminal configuration. CCU provides the localized Codex interface and the optional status line shown in the screenshots.

<table>
  <tr>
    <td width="50%"><strong>Home</strong><br><img src="docs/assets/readme/home.webp" alt="Localized home screen" width="100%"></td>
    <td width="50%"><strong>Slash commands</strong><br><img src="docs/assets/readme/slash-commands.webp" alt="Localized slash commands" width="100%"></td>
  </tr>
  <tr>
    <td width="50%"><strong>Help</strong><br><img src="docs/assets/readme/help.webp" alt="Localized help screen" width="100%"></td>
    <td width="50%"><strong>Secondary screen</strong><br><img src="docs/assets/readme/secondary-screen.webp" alt="Localized secondary screen" width="100%"></td>
  </tr>
</table>

## Installation and removal

### Requirements

- Windows x64, Linux x64/ARM64, or macOS Intel/Apple Silicon
- Node.js 24 or newer
- PowerShell 7 on Windows; Bash on Linux and macOS

> [!IMPORTANT]
> The Release ZIP includes a fork binary verified against its manifest, file size, and SHA256. Node.js 24+ must still be installed on your system. Official Codex is optional: if detected during installation, CCU records it as a failure fallback; CCU can also run independently without it.

Optional: install official Codex first if you want to retain it as a fallback:

```powershell
npm install -g @openai/codex
```

### Release installation (recommended)

1. Download the ZIP for your platform and its `.sha256` from [Releases](https://github.com/Cec1c/codex-cli-ultra/releases/latest).
2. Verify the SHA256 and extract the ZIP.
3. From the extracted directory, run `install.cmd` on Windows or `./install.sh` on Linux/macOS.
4. Open a new terminal and verify the installation:

```powershell
codex --version
codex --i18n-self-check
codex-ultra status
```

`codex --version` should report a fork version containing `ccu.i18n`, and `codex --i18n-self-check` should complete successfully. `codex-ultra status` lists the local manager, fork, and official Codex state. Then run `codex` to start a session, or `ccu-manager` to open the management interface.

If you choose to bypass approvals and the sandbox, `codex --yolo` remains available. It is not required to verify the installation.

| System | Release suffix | Installer |
| --- | --- | --- |
| Windows x64 | `windows-x64.zip` | `install.cmd` |
| Linux x64 | `linux-x64.zip` | `./install.sh` |
| Linux ARM64 | `linux-arm64.zip` | `./install.sh` |
| macOS Intel | `macos-x64.zip` | `./install.sh` |
| macOS Apple Silicon | `macos-arm64.zip` | `./install.sh` |

The examples below use `v0.1.24`. When downloading another version, replace the filenames with those from that Release.

Windows PowerShell 7:

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

Linux x64; use the `linux-arm64` file for ARM64:

```bash
archive='codex-cli-ultra-v0.1.24-linux-x64.zip'
sha256sum -c "$archive.sha256" &&
  unzip "$archive" &&
  cd "${archive%.zip}" &&
  ./install.sh
```

macOS Apple Silicon; use the `macos-x64` file for Intel:

```bash
archive='codex-cli-ultra-v0.1.24-macos-arm64.zip'
shasum -a 256 -c "$archive.sha256" &&
  unzip "$archive" &&
  cd "${archive%.zip}" &&
  ./install.sh
```

Use the ZIP matching your operating system and architecture. Open a new terminal after installation, or run `source ~/.bashrc` in Bash or `source ~/.zshrc` in zsh to load the PATH entry written by the installer.

### Removal

To remove CCU:

```powershell
codex-ultra uninstall
# or run uninstall.cmd / ./uninstall.sh from the Release package
```

Removal cleans up CCU's command entry points and the configuration it manages. If official Codex was already installed, `codex` in a new terminal returns to that build. Removing a standalone CCU installation does not install official Codex for you.

### Source installation

A source installation also requires a Rust toolchain:

```powershell
git clone https://github.com/Cec1c/codex-cli-ultra.git
cd codex-cli-ultra
npm ci
.\install.ps1
```

Linux/macOS:

```bash
git clone https://github.com/Cec1c/codex-cli-ultra.git
cd codex-cli-ultra
npm ci
./install.sh
```

This repository builds the CCU manager, not the complete Codex Rust project. CCU-I18N still requires a fork binary that follows the Release manifest contract.

The installer resolves the fork Release in this order:

1. A directory passed through `-ForkReleaseDir` on Windows or `--fork-release-dir` on Linux/macOS;
2. `fork-release/` in the repository root;
3. The latest stable asset from [`Cec1c/codex` Releases](https://github.com/Cec1c/codex/releases).

Use [`Cec1c/codex`](https://github.com/Cec1c/codex) when building the fork from source.

## CCU Manager

Run `ccu-manager` to open the Rust / Ratatui management interface. It has three pages for status and installation, language packs, and theme packs. Network and filesystem tasks run on background threads.

<p align="center">
  <img src="docs/assets/readme/manager.webp" alt="CCU Manager TUI" width="900">
</p>

| Key | Action |
| --- | --- |
| `Tab` / `1` / `2` / `3` | Switch between status and installation, language packs, and theme packs |
| `r` | Refresh local status |
| `c` | Query remote CCU, CCU-I18N, and OpenAI Codex versions |
| `i` | Install a detected local fork Release |
| `u` | Download and upgrade the full CCU package, including its bundled fork and content |
| `f` | Synchronize language and theme content |
| `o` | Open the CCU Release page in a browser |
| `p` / `Shift+P` | Toggle the download proxy / edit its address |
| `Esc` | Request cancellation while preparing an upgrade; exit when idle |
| `x` | Remove CCU after confirmation |
| `q` | Exit |

### Command-line management

| Command | Purpose |
| --- | --- |
| `codex-ultra version` | Show the CCU and installed fork versions |
| `codex-ultra status --check` | Inspect local state and query remote versions for all three components |
| `codex-ultra upgrade check` | Check for a full CCU package update |
| `codex-ultra upgrade` | Upgrade the full CCU package |
| `codex-ultra update` | Use the current manager to install a newer fork and synchronize the existing content source |
| `codex-ultra install --release-dir <directory>` | Install a fork from a local Release directory |
| `codex-ultra content sync` | Synchronize language packs and themes from the existing content source into the installation |
| `codex-ultra proxy status` | Inspect download proxy settings |

These management commands support `--json` for use in scripts.

> [!IMPORTANT]
> `upgrade` updates the full CCU package; `update` updates the fork. Use `codex-ultra upgrade` or the Manager's `u` key to get a new manager, language packs, and themes together. `content sync` uses the existing content source and does not download a new CCU package.

## Architecture

CCU tracks three version channels:

| Component | Repository | Responsibility |
| --- | --- | --- |
| OpenAI Codex | [`openai/codex`](https://github.com/openai/codex) | Official upstream stable releases |
| CCU-I18N fork | [`Cec1c/codex`](https://github.com/Cec1c/codex) | Rust/TUI i18n interface, `/language`, English fallback, and compiled Codex binaries |
| CCU | This repository | Language packs, themes, installer, manager TUI, version synchronization, and Release distribution |

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

Official npm Codex is an optional fallback. Without it, CCU installs in standalone mode and launches the verified fork directly. The launcher falls back to an official binary only when one was recorded and the fork state is invalid.

Yes, keeping up with Codex updates this way is tiring and inefficient. The maintainers have not responded to my issues about adding an i18n interface, even though I submitted a demonstration at the time.

## Repository structure

```text
codex-cli-ultra/
├── .github/workflows/       # CI, Release, and fork-channel synchronization
├── docs/                    # Design, release contracts, and progress documents
├── packages/
│   ├── languages/zh-CN/     # Simplified Chinese language pack
│   └── themes/              # rainbow_color default and legacy Hermes themes
├── release-channels/
│   └── stable.json          # Current stable fork Release metadata
├── research/                # Visible-text catalogs and version research
├── scripts/                 # Build, audit, packaging, and synchronization scripts
├── src/
│   ├── content/             # Language and theme content synchronization
│   ├── discovery/           # Official npm Codex discovery
│   ├── installer/           # Installation, updates, rollback, and removal
│   ├── language/            # FTL language-pack validation
│   ├── launcher/            # Runtime selection between official and fork builds
│   ├── release/             # GitHub Releases, manifests, and download verification
│   ├── state/               # Local installation state
│   ├── theme/               # Theme validation and application
│   └── manage-main.mjs      # codex-ultra management entry point
├── templates/languages/     # English FTL template
├── test/                    # Node.js tests
├── tui/                     # Rust Ratatui manager
├── install.ps1 / install.cmd / install.sh
└── uninstall.ps1 / uninstall.cmd / uninstall.sh
```

`dist/`, `tui/target/`, and `artifacts/` are generated build outputs rather than maintenance entry points for languages or themes.

## Language-pack format

Each language pack contains a manifest and an FTL resource:

```text
packages/languages/<locale>/
├── manifest.json
└── messages.ftl
```

```ftl
status-line-configure-title = Configure Status Line
status-line-save-failed = Failed to save status line settings: { $error }
```

Requirements:

- Message keys and Fluent variables match the [English template](templates/languages/messages.en-US.ftl).
- The manifest declares the locale, display names, license, i18n API range, and resource SHA256.
- Missing or invalid messages fall back to built-in English at runtime.

Validation command:

```powershell
node src/cli.mjs language validate `
  --pack packages/languages/<locale> `
  --catalog research/codex-0.144.5/tui-messages.jsonl `
  --template templates/languages/messages.en-US.ftl
```

## Version model and synchronization

| Component | Version format and source | What it updates |
| --- | --- | --- |
| CCU | `v0.1.24`; see [package.json](package.json) for the source version and [Releases](https://github.com/Cec1c/codex-cli-ultra/releases/latest) for published builds | Installer, manager, content, and distribution |
| CCU-I18N fork | `X.Y.Z-ccu.i18n.N`; the stable channel is recorded in [stable.json](release-channels/stable.json) | Codex runtime and i18n interfaces based on an upstream version |
| OpenAI Codex | `X.Y.Z`; see [upstream Releases](https://github.com/openai/codex/releases/latest) | Official upstream builds |

The fork automation periodically checks upstream stable Releases. This repository's [channel sync workflow](.github/workflows/sync-fork-channel.yml) checks stable fork Releases every six hours. When a new fork channel is detected, it updates the metadata, prepares the next CCU patch version, and triggers packaging. Changes limited to the CCU installer, manager, or content can be released independently without rebuilding the fork.

`stable.json` records the stable channel synchronized by this repository. The manifest inside a downloaded ZIP identifies the fork that package actually includes. Use `codex-ultra version` to inspect installed versions, or `codex-ultra status --check` to compare local and remote state when troubleshooting updates.

## Current status

| Item | Status |
| --- | --- |
| Supported platforms | Windows x64; Linux x64/ARM64; macOS Intel/Apple Silicon |
| CCU | `v0.1.24` |
| CCU-I18N | [Current stable channel](release-channels/stable.json); inspect the installed version with `codex-ultra version` |
| Reference locale | Simplified Chinese (`zh-CN`) |
| FTL resources | The current English template and Chinese pack each contain 1,396 message keys; new interface text still needs to be integrated in the fork |
| Fallback | Built-in English per message |
| Customization | Fresh installs enable the Rainbow Color status line by default; upgrades preserve existing choices and retain the legacy Hermes theme |

The project has Windows x64 regression and real Linux x64 install/remove smoke-test records. Release assets are available for all five platforms, and Linux ARM64 and both macOS architectures are included in the build matrix.

> [!NOTE]
> macOS still requires real-device acceptance. CI builds cannot replace device testing of Gatekeeper, terminal configuration, and browser integration. See the [macOS test checklist](docs/macos-testing.md) for the procedure.

## Documentation and contributing

| Topic | Reference |
| --- | --- |
| New language packs, development checks, and repository responsibilities | [Contributing guide](CONTRIBUTING.md) |
| English message template and Chinese reference implementation | [English FTL](templates/languages/messages.en-US.ftl) · [Chinese language pack](packages/languages/zh-CN/) |
| macOS installation and device acceptance | [Test checklist](docs/macos-testing.md) |
| Current stable fork metadata | [stable.json](release-channels/stable.json) |
| Fork runtime source and packages | [Cec1c/codex](https://github.com/Cec1c/codex) · [fork Releases](https://github.com/Cec1c/codex/releases) |
| Design background and historical progress | [Fork plan](docs/CCU_I18N_FORK_PLAN.md) · [Progress notes](docs/PLAN2_PROGRESS.md) |

Design and progress documents describe historical stages. For current installation behavior, refer to this README, the source, and the relevant Release notes.

New language packs, translation corrections, compatibility reports, and interface extensions are welcome. Contributors for other locales can use the English template, English Issues, and English pull requests without referring to the Chinese pack.

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

This project is licensed under the [GNU General Public License v3.0](LICENSE). Language packs must declare their own license in the manifest.

## Unofficial project notice

Codex-Cli-Ultra is an unofficial community project and is not affiliated with, sponsored by, or endorsed by OpenAI. Codex and OpenAI are names or trademarks of their respective owners.
