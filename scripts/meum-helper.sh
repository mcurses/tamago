#!/bin/zsh
# The Tamago widget's helper in meum: runs the daemon. meum starts it at launch (manifest "helper",
# bin/tamago-daemon in the widget folder calls this), restarts it when it dies and stops its process
# group on quit, disable or remove. meum passes MEUM_SOCKET, MEUM_WIDGET_ID and MEUM_WIDGET_DATA;
# the daemon keeps its state in MEUM_WIDGET_DATA (daemon/paths.mjs).
#
# A daemon that already runs on the same state (started by hand, or by an older setup) is waited
# for rather than doubled: when it exits, this one takes over.
ROOT=${0:A:h:h}
STATE=${TAMAGO_STATE_DIR:-${MEUM_WIDGET_DATA:-}}
[[ -n $STATE ]] || { print "meum-helper: no MEUM_WIDGET_DATA; meum starts this" >&2; exit 1; }
mkdir -p $STATE

# meum's PATH is a GUI app's: node may live under nvm or Homebrew only.
NODE=$(command -v node)
[[ -n $NODE ]] || NODE=$(print -l ~/.nvm/versions/node/*/bin/node(N) /opt/homebrew/bin/node(N) /usr/local/bin/node(N) | tail -1)
[[ -n $NODE ]] || { print "meum-helper: no node found" >&2; exit 1; }

while [[ -f $STATE/tamago.pid ]] && kill -0 $(<$STATE/tamago.pid) 2>/dev/null; do
  [[ -n ${waited:-} ]] || { print "$(date '+%F %T') meum-helper: daemon $(<$STATE/tamago.pid) already runs; waiting for it to exit"; waited=1; }
  sleep 5
done

export TAMAGO_STATE_DIR=$STATE TAMAGO_HOST=${TAMAGO_HOST:-meum}
exec $NODE $ROOT/daemon/tamago.mjs
