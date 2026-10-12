# Tamago

A tiny ASCII pet ("Tama") pinned to the bottom of the cmux left sidebar. It watches all your
sessions and now and then makes a snarky, deliberately unhelpful one-liner about the focused one.

- `sidebar/tamago.swift`: cmux custom sidebar (workspace list + pinned pet). Symlinked into
  `~/.config/cmux/sidebars/`, hot-reloads on save.
- `daemon/tamago.mjs`: polls `cmux rpc extension.sidebar.snapshot`, detects events (new prompt,
  agent finished, workspace switch, tab hopping, idle), asks Haiku via `claude -p` for a line, and
  writes it to the focused workspace's progress label as `tamago|<epoch>|<mood>|<text>`.

```sh
./scripts/install.sh               # from a cmux terminal
node daemon/tamago.mjs --say "hi" happy   # push one comment by hand
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
