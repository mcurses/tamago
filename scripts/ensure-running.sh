#!/bin/zsh
# Start the Tamago daemon detached unless it is already running.
# Must run from a process started inside cmux: the cmux socket ("cmuxOnly" mode) only admits
# processes cmux is responsible for, and that survives detaching, so the daemon outlives the tab.
# install.sh adds a line to the shell's startup file that runs this in every new cmux terminal, so
# the daemon comes back after a cmux restart. A shell may not have node on its PATH yet at that
# point (nvm loads later), hence the lookup below.
ROOT=${0:A:h:h}
STATE=${TAMAGO_STATE_DIR:-~/.local/state/tamago}
mkdir -p $STATE
if [[ -f $STATE/tamago.pid ]] && kill -0 $(<$STATE/tamago.pid) 2>/dev/null; then
  # Still running, but refused by the cmux socket (after a cmux restart): replace it with an
  # instance started from here, inside cmux.
  if [[ -f $STATE/denied && $(<$STATE/denied) == $(<$STATE/tamago.pid) ]]; then
    OLD=$(<$STATE/tamago.pid)
    print "$(date '+%F %T') ensure-running: replacing refused daemon $OLD" >>$STATE/daemon.out
    kill $OLD
    for i in {1..20}; do kill -0 $OLD 2>/dev/null || break; sleep 0.25; done
    rm -f $STATE/denied
  else
    exit 0
  fi
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
