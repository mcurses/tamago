#!/bin/zsh
# Start the Tamago daemon detached unless it is already running.
# Must run from a process started inside cmux: the cmux socket ("cmuxOnly" mode) only admits
# processes cmux is responsible for, and that survives detaching, so the daemon outlives the tab.
# cmux.json runs this as notifications.command, so the daemon comes back after a cmux restart with
# the first notification. That environment has a bare GUI PATH, hence the node lookup below.
ROOT=${0:A:h:h}
STATE=~/.local/state/tamago
mkdir -p $STATE
if [[ -f $STATE/tamago.pid ]] && kill -0 $(<$STATE/tamago.pid) 2>/dev/null; then
  exit 0
fi
NODE=$(command -v node)
if [[ -z $NODE ]]; then
  NODE=$(print -l ~/.nvm/versions/node/*/bin/node(N) /opt/homebrew/bin/node(N) /usr/local/bin/node(N) | tail -1)
fi
if [[ -z $NODE ]]; then
  print "$(date '+%F %T') ensure-running: no node found" >>$STATE/daemon.out
  exit 1
fi
print "$(date '+%F %T') ensure-running: starting daemon (${CMUX_NOTIFICATION_TITLE:-manual})" >>$STATE/daemon.out
nohup $NODE "$ROOT/daemon/tamago.mjs" >>$STATE/daemon.out 2>&1 &!
