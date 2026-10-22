#!/usr/bin/env bash
set -euo pipefail
install_root="${SIAAS_INSTALL_DIR:-$HOME/.local/share/siaas-personal-source}"
[[ -f "$install_root/runtime-path" ]] || { echo 'Managed runtime missing. Rerun the official installer.' >&2; exit 1; }
IFS= read -r runtime_node < "$install_root/runtime-path"
[[ "$runtime_node" = /* && -x "$runtime_node" ]] || { echo 'Managed runtime unavailable. Rerun the official installer.' >&2; exit 1; }
unset NODE_OPTIONS NODE_PATH
export SIAAS_INSTALL_DIR="$install_root"
exec "$runtime_node" "$install_root/source-manager.mjs" "${1:-update}"
