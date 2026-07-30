#!/usr/bin/env bash
set -euo pipefail

source_root=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install_root=${CODEX_ULTRA_HOME:-}
fork_release_dir=""
skip_build=false
non_interactive=false
preserve_statusline=false
statusline_mode=""

while (($#)); do
  case "$1" in
    --install-root)
      install_root=${2:?--install-root requires a path}
      shift 2
      ;;
    --fork-release-dir)
      fork_release_dir=${2:?--fork-release-dir requires a path}
      shift 2
      ;;
    --skip-build)
      skip_build=true
      shift
      ;;
    --non-interactive)
      non_interactive=true
      shift
      ;;
    --preserve-statusline)
      preserve_statusline=true
      shift
      ;;
    --enable-statusline|--disable-statusline)
      if [[ -n "$statusline_mode" ]]; then
        echo "choose only one status-line mode" >&2
        exit 2
      fi
      statusline_mode=$1
      shift
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "$install_root" ]]; then
  if [[ $(uname -s) == Darwin ]]; then
    install_root="$HOME/Library/Application Support/codex-cli-ultra"
  else
    install_root="${XDG_DATA_HOME:-$HOME/.local/share}/codex-cli-ultra"
  fi
fi

command -v node >/dev/null 2>&1 || {
  echo "Node.js 22.19.0 or newer is required." >&2
  exit 1
}
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 22 || (major === 22 && minor < 19)) process.exit(1)' || {
  echo "Node.js 22.19.0 or newer is required; found $(node --version)." >&2
  exit 1
}

source_root=$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$source_root")
install_root=$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$install_root")
if [[ -e "$install_root" ]]; then
  install_root=$(node -e 'process.stdout.write(require("node:fs").realpathSync(process.argv[1]))' "$install_root")
fi
if [[ "$install_root" == "$source_root" ]]; then
  echo "Install root must not be the installer source directory." >&2
  exit 1
fi

packaged=false
if [[ -f "$source_root/bin/codex-ultra.mjs" ]]; then
  packaged=true
fi

if [[ $packaged == false && $skip_build == false ]]; then
  command -v npm >/dev/null 2>&1 || { echo "npm is required for a source install." >&2; exit 1; }
  command -v cargo >/dev/null 2>&1 || { echo "Cargo is required for a source install." >&2; exit 1; }
  (
    cd "$source_root"
    npm ci
    npm run build
    cd tui
    cargo build --release --locked
  )
fi

if [[ $packaged == true ]]; then
  manager_entry="$source_root/bin/codex-ultra.mjs"
  manager_executable="$source_root/bin/ccu-manager"
  content_root="$source_root/content"
else
  manager_entry="$source_root/dist/codex-ultra.mjs"
  manager_executable="$source_root/tui/target/release/ccu-manager"
  content_root="$source_root"
fi

for required in "$manager_entry" "$manager_executable"; do
  [[ -f "$required" ]] || { echo "required build output is missing: $required" >&2; exit 1; }
done
chmod 755 "$manager_executable"

if [[ -z "$fork_release_dir" && -d "$source_root/fork-release" ]]; then
  if compgen -G "$source_root/fork-release/ccu-fork-manifest*.json" >/dev/null; then
    fork_release_dir="$source_root/fork-release"
  fi
fi

if [[ -z "$statusline_mode" && $preserve_statusline == false && $non_interactive == false ]]; then
  read -r -p "Enable the optional CCU Hermes status line? [y/N] " answer
  if [[ $answer =~ ^([yY]|[yY][eE][sS])$ ]]; then
    statusline_mode="--enable-statusline"
  else
    statusline_mode="--disable-statusline"
  fi
fi

export CODEX_ULTRA_HOME="$install_root"
export CODEX_CCU_CONTENT_ROOT="$content_root"
arguments=("$manager_entry" install)
if [[ -n "$fork_release_dir" ]]; then
  arguments+=(--release-dir "$fork_release_dir")
fi
if [[ -n "$statusline_mode" ]]; then
  arguments+=("$statusline_mode")
fi

echo "Installing Codex CLI Ultra into $install_root"
node "${arguments[@]}"
mkdir -p "$install_root/bin"
install -m 755 "$manager_executable" "$install_root/bin/ccu-manager"

echo
echo "Codex CLI Ultra installation completed."
echo "Open a new terminal, then run: codex --version"
echo "If the command is not found yet, source your shell profile or add $install_root/bin to PATH."
