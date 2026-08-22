# CCUM Next TUI

CCUM `0.2.0-alpha.3` replaces the tab-only Manager shell with a navigation-and-content layout inspired by the stable CC Switch CLI `v5.10.2` TUI (`bae5cab0be63b951270cfb50bd7e39756c6596d6`). CCU keeps its own backend, state model, release contract, and product identity; the reference project is used for interaction and information-architecture guidance.

## Migration boundary

The executable name and managed-update handoff stay compatible. `--auto-start` is still accepted for older Codex builds, but all `--upgrade` invocations now select the lightweight flow:

```text
ccu-manager[.exe] --upgrade --target <version> --auto-start
```

The Rust executable starts the bundled Node quick updater without entering the alternate-screen TUI. Normal `ccu-manager` launches still use Ratatui, and durable operations continue to use the bundled Node Manager rather than duplicating release, proxy, settings, installer, or content-sync business logic.

| Existing CCUM capability | Next TUI surface | Backend contract |
| --- | --- | --- |
| Local/online status | Versions page | `status [--check] --json` |
| Full CCU self-update | Versions page and live task bar | `upgrade --events jsonl` |
| Byte progress, speed, ETA | Live task bar | streamed `progress` events |
| Cancel and resume | `Esc` during upgrade | child cancellation plus partial download retention |
| Persistent proxy | Network page and header badge | `proxy status/toggle/set/test` |
| Language packs | Language page | `content sync --json` |
| Themes | Theme page | `content sync --json` |
| Local fork install | Versions page | `install --release-dir ... --json` |
| Safe uninstall | Centered confirmation dialog | `uninstall --json` |
| Release fallback | Versions page | trusted CCU GitHub Release URL |

## Interaction model

- The left rail has exactly four pages: `📦 Versions & Install`, `💬 Language Packs`, `🎨 Theme Packs`, and `🔌 Network Proxy`. Home and About are intentionally absent.
- `Up/Down` or `j/k`: move through the left navigation.
- `Left/Right` or `h/l`: switch focus between navigation and content.
- `Tab` / `Shift+Tab`: cycle pages; `1` through `4` open a page directly.
- `?`: contextual help.
- `r`, `c`, `u`, `i`, `f`, `o`, `p`, `Shift+P`, `t`, `x`, and `q` retain direct shortcuts.
- No mouse capture is enabled, so native terminal text selection remains available.

## Managed-update quick flow

The Codex update prompt hands off to `ccu-manager --upgrade --target <version>`. Instead of opening the full Manager, CCUM displays:

1. Automatically configure a proxy and update (recommended).
2. Update directly without changing saved proxy settings.
3. Manually configure a proxy and update.
4. Exit the update.

Automatic mode checks `7890`, `10809`, `10808`, `7891`, `1080`, `2080`, and `2081` in that order. Windows uses `Get-NetTCPConnection`, Linux uses `ss` with an `lsof` fallback, and macOS uses `lsof`. An open port is accepted only when its owner matches a known proxy/VPN process such as Clash, Mihomo, v2rayN, V2Ray, Xray, sing-box, NekoRay, Hiddify, or Shadowsocks. A successful match prints `已找到本地代理服务：{软件名}：{代理地址和端口}` and persists the detected endpoint.

If no known service is detected, or the detected proxy cannot complete the update, the flow falls back to manual input. Accepted examples include `https://127.0.0.1:7890` and `socks5://127.0.0.1:7890`; an explicit port is required. Download output uses the CCU Sky color `#89DCEB` and reports a progress bar, percentage, transferred and total bytes, current speed, and ETA. The completed handoff installs the package without reopening the full Manager.

## Safety and deprecation

The new TUI is shipped as a separate alpha test artifact before replacing the installed stable Manager. The previous TUI remains available in the existing installation during acceptance. After the new render, navigation, proxy, content-root, update-event, and packaging checks passed, the legacy renderer was removed from this development branch. The installed stable Manager is not overwritten until manual acceptance promotes the new binary to the normal `ccu-manager` release asset.

The remote test release uses CCU version `0.2.0-alpha.3`. An explicit `--target 0.2.0-alpha.3` resolves that exact prerelease instead of GitHub's latest stable Release, allowing the local `0.2.0-alpha.2` test client to exercise the complete quick-update handoff without exposing the Alpha as the stable update channel.

## Validation target

Required checks before stable promotion:

1. Rust formatting, Clippy with warnings denied, unit and render tests.
2. Full Node Manager regression suite.
3. Bundled build plus `--version` and `--print-status` smoke tests.
4. Real proxy connectivity check without mutating the stored proxy settings.
5. Sandboxed JSONL update event test covering check, download, verify, extract, ready, cancel, and handoff.
6. Release bundle construction and hash verification.
7. Manual Windows Terminal acceptance for navigation, overlays, progress, resizing, text selection, and terminal restoration.
