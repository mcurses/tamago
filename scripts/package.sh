#!/bin/zsh
# Package a release: build/dist/tamago-<version>.tar.gz (daemon, scripts, sidebars and the prebuilt
# universal Tamago.app) plus build/dist/install.sh, the installer people pipe into zsh.
#
#   scripts/package.sh v0.2.0
#
# The release workflow (.github/workflows/release.yml) runs this for every v* tag.
set -euo pipefail
ROOT=${0:A:h:h}
VERSION=${1:?usage: package.sh <version, like v0.2.0>}
[[ $VERSION =~ '^v[0-9]+\.[0-9]+\.[0-9]+$' ]] || { print -u2 "version must look like v0.2.0"; exit 1; }
DIST=$ROOT/build/dist
STAGE=$DIST/tamago-$VERSION

rm -rf $DIST && mkdir -p $STAGE
print -r -- $VERSION >$ROOT/VERSION
trap 'rm -f $ROOT/VERSION' EXIT
TAMAGO_ARCHS="arm64 x86_64" $ROOT/scripts/build-extension.sh --no-install

cp -R $ROOT/daemon $ROOT/sidebar $STAGE/
mkdir -p $STAGE/scripts
cp $ROOT/scripts/{install,install-app,uninstall,ensure-running}.sh $STAGE/scripts/
cp -R $ROOT/build/Tamago.app $STAGE/
cp $ROOT/README.md $ROOT/LICENSE $ROOT/VERSION $STAGE/ 2>/dev/null || cp $ROOT/README.md $ROOT/VERSION $STAGE/
# Tamago.app links cmux's CmuxExtensionKit (GPL-3.0-or-later); its license and source travel along.
mkdir -p $STAGE/third-party/CmuxExtensionKit
cp $ROOT/build/cmux-sdk/LICENSE $STAGE/third-party/CmuxExtensionKit/LICENSE
print "CmuxExtensionKit sources: https://github.com/manaflow-ai/cmux/tree/$(<$ROOT/build/cmux-sdk/COMMIT)/Packages/macOS/CmuxExtensionKit" \
  >$STAGE/third-party/CmuxExtensionKit/SOURCE

tar -czf $DIST/tamago-$VERSION.tar.gz -C $DIST tamago-$VERSION
sed "s/^RELEASE=\"\"/RELEASE=\"$VERSION\"/" $ROOT/scripts/install.sh >$DIST/install.sh
grep -q "^RELEASE=\"$VERSION\"" $DIST/install.sh || { print -u2 "couldn't stamp the version into install.sh"; exit 1; }
(cd $DIST && shasum -a 256 tamago-$VERSION.tar.gz install.sh >SHA256SUMS)
rm -rf $STAGE
print "packaged $DIST:"
ls -la $DIST
