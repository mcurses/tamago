#!/bin/zsh
# Install or update the compiled sidebar from a built Tamago.app into ~/Applications.
#
#   scripts/install-app.sh <path/to/Tamago.app>
#
# Stops the running extension first, then copies and registers it again (a changed binary drops
# it from pluginkit; the user's enablement in cmux survives). cmux 0.64 doesn't reconnect by
# itself: its sidebar shows "Extension Blocked" until Try Again is clicked, so an unchanged
# extension is left alone.
set -euo pipefail
SRC=${1:?usage: install-app.sh <Tamago.app>}
BUNDLE_ID=io.github.mcurses.tamago
DEST=~/Applications/Tamago.app
BIN=Contents/Extensions/TamagoSidebar.appex/Contents/MacOS/TamagoSidebar
mkdir -p ~/Applications
if [[ -d $DEST ]] && cmp -s $SRC/$BIN $DEST/$BIN && cmp -s $SRC/Contents/Info.plist $DEST/Contents/Info.plist; then
  echo "sidebar extension already up to date"
  exit 0
fi
FIRST=$([[ -d $DEST ]] && echo no || echo yes)
pkill -f "$DEST/$BIN" || true
rsync -a --delete $SRC/ $DEST/
xattr -dr com.apple.quarantine $DEST 2>/dev/null || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f $DEST
pluginkit -a $DEST/Contents/Extensions/TamagoSidebar.appex
if [[ $FIRST == yes ]]; then
  pluginkit -e use -i $BUNDLE_ID.sidebar
  echo "installed $DEST"
else
  echo "updated $DEST (if cmux shows 'Extension Blocked', click Try Again)"
fi
