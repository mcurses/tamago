#!/bin/zsh
# Start the Tamago daemon detached unless it is already running.
# Must run from a process started inside cmux: the cmux socket ("cmuxOnly" mode) only admits
# processes cmux is responsible for, and that survives detaching, so the daemon outlives the tab.
ROOT=${0:A:h:h}
STATE=~/.local/state/tamago
mkdir -p $STATE
if [[ -f $STATE/tamago.pid ]] && kill -0 $(<$STATE/tamago.pid) 2>/dev/null; then
  exit 0
fi
nohup node "$ROOT/daemon/tamago.mjs" >>$STATE/daemon.out 2>&1 &!
