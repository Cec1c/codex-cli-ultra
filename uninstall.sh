#!/usr/bin/env bash
set -euo pipefail

install_root=${CODEX_ULTRA_HOME:-}
if [[ ${1:-} == --install-root ]]; then
  install_root=${2:?--install-root requires a path}
elif (($#)); then
  echo "usage: uninstall.sh [--install-root PATH]" >&2
  exit 2
fi

if [[ -z "$install_root" ]]; then
  if [[ $(uname -s) == Darwin ]]; then
    install_root="$HOME/Library/Application Support/codex-cli-ultra"
  else
    install_root="${XDG_DATA_HOME:-$HOME/.local/share}/codex-cli-ultra"
  fi
fi

manager="$install_root/bin/codex-ultra.mjs"
if [[ ! -f "$manager" ]]; then
  echo "Codex CLI Ultra is not installed at $install_root"
  exit 0
fi

export CODEX_ULTRA_HOME="$install_root"
node "$manager" uninstall
