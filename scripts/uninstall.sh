#!/bin/zsh
# Stop the daemon (it clears its own comments on SIGTERM) and unlink the sidebar.
STATE=~/.local/state/tamago
[[ -f $STATE/tamago.pid ]] && kill -TERM $(<$STATE/tamago.pid) 2>/dev/null
rm -f ~/.config/cmux/sidebars/tamago.swift
echo "Tamago removed. Switch the left sidebar back via right-click on the sidebar toggle button,"
echo "and drop the ensure-running.sh line from ~/.zshrc if you added it."
