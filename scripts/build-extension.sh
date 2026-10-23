#!/bin/zsh
# Build the compiled Tamago sidebar (an ExtensionKit app extension for cmux) without an Xcode
# project: swiftc + hand-assembled bundles, ad-hoc signed, then installed to ~/Applications/Tamago.app.
#
#   scripts/build-extension.sh             build for this Mac and install
#   scripts/build-extension.sh --no-install
#
# TAMAGO_ARCHS="arm64 x86_64" builds a universal binary (the release workflow does). Needs Xcode
# (for the macOS SDK and ExtensionKit) and network access the first time, to fetch cmux's
# CmuxExtensionKit sources (scripts/fetch-sdk.mjs).
set -euo pipefail
ROOT=${0:A:h:h}
BUILD=$ROOT/build
APP=$BUILD/Tamago.app
APPEX=$APP/Contents/Extensions/TamagoSidebar.appex
BUNDLE_ID=io.github.mcurses.tamago
ARCHS=(${=TAMAGO_ARCHS:-$(uname -m)})
VERSION=$(cat $ROOT/VERSION 2>/dev/null || git -C $ROOT describe --tags --always 2>/dev/null || echo dev)
# Bundle versions must be numbers: 0.2.0 for v0.2.0, 0.0.0 for a dev build.
NUMERIC=$(print -r -- ${VERSION#v} | grep -Eo '^[0-9]+(\.[0-9]+){0,2}' || echo 0.0.0)

node "$ROOT/scripts/fetch-sdk.mjs"

rm -rf $APP $BUILD/obj
mkdir -p $BUILD/obj $APPEX/Contents/MacOS $APPEX/Contents/Resources $APP/Contents/MacOS

for ARCH in $ARCHS; do
  TARGET=$ARCH-apple-macos14.0
  OBJ=$BUILD/obj/$ARCH
  mkdir -p $OBJ
  echo "compiling CmuxExtensionKit ($ARCH)"
  xcrun swiftc -target $TARGET -O -swift-version 6 -parse-as-library -application-extension \
    -module-name CmuxExtensionKit -emit-library -static -emit-module \
    -emit-module-path $OBJ/CmuxExtensionKit.swiftmodule \
    -o $OBJ/libCmuxExtensionKit.a \
    $BUILD/cmux-sdk/Sources/**/*.swift

  echo "compiling TamagoSidebar ($ARCH)"
  xcrun swiftc -target $TARGET -O -swift-version 5 -parse-as-library -application-extension \
    -module-name TamagoSidebar -I $OBJ -L $OBJ -lCmuxExtensionKit \
    -Xlinker -e -Xlinker _NSExtensionMain \
    -o $OBJ/TamagoSidebar \
    $ROOT/extension/Sources/*.swift

  echo "compiling Tamago container app ($ARCH)"
  xcrun swiftc -target $TARGET -O -parse-as-library \
    -o $OBJ/Tamago $ROOT/extension/App/main.swift
done
lipo -create -output $APPEX/Contents/MacOS/TamagoSidebar $BUILD/obj/${^ARCHS}/TamagoSidebar
lipo -create -output $APP/Contents/MacOS/Tamago $BUILD/obj/${^ARCHS}/Tamago

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
plist $P CFBundleShortVersionString string $NUMERIC
plist $P CFBundleVersion string $NUMERIC
plist $P TamagoVersion string $VERSION
plist $P CFBundleInfoDictionaryVersion string 6.0
plist $P LSMinimumSystemVersion string 14.0
plist $P EXAppExtensionAttributes dict
plist $P EXAppExtensionAttributes:EXExtensionPointIdentifier string com.cmuxterm.app.cmux.sidebar
plist $P TamagoDaemonURL string "http://127.0.0.1:${TAMAGO_PORT:-47321}"

P=$APP/Contents/Info.plist
plist $P CFBundleIdentifier string $BUNDLE_ID
plist $P CFBundleExecutable string Tamago
plist $P CFBundleName string Tamago
plist $P CFBundlePackageType string APPL
plist $P CFBundleShortVersionString string $NUMERIC
plist $P CFBundleVersion string $NUMERIC
plist $P TamagoVersion string $VERSION
plist $P CFBundleInfoDictionaryVersion string 6.0
plist $P LSMinimumSystemVersion string 14.0
plist $P LSUIElement bool true

# The sandboxed extension may read the daemon's token, and nothing else outside its container.
cat >$BUILD/obj/sidebar.entitlements <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key><true/>
  <key>com.apple.security.network.client</key><true/>
  <key>com.apple.security.temporary-exception.files.home-relative-path.read-only</key>
  <array><string>/.local/state/tamago/token</string></array>
</dict>
</plist>
PLIST

# Ad-hoc signatures: no Apple developer account needed. A download keeps working because the
# installer fetches it with curl, which doesn't set the quarantine flag.
codesign --force --sign - --entitlements $BUILD/obj/sidebar.entitlements $APPEX
codesign --force --sign - $APP
echo "built $APP ($VERSION, ${(j:+:)ARCHS})"

[[ ${1-} == --no-install ]] || "$ROOT/scripts/install-app.sh" $APP
