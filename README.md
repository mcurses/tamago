# Tamago

A tiny ASCII pet ("Tama") pinned to the bottom of the cmux left sidebar. It watches all your
sessions and now and then makes a snarky, deliberately unhelpful one-liner about one of them, no
matter which workspace is open.

- `sidebar/tamago.swift`: cmux custom sidebar (workspace list + pinned pet). Symlinked into
  `~/.config/cmux/sidebars/`, hot-reloads on save.
- `daemon/tamago.mjs`: follows `cmux events` (agent hook events) and the sidebar snapshot. When a
  coding-agent turn ends in any workspace it maybe (35%, 70% if the turn had errors, failing tests
  or a big diff) comments 20-90 s later, using a digest of the Claude transcript
  (`daemon/transcript.mjs`) plus a log of recent turns in other workspaces. If several sessions
  finish close together it picks the most interesting turn; one cooldown covers all sessions. Also
  reacts to tab hopping, dwelling on a workspace and long idle stretches. Lines come from Haiku via
  `claude -p`. There is one global bubble: a single progress label
  `tamago|<epoch>|<mood>|<about>|<text>` on one workspace (the one it is about, or a free one if
  that shows real progress), which the sidebar finds wherever it is and shows as "re: <about>".
- Species: right-click Tama and pick one of the 18 Claude Code `/buddy` species (or the default
  egg), or run `node daemon/tamago.mjs --species <name>`. The art is vendored in
  `sidebar/species.json` from the MIT-licensed clone
  [ramarivera/coding-buddy](https://github.com/ramarivera/coding-buddy) and baked into
  `tamago.swift` by `node scripts/gen-species.mjs`. The choice lives in
  `~/.local/state/tamago/species.json`; the daemon adds it to the label as a sixth field, so with
  the daemon stopped the sidebar shows `defaultSpecies()`.
- Rename: sidebars have no text input in 0.64.22, so the menu item sets the description to a
  marker and the daemon shows a native dialog. Without the daemon, Rename does nothing.

```sh
./scripts/install.sh               # from a cmux terminal
node daemon/tamago.mjs --say "hi" happy   # push one comment by hand
node daemon/tamago.mjs --peek --brain     # show Tama's context for the open workspace + a sample line
TAMAGO_DELAY_S=2-4 TAMAGO_CHANCE=1 node daemon/tamago.mjs --dry-run   # fast, log-only test run
tail -f ~/.local/state/tamago/tamago.log
./scripts/uninstall.sh
```

## cmux constraints found (0.64.22)

- Custom sidebars can't touch files, network or timers; comments must come in via cmux data.
  Writable channels that reach the sidebar: `set-progress --label`, workspace description.
  `set-status` does not.
- The root view sits in a vertical scroll view, so `Spacer`/`safeAreaInset` can't pin a footer.
  Heights are explicit knobs at the top of `tamago.swift` (`sidebarHeight`, `footerHeight`).
- `\n`, `\\` and `\"` in string literals are not unescaped (raw strings `#"…"#` work); `obj != nil` is unreliable, use
  interpolation (`"\(w.progress.label)"`) to tolerate missing values.
- The cmux socket (default mode `cmuxOnly`) only admits processes started inside a cmux terminal.
  Detached children keep access; launchd jobs and `notifications.command` in cmux.json do not
  (tested). So the daemon is started from a cmux shell by `scripts/ensure-running.sh`; to survive
  cmux restarts, call that script from `~/.zshrc` (cmux reopens its terminals on launch):
  `[[ -n "$CMUX_SOCKET_PATH" ]] && ~/code/tamago/scripts/ensure-running.sh 2>/dev/null`.
  `TextField`/`@State` exist only in the newer `.js` sidebar engine (not in 0.64.22).
- Tama's own LLM calls use `/opt/homebrew/bin/claude` with hooks disabled; the `claude` wrapper on
  PATH inside cmux would record them as workspace prompts.
