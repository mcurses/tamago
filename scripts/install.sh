#!/bin/zsh
# Install Tamago. Run it in a cmux terminal: the cmux socket only admits processes started there.
#
#   curl -fsSL https://github.com/mcurses/tamago/releases/latest/download/install.sh | zsh
#   scripts/install.sh                       from a git checkout or an unpacked release
#
# Piped from the web, it downloads the newest release into ~/.local/share/tamago and runs that
# release's copy of this script. Every step can run again: re-running repairs or updates an
# install. The daemon runs it with --after-update <pid> after it updated itself.
#
# TAMAGO_NO_SHELL_HOOK=1 skips the line in your shell's startup file (start Tama by hand then).
# TAMAGO_TEST=1 skips the cmux checks and calls and the app registration, for tests with a scratch $HOME.
set -euo pipefail
REPO=mcurses/tamago
RELEASE=""   # filled in by scripts/package.sh for the copy attached to a release
SHARE=${TAMAGO_HOME:-$HOME/.local/share/tamago}
CMUX=/Applications/cmux.app/Contents/Resources/bin/cmux
TEST=${TAMAGO_TEST:-}
STATE=$HOME/.local/state/tamago
say() { print -r -- "tamago: $*"; }
die() { print -r -- "tamago: $*" >&2; exit 1; }

ROOT=${0:A:h:h}
if [[ ! -f $ROOT/daemon/tamago.mjs ]]; then
  # Piped from the web: fetch the release, unpack it next to any current install, swap, continue there.
  [[ -n $RELEASE ]] || RELEASE=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep -m1 '"tag_name"' | cut -d'"' -f4)
  [[ -n $RELEASE ]] || die "couldn't find the latest release of $REPO"
  say "downloading $RELEASE"
  mkdir -p ${SHARE:h}
  rm -rf $SHARE.incoming && mkdir -p $SHARE.incoming
  curl -fsSL "${TAMAGO_DOWNLOAD:-https://github.com/$REPO/releases/download/$RELEASE/tamago-$RELEASE.tar.gz}" |
    tar -xz -C $SHARE.incoming --strip-components 1
  [[ -f $SHARE.incoming/daemon/tamago.mjs ]] || die "the download has no daemon"
  if [[ -d $SHARE ]]; then rm -rf $SHARE.previous && mv $SHARE $SHARE.previous; fi
  mv $SHARE.incoming $SHARE
  exec /bin/zsh $SHARE/scripts/install.sh "$@"
fi

AFTER_UPDATE=""
[[ ${1-} == --after-update ]] && AFTER_UPDATE=${2:-0}
VERSION=$(cat $ROOT/VERSION 2>/dev/null || git -C $ROOT describe --tags --always 2>/dev/null || echo dev)

