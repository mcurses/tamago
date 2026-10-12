# Tamago

A tiny ASCII pet ("Tama") pinned to the bottom of the cmux left sidebar. It watches all your
sessions and now and then makes a snarky, deliberately unhelpful one-liner about the focused one.

- `sidebar/tamago.swift`: cmux custom sidebar (workspace list + pinned pet). Symlinked into
  `~/.config/cmux/sidebars/`, hot-reloads on save.
- `daemon/tamago.mjs`: follows `cmux events` (agent hook events) and the sidebar snapshot. When a
  coding-agent turn ends in the focused workspace it maybe (35%, 70% if the turn had errors, failing
  tests or a big diff) comments 20-90 s later, using a digest of the Claude transcript
  (`daemon/transcript.mjs`) plus a log of recent turns in other workspaces. Also reacts to tab
  hopping, dwelling on a workspace and long idle stretches. Lines come from Haiku via `claude -p`
  and reach the sidebar through the focused workspace's progress label as
  `tamago|<epoch>|<mood>|<text>`.

```sh
./scripts/install.sh               # from a cmux terminal
node daemon/tamago.mjs --say "hi" happy   # push one comment by hand
node daemon/tamago.mjs --peek --brain     # show Tama's context for the focused workspace + a sample line
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
- `\n` and `\\` in string literals are not unescaped; `obj != nil` is unreliable, use
  interpolation (`"\(w.progress.label)"`) to tolerate missing values.
- The cmux socket only admits processes cmux is responsible for (survives detaching, not launchd),
  so the daemon is started from a cmux shell by `scripts/ensure-running.sh`.
- Tama's own LLM calls use `/opt/homebrew/bin/claude` with hooks disabled; the `claude` wrapper on
  PATH inside cmux would record them as workspace prompts.
