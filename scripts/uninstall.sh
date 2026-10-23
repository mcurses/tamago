#!/bin/zsh
# Remove Tamago: stop the daemon, unregister and delete the sidebar (and the script sidebar older
# versions linked), drop the start line from your shell's startup file and
# the tamago command. Tama's memory in ~/.local/state/tamago stays unless you pass --forget.
#
# TAMAGO_TEST=1 touches nothing outside $HOME (no pluginkit), for tests.
ROOT=${0:A:h:h}
STATE=$HOME/.local/state/tamago
SHARE=${TAMAGO_HOME:-$HOME/.local/share/tamago}
APP=$HOME/Applications/Tamago.app
MARK="# Tamago: keeps the pet's daemon running in cmux (remove with: tamago uninstall)"

if [[ -f $STATE/tamago.pid ]]; then
  PID=$(<$STATE/tamago.pid)
  kill -TERM $PID 2>/dev/null && for i in {1..20}; do kill -0 $PID 2>/dev/null || break; sleep 0.25; done
fi
rm -f ~/.config/cmux/sidebars/tamago.swift ~/.local/bin/tamago

if [[ -d $APP ]]; then
  if [[ -z ${TAMAGO_TEST-} ]]; then
    pkill -f "$APP/Contents/Extensions/TamagoSidebar.appex/Contents/MacOS/TamagoSidebar" || true
    pluginkit -r $APP/Contents/Extensions/TamagoSidebar.appex 2>/dev/null || true
  fi
  rm -rf $APP
fi

# The line install.sh added (the marker and the line after it), in whichever startup file has it.
for RC in ${ZDOTDIR:-$HOME}/.zshrc ~/.bashrc; do
  if grep -qsF "$MARK" $RC; then
    # Drops the marker, the line after it, and the blank line install.sh put before them.
    MARK=$MARK awk '/^$/ { if (held) print ""; held = 1; next }
      $0 == ENVIRON["MARK"] { held = 0; getline; next }
      { if (held) print ""; held = 0; print }
      END { if (held) print "" }' $RC >$RC.tamago-new
    cat $RC.tamago-new >$RC && rm $RC.tamago-new
    print "tamago: removed the start line from $RC"
  elif grep -qs "tamago/scripts/ensure-running.sh" $RC; then
    print "tamago: $RC still starts Tama; delete the line with tamago/scripts/ensure-running.sh"
  fi
done
rm -f ~/.config/fish/conf.d/tamago.fish

# A release install lives in ~/.local/share; a git checkout stays where you cloned it.
[[ $ROOT == $SHARE ]] && rm -rf $SHARE $SHARE.previous $SHARE.incoming
if [[ ${1-} == --forget ]]; then
  rm -rf $STATE
  print "tamago: removed, and Tama's memory with it."
else
  print "tamago: removed. Tama's memory is still in $STATE (uninstall.sh --forget deletes it)."
fi
print "tamago: if cmux still shows Tama's sidebar, right-click the sidebar toggle button to pick another."
