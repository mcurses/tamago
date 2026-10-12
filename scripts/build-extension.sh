#!/bin/zsh
# Build the compiled Tamago sidebar (an ExtensionKit app extension for cmux) without an Xcode
# project: swiftc + hand-assembled bundles, ad-hoc signed, installed to ~/Applications/Tamago.app.
#
#   scripts/build-extension.sh
#
# Needs Xcode (for the macOS SDK and ExtensionKit) and network access the first time, to fetch
# cmux's CmuxExtensionKit sources (scripts/fetch-sdk.mjs).
set -euo pipefail
ROOT=${0:A:h:h}
BUILD=$ROOT/build
APP=$BUILD/Tamago.app
APPEX=$APP/Contents/Extensions/TamagoSidebar.appex
STATE=~/.local/state/tamago
BUNDLE_ID=io.github.mcurses.tamago
TARGET=$(uname -m)-apple-macos14.0

node "$ROOT/scripts/fetch-sdk.mjs"

# Shared secret for the daemon's local HTTP endpoint. The sandboxed extension can't read files
# outside its container, so the token is baked into its Info.plist at build time.
mkdir -p $STATE
[[ -s $STATE/token ]] || { openssl rand -hex 24 >$STATE/token; chmod 600 $STATE/token; }
TOKEN=$(<$STATE/token)
PORT=${TAMAGO_PORT:-47321}

rm -rf $APP $BUILD/obj
mkdir -p $BUILD/obj $APPEX/Contents/MacOS $APPEX/Contents/Resources $APP/Contents/MacOS

echo "compiling CmuxExtensionKit"
xcrun swiftc -target $TARGET -O -swift-version 6 -parse-as-library -application-extension \
  -module-name CmuxExtensionKit -emit-library -static -emit-module \
  -emit-module-path $BUILD/obj/CmuxExtensionKit.swiftmodule \
  -o $BUILD/obj/libCmuxExtensionKit.a \
  $BUILD/cmux-sdk/Sources/**/*.swift

echo "compiling TamagoSidebar"
xcrun swiftc -target $TARGET -O -swift-version 5 -parse-as-library -application-extension \
  -module-name TamagoSidebar -I $BUILD/obj -L $BUILD/obj -lCmuxExtensionKit \
  -Xlinker -e -Xlinker _NSExtensionMain \
  -o $APPEX/Contents/MacOS/TamagoSidebar \
  $ROOT/extension/Sources/*.swift

echo "compiling Tamago (container app)"
xcrun swiftc -target $TARGET -O -parse-as-library \
  -o $APP/Contents/MacOS/Tamago $ROOT/extension/App/main.swift

cp $ROOT/sidebar/species.json $APPEX/Contents/Resources/species.json

plist() { # plist <file> <key> <type> <value>
  /usr/libexec/PlistBuddy -c "Add :$2 $3 ${4-}" $1 >/dev/null
}
P=$APPEX/Contents/Info.plist
plist $P CFBundleIdentifier string $BUNDLE_ID.sidebar
plist $P CFBundleExecutable string TamagoSidebar
plist $P CFBundleName string TamagoSidebar
plist $P CFBundleDisplayName string Tamago
plist $P CFBundlePackageType string 'XPC!'
plist $P CFBundleShortVersionString string 1.0
plist $P CFBundleVersion string 1
plist $P CFBundleInfoDictionaryVersion string 6.0
plist $P LSMinimumSystemVersion string 14.0
plist $P EXAppExtensionAttributes dict
plist $P EXAppExtensionAttributes:EXExtensionPointIdentifier string com.cmuxterm.app.cmux.sidebar
plist $P TamagoDaemonURL string "http://127.0.0.1:$PORT"
plist $P TamagoToken string $TOKEN

P=$APP/Contents/Info.plist
plist $P CFBundleIdentifier string $BUNDLE_ID
plist $P CFBundleExecutable string Tamago
plist $P CFBundleName string Tamago
plist $P CFBundlePackageType string APPL
plist $P CFBundleShortVersionString string 1.0
plist $P CFBundleVersion string 1
plist $P CFBundleInfoDictionaryVersion string 6.0
plist $P LSMinimumSystemVersion string 14.0
plist $P LSUIElement bool true

cat >$BUILD/obj/sidebar.entitlements <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key><true/>
  <key>com.apple.security.network.client</key><true/>
</dict>
</plist>
EOF

# Ad-hoc signatures are enough for an extension that only runs on this Mac.
codesign --force --sign - --entitlements $BUILD/obj/sidebar.entitlements $APPEX
codesign --force --sign - $APP

# Update an existing install in place. Stop the running extension first, then copy and register
# it again (a changed binary drops it from pluginkit; the user's enablement survives). cmux notices
# the re-registration and reconnects; killing it after registering leaves cmux "blocked" instead.
mkdir -p ~/Applications
DEST=~/Applications/Tamago.app
FIRST=$([[ -d $DEST ]] && echo no || echo yes)
pkill -f "$DEST/Contents/Extensions/TamagoSidebar.appex/Contents/MacOS/TamagoSidebar" || true
rsync -a --delete $APP/ $DEST/
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f $DEST
pluginkit -a $DEST/Contents/Extensions/TamagoSidebar.appex
if [[ $FIRST == yes ]]; then
  pluginkit -e use -i $BUNDLE_ID.sidebar
  echo "installed $DEST. In cmux: Settings > Custom Sidebars > Extensions on, then pick Extension Sidebar"
  echo "from the sidebar toggle button's right-click menu and allow Tamago's requested access."
else
  echo "updated $DEST (if cmux shows 'Extension Blocked', click Try Again)"
fi
