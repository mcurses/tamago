#!/bin/zsh
# Render Tama's sidebar footer offscreen at fixed animation moments into a PNG contact sheet
# (extension/Harness/main.swift), to check drawing changes without cmux. Needs one
# scripts/build-extension.sh run first (for the compiled CmuxExtensionKit).
#
#   scripts/render-pet.sh [out.png]
#   scripts/render-pet.sh --readme docs/preview.png    the picture at the top of the README
set -euo pipefail
ROOT=${0:A:h:h}
BUILD=$ROOT/build
OBJ=$BUILD/obj/$(uname -m)
[[ -f $OBJ/libCmuxExtensionKit.a ]] || { echo "run scripts/build-extension.sh first" >&2; exit 1; }
mkdir -p $BUILD/harness
xcrun swiftc -target $(uname -m)-apple-macos14.0 -swift-version 5 -parse-as-library \
  -module-name TamagoHarness -I $OBJ -L $OBJ -lCmuxExtensionKit \
  -o $BUILD/harness/render-pet \
  $ROOT/extension/Sources/{SidebarModel,SidebarView,Pet,DaemonClient}.swift $ROOT/extension/Harness/main.swift
cp $ROOT/sidebar/species.json $BUILD/harness/species.json # Bundle.main of a tool is its directory
$BUILD/harness/render-pet "${@:-$BUILD/pet-sheet.png}"
