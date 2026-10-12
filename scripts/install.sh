#!/bin/zsh
# Install Tamago: link + select the sidebar and start the daemon. Run from a cmux terminal.
set -euo pipefail
ROOT=${0:A:h:h}
CMUX=/Applications/cmux.app/Contents/Resources/bin/cmux
mkdir -p ~/.config/cmux/sidebars
ln -sf "$ROOT/sidebar/tamago.swift" ~/.config/cmux/sidebars/tamago.swift
$CMUX sidebar select tamago
"$ROOT/scripts/ensure-running.sh"
echo "Tamago installed. Log: ~/.local/state/tamago/tamago.log"
echo "To restart it automatically after cmux restarts, add to ~/.zshrc:"
echo "  [[ -n \"\$CMUX_SOCKET_PATH\" ]] && \"$ROOT/scripts/ensure-running.sh\" 2>/dev/null"