# --- requirements -------------------------------------------------------------------------------
[[ -n $TEST || -x $CMUX ]] || die "cmux isn't installed in /Applications (https://cmux.com)"
[[ -n $TEST || -n ${CMUX_SOCKET_PATH-} ]] || die "run this in a cmux terminal; cmux only lets processes started there talk to it"
NODE=$(command -v node || print -l ~/.nvm/versions/node/*/bin/node(N) /opt/homebrew/bin/node(N) /usr/local/bin/node(N) | tail -1)
[[ -n $NODE ]] || die "Tama needs Node.js 18 or newer (brew install node, or https://nodejs.org)"
(( $($NODE -p 'process.versions.node.split(".")[0]') >= 18 )) || die "Tama needs Node.js 18 or newer, found $($NODE -v)"
if ! command -v claude >/dev/null && [[ ! -x ~/.claude/local/claude ]]; then
  say "warning: no claude command found. Tama writes its remarks with Claude Code (https://claude.com/claude-code); install it and log in."
fi

# --- sidebars -----------------------------------------------------------------------------------
mkdir -p ~/.config/cmux/sidebars $STATE
ln -sf $ROOT/sidebar/tamago.swift ~/.config/cmux/sidebars/tamago.swift
COMPILED=no
if [[ -d $ROOT/Tamago.app ]]; then
  APP=$ROOT/Tamago.app            # a release: prebuilt
elif [[ -d $ROOT/build/Tamago.app ]]; then
  APP=$ROOT/build/Tamago.app      # a checkout where scripts/build-extension.sh ran
else
  APP=""
fi
if [[ -n $APP ]]; then
  COMPILED=yes
  if [[ -n $TEST ]]; then
    mkdir -p ~/Applications && rsync -a --delete $APP/ ~/Applications/Tamago.app/
  else
    $ROOT/scripts/install-app.sh $APP | sed 's/^/tamago: /'
  fi
fi

# --- start it with every cmux terminal ----------------------------------------------------------
HOOK_SH="[[ -n \"\$CMUX_SOCKET_PATH\" ]] && \"$ROOT/scripts/ensure-running.sh\" 2>/dev/null"
MARK="# Tamago: keeps the pet's daemon running in cmux (remove with: tamago uninstall)"
case ${SHELL:t} in
  bash) RC=~/.bashrc; HOOK=$HOOK_SH ;;
  fish) RC=~/.config/fish/conf.d/tamago.fish; HOOK="set -q CMUX_SOCKET_PATH; and \"$ROOT/scripts/ensure-running.sh\" 2>/dev/null" ;;
  *) RC=${ZDOTDIR:-$HOME}/.zshrc; HOOK=$HOOK_SH ;;
esac
if [[ -z ${TAMAGO_NO_SHELL_HOOK-} && -z $AFTER_UPDATE ]]; then
  if grep -qs "tamago/scripts/ensure-running.sh" $RC; then
    # Already there; point it at this install if it's ours and names another one.
    if grep -qsF "$MARK" $RC && ! grep -qsF "$HOOK" $RC; then
      MARK=$MARK HOOK=$HOOK awk '{ print } $0 == ENVIRON["MARK"] { getline; print ENVIRON["HOOK"] }' $RC >$RC.tamago-new
      cat $RC.tamago-new >$RC && rm $RC.tamago-new  # cat keeps a symlinked rc file a symlink
      say "updated the start line in $RC"
    fi
  else
    mkdir -p ${RC:h}
    print -r -- $'\n'"$MARK"$'\n'"$HOOK" >>$RC
    say "added a line to $RC that starts Tama in new cmux terminals"
  fi
fi

# --- a `tamago` command -------------------------------------------------------------------------
mkdir -p ~/.local/bin
cat >~/.local/bin/tamago <<EOF
#!/bin/zsh
# Tamago's command line, written by $ROOT/scripts/install.sh.
ROOT="$ROOT"
NODE=\$(command -v node || print -r -- "$NODE")
case \${1-help} in
  help|-h|--help)
    print "usage: tamago <command>
  set [key=value]    show or change settings: talk (chatty, normal, quiet, muted), model, language, …
  species [name]     show or pick the species        name [name]   show or change the name
  mood               the mood and what shaped it     log           follow what Tama notices and says
  version            this version, and whether a newer one is out
  update             install the newest release      restart       restart the daemon
  uninstall          remove Tamago; Tama's memory stays unless you add --forget" ;;
  log) exec tail -f ~/.local/state/tamago/tamago.log ;;
  restart)
    [[ -f ~/.local/state/tamago/tamago.pid ]] && kill \$(<~/.local/state/tamago/tamago.pid) 2>/dev/null && sleep 1
    exec "\$ROOT/scripts/ensure-running.sh" ;;
  uninstall) shift; exec "\$ROOT/scripts/uninstall.sh" "\$@" ;;
  set|species|name|mood|version|update|say|peek) cmd=\$1; shift; exec "\$NODE" "\$ROOT/daemon/tamago.mjs" --\$cmd "\$@" ;;
  *) print -u2 "tamago: unknown command \$1 (try tamago help)"; exit 1 ;;
esac
EOF
chmod +x ~/.local/bin/tamago

# --- (re)start the daemon -----------------------------------------------------------------------
if [[ -n $AFTER_UPDATE ]]; then
  for i in {1..40}; do kill -0 $AFTER_UPDATE 2>/dev/null || break; sleep 0.25; done
elif [[ -f $STATE/tamago.pid ]] && kill -0 $(<$STATE/tamago.pid) 2>/dev/null; then
  OLD=$(<$STATE/tamago.pid)
  kill $OLD
  for i in {1..20}; do kill -0 $OLD 2>/dev/null || break; sleep 0.25; done
fi
$ROOT/scripts/ensure-running.sh
[[ -n $AFTER_UPDATE ]] && { print "$(date '+%F %T') install.sh: updated to $VERSION" >>$STATE/daemon.out; exit 0; }

# --- what's next --------------------------------------------------------------------------------
say "Tamago $VERSION is installed and running."
[[ :$PATH: == *:$HOME/.local/bin:* ]] || say "add ~/.local/bin to your PATH to use the tamago command."
if [[ $COMPILED == yes ]]; then
  ENABLED=$(defaults read com.cmuxterm.app extensions.beta.enabled 2>/dev/null || echo 0)
  print "\nShow Tama in cmux's sidebar (once):"
  [[ $ENABLED == 1 ]] || print "  - In the Settings window that opens: Custom Sidebars → turn on Extensions."
  print "  - Right-click the sidebar toggle button (top left) → Extension Sidebar.
  - If it says Tamago needs approval: Manage → switch Tamago on → Review Access… → Allow Requested Access.
Then right-click Tama to feed it, pick a species, or set how much it talks."
  [[ -n $TEST || $ENABLED == 1 ]] || $CMUX settings open custom-sidebars >/dev/null 2>&1 || true
else
  [[ -n $TEST ]] || $CMUX sidebar select tamago >/dev/null
  print "
Tama is in cmux's left sidebar now (the script sidebar). For the smoother compiled one, run
scripts/build-extension.sh (needs Xcode), or install a release instead of a checkout."
fi
