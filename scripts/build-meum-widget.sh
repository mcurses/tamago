#!/bin/zsh
# Build Tama as a meum widget (extension/Package.swift) and install it into meum's widget folder,
# then ask a running meum to reload it. Needs a meum checkout for MeumKit and its build script:
# ../mux next to this repo, or MEUM_REPO.
#
#   scripts/build-meum-widget.sh
#   MEUM_WIDGETS_DIR=<dir> MEUM_SOCKET=<sock> scripts/build-meum-widget.sh    a test instance
set -euo pipefail
ROOT=${0:A:h:h}
MEUM_REPO=${MEUM_REPO:-${ROOT:h}/mux}
[[ -x $MEUM_REPO/scripts/build-widget.sh ]] || { echo "no meum checkout at $MEUM_REPO (set MEUM_REPO)" >&2; exit 1; }
DEST=${MEUM_WIDGETS_DIR:-$HOME/.local/share/meum/widgets}/TamagoMeum.meumwidget
# species.json first, so a reload that happens before the copy can't find it missing.
mkdir -p $DEST
cp $ROOT/sidebar/species.json $DEST/species.json
MEUM_KIT_PATH=$MEUM_REPO $MEUM_REPO/scripts/build-widget.sh $ROOT/extension TamagoMeum io.github.mcurses.tamago Tamago
