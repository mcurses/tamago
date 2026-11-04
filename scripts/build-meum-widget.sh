#!/bin/zsh
# Build Tama as a meum widget: the widget library (extension/Package.swift, species art built in), and the
# daemon compiled into one executable, bin/tamago-daemon, which meum runs as the widget's helper.
# Needs a meum checkout for MeumKit and its build script (../meum next to this repo, or MEUM_REPO)
# and Bun (https://bun.sh) to compile the daemon; the Mac that runs the widget needs neither.
#
#   scripts/build-meum-widget.sh                      build, install into meum's widgets, reload
#   MEUM_WIDGETS_DIR=<dir> MEUM_SOCKET=<sock> scripts/build-meum-widget.sh    a test instance
#   scripts/build-meum-widget.sh --stage <dir> --version 0.2.0
#       build <dir>/TamagoMeum.meumwidget for a release, without installing; then, from ~/code/meum:
#       scripts/release-widget.sh --folder <dir>/TamagoMeum.meumwidget 0.2.0 "<description>"
#
# The helper is signed with the Developer ID from the keychain (hardened runtime, with the JIT
# entitlements Bun needs: extension/Meum/helper-entitlements.plist), or ad hoc without one.
set -euo pipefail
ROOT=${0:A:h:h}
MEUM_REPO=${MEUM_REPO:-${ROOT:h}/meum}
STAGE= VERSION=
while (( $# )); do
  case $1 in
    --stage) STAGE=${2:A}; shift 2 ;;
    --version) VERSION=$2; shift 2 ;;
    *) print -u2 "build-meum-widget: unknown argument $1"; exit 2 ;;
  esac
done
[[ -x $MEUM_REPO/scripts/build-widget.sh ]] || { print -u2 "no meum checkout at $MEUM_REPO (set MEUM_REPO)"; exit 1; }
BUN=$(command -v bun || print -l ~/.bun/bin/bun(N) ~/.local/bin/bun(N) /opt/homebrew/bin/bun(N) | head -1)
[[ -n $BUN ]] || { print -u2 "build-meum-widget: needs bun (https://bun.sh) to compile the daemon"; exit 1; }
WIDGETS=${STAGE:-${MEUM_WIDGETS_DIR:-$HOME/.local/share/meum/widgets}}
DEST=$WIDGETS/TamagoMeum.meumwidget
[[ -n $VERSION ]] || VERSION=$(git -C $ROOT describe --tags --always --dirty 2>/dev/null || print dev)

# The species art goes into the library (meum loads a copy of it from a temporary folder).
$ROOT/scripts/gen-species-swift.sh
mkdir -p $DEST/bin
rm -f $DEST/species.json
rm -f $DEST/bin/tamago-daemon.new

# The daemon as one executable. No .env or bunfig.toml from the working directory (meum's data folder).
TMP=$(mktemp -d)
trap 'rm -rf $TMP' EXIT
$BUN build $ROOT/daemon/tamago.mjs --compile --target=bun-darwin-arm64 \
  --no-compile-autoload-dotenv --no-compile-autoload-bunfig \
  --define "TAMAGO_BUILD_VERSION=\"$VERSION\"" --outfile $TMP/tamago-daemon >/dev/null
IDENTITY=$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)".*/\1/p' | head -1)
codesign --force --options runtime --timestamp=none --entitlements $ROOT/extension/Meum/helper-entitlements.plist \
  --sign "${IDENTITY:--}" $TMP/tamago-daemon >/dev/null 2>&1 \
  || codesign --force --sign - $TMP/tamago-daemon >/dev/null
# Compiles and signatures differ byte for byte each time, so compare the daemon's source instead:
# a rebuilt helper with the same source keeps its file, and a reload leaves the running one alone.
STAMP=$( { print $VERSION; cat $ROOT/daemon/*.mjs $ROOT/sidebar/species.json $ROOT/extension/Meum/helper-entitlements.plist; } | shasum -a 256 | cut -d' ' -f1)
if [[ -f $DEST/bin/tamago-daemon && $(cat $DEST/bin/.source 2>/dev/null) == $STAMP ]]; then
  print "build-meum-widget: daemon unchanged ($VERSION)"
else
  mv $TMP/tamago-daemon $DEST/bin/tamago-daemon.new
  mv $DEST/bin/tamago-daemon.new $DEST/bin/tamago-daemon
  print $STAMP >$DEST/bin/.source
  print "build-meum-widget: daemon $VERSION compiled${IDENTITY:+ and signed}"
fi

# meum's build script writes a manifest without the helper and then reloads; a reload of that would
# stop the helper. So it gets a socket that answers nobody, and the reload happens below.
MEUM_WIDGETS_DIR=$WIDGETS MEUM_SOCKET=/nonexistent/meum.sock MEUM_KIT_PATH=$MEUM_REPO \
  $MEUM_REPO/scripts/build-widget.sh $ROOT/extension TamagoMeum io.github.mcurses.tamago Tamago | grep -v "meum not running"
/usr/bin/python3 -I - $DEST/manifest.json <<'PY'
import json, sys
p = sys.argv[1]
m = json.load(open(p))
m["helper"] = {"command": "bin/tamago-daemon", "args": [], "keepAlive": True}
open(p, "w").write(json.dumps(m) + "\n")
PY
[[ -n $STAGE ]] && { print "build-meum-widget: staged $DEST"; exit 0; }

MEUM=$MEUM_REPO/build/meum.app/Contents/Resources/bin/meum
[[ -x $MEUM ]] || MEUM=/Applications/meum.app/Contents/Resources/bin/meum
$MEUM ${MEUM_SOCKET:+--socket $MEUM_SOCKET} widget reload >/dev/null 2>&1 && print "build-meum-widget: meum reloaded the widget" \
  || print "build-meum-widget: meum not running; it loads the widget (and starts its helper) on the next start"
