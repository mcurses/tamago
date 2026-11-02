#!/bin/zsh
# Build Tama as a meum widget (extension/Package.swift) and install it into meum's widget folder,
# then ask a running meum to reload it. Needs a meum checkout for MeumKit and its build script:
# ../meum next to this repo, or MEUM_REPO.
#
#   scripts/build-meum-widget.sh
#   MEUM_WIDGETS_DIR=<dir> MEUM_SOCKET=<sock> scripts/build-meum-widget.sh    a test instance
set -euo pipefail
ROOT=${0:A:h:h}
MEUM_REPO=${MEUM_REPO:-${ROOT:h}/meum}
[[ -x $MEUM_REPO/scripts/build-widget.sh ]] || { echo "no meum checkout at $MEUM_REPO (set MEUM_REPO)" >&2; exit 1; }
DEST=${MEUM_WIDGETS_DIR:-$HOME/.local/share/meum/widgets}/TamagoMeum.meumwidget
# species.json first, so a reload that happens before the copy can't find it missing.
mkdir -p $DEST
cp $ROOT/sidebar/species.json $DEST/species.json
# The helper meum runs for the widget: the daemon, from this checkout (scripts/meum-helper.sh).
mkdir -p $DEST/bin
print -r -- "#!/bin/zsh
exec /bin/zsh ${(q)ROOT}/scripts/meum-helper.sh \"\$@\"" >$DEST/bin/tamago-daemon.new
chmod +x $DEST/bin/tamago-daemon.new
# Unchanged, the file keeps its modification time, so a reload leaves a running helper alone.
if cmp -s $DEST/bin/tamago-daemon.new $DEST/bin/tamago-daemon; then rm $DEST/bin/tamago-daemon.new
else mv $DEST/bin/tamago-daemon.new $DEST/bin/tamago-daemon; fi
# meum's build script writes a manifest without the helper and then reloads; a reload of that would
# stop the helper. So it gets a socket that answers nobody, and the reload happens below.
MEUM_SOCKET=/nonexistent/meum.sock MEUM_KIT_PATH=$MEUM_REPO \
  $MEUM_REPO/scripts/build-widget.sh $ROOT/extension TamagoMeum io.github.mcurses.tamago Tamago | grep -v "meum not running"
/usr/bin/python3 - $DEST/manifest.json <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["helper"] = {"command": "bin/tamago-daemon", "args": [], "keepAlive": True}
open(p, "w").write(json.dumps(m) + "\n")
PY
MEUM=$MEUM_REPO/build/meum.app/Contents/Resources/bin/meum
[[ -x $MEUM ]] || MEUM=/Applications/meum.app/Contents/Resources/bin/meum
$MEUM ${MEUM_SOCKET:+--socket $MEUM_SOCKET} widget reload >/dev/null 2>&1 && print "build-meum-widget: meum reloaded the widget" \
  || print "build-meum-widget: meum not running; it loads the widget (and starts its helper) on the next start"
