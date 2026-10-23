# Tamago

A tiny ASCII pet for the [cmux](https://cmux.com) terminal, in the spirit of the Claude Code
`/buddy` April Fools companion. It lives at the bottom of cmux's left sidebar, under your workspace
list, watches all your coding-agent sessions, and now and then remarks on one of them, no matter
which workspace is open. How it says it depends on its species' character and its current mood.

```
  ┌──────────────────────────────────┐
  │ re: api-server                   │
  │ Third red test run in a row. I'm │
  │ starting to think it likes you.  │
  └──────────────────────────────────┘
      ╲
                                  2m ago
         ╲
       .----.   Tama
      / °  ° \
      |      |
      ~`~``~`~
```

## Install

You need macOS 14 or newer, [cmux](https://cmux.com) in `/Applications`, Node.js 18 or newer
(`brew install node`), and the [Claude Code](https://claude.com/claude-code) CLI, logged in.
Paste this into a terminal **inside cmux** (cmux only lets processes started there talk to it):

```sh
curl -fsSL https://github.com/mcurses/tamago/releases/latest/download/install.sh | zsh
```

It puts Tamago in `~/.local/share/tamago`, installs the sidebar to `~/Applications/Tamago.app`,
adds one marked line to your `~/.zshrc` (or `~/.bashrc`, or fish's `conf.d`) so Tama comes back
whenever cmux restarts, adds a `tamago` command to `~/.local/bin`, and starts Tama. Then, once,
in cmux:

1. Settings → Custom Sidebars → turn on **Extensions** (the installer opens that page if needed).
2. Right-click the sidebar toggle button (top left) and pick **Extension Sidebar**.
3. If the sidebar says Tamago needs approval: **Manage** → switch Tamago on → **Review Access…** →
   **Allow Requested Access**. It asks for the workspace list and names, and for selecting
   workspaces.

Right-click Tama to feed, pet or poke it, pick one of 19 species, rename it, or change how much it
talks.

Tama writes its remarks with `claude -p`, so they count against your Claude usage, a little (one
short call per remark; how often depends on **Talk**, below). What it sends is described under
[Privacy](#privacy).

## What it does

- **Watches every session.** Every finished Claude Code turn, in any workspace and with any
  account (`~/.claude*`), may get a remark. It comes a bit later and only sometimes, not as an
  instant reply. Tama sees a digest of the session: what you asked, what the agent said, the files
  it edited and a few lines of its last edit, the last commands, errors, failing test lines and
  diff size, plus what happened in your other sessions lately. It remarks on the work itself (a
  claim that doesn't add up, a skipped step, something done well), as an observation, never
  advice.
- **Quiet when you're away.** After 5 minutes without keyboard or mouse input, Tama keeps watching
  but says nothing, so overnight runs with a dark screen cost nothing. When you come back after
  30 minutes or more, it tells you what the sessions did meanwhile.
- **Remembers.** Tama keeps a diary of what it said, so it follows up on itself instead of
  repeating jokes. The diary belongs to the species: after a switch, the new one knows what
  happened but not what the old one said, as if it had always been this species.
- **19 looks and characters.** The egg, plus the 18 original `/buddy` species: duck, goose, blob,
  cat, dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot,
  rabbit, mushroom and chonk. Each is animated, has its own personality, likes and dislikes (the
  robot hates slow turns and loves green tests, the penguin is scandalized by giant diffs, the
  ghost adores failing things at 3 a.m.), and its eyes show its mood. Now and then it also does
  something, like `*rattles spines at the sidebar*`.
- **A mood.** It drifts on its own, follows the time of day, and moves with what happens in your
  sessions and with feeding, petting and poking. Nothing needs looking after: left alone, Tama
  settles into its character's normal mood.
- **A full workspace sidebar.** Click a row to switch, drag to reorder, right-click for Rename,
  Pin, Mark as Read, Move, Color and Close. Rows show what cmux's own sidebar shows (agent status,
  description, latest notification, branch and directory, progress, logs, live ports, pull
  requests, SSH targets), following cmux's switches in Settings → Sidebar, plus a faint dot per
  Claude Code session running in the workspace.

## Settings

Right-click Tama:

| Menu | Choices | Default |
|---|---|---|
| **Talk** | Chatty, Normal, Quiet, Muted. Chatty remarks about twice as often as Normal; Quiet about a third as often and never on idle stretches or workspace switches; Muted only answers Feed, Pet and Poke. | Normal |
| **Species**, **Rename** | 19 species; any name | Egg, "Tama" |
| Settings → **Model** | Haiku (lightest on your usage), Sonnet, Opus (heaviest). Haiku is blander and slips into advice more. | Sonnet |
| Settings → **Language** | English, German, Spanish, French, Italian, Portuguese, Dutch, Polish, Japanese, Korean, Chinese; any other with `tamago set` | English |
| Settings → **Claude Session Dots** | on, off | on |
| Settings → **Check for Updates Daily** | on, off | on |

What each workspace row shows is cmux's own setting: Settings → Sidebar in cmux.

The same from a terminal:

```sh
tamago set                    # show all settings
tamago set talk=quiet
tamago set language=Swedish
tamago set model=haiku        # or any model id claude --model takes
tamago species capybara       # tamago species lists them
tamago name Pip
```

They're stored in `~/.local/state/tamago/settings.json` and apply at once.

## Updating

A release install checks GitHub for a newer release once a day. When there is one, Tama says so
once, and the right-click menu offers **Update Tamago to …**. Or run `tamago update`. The update
downloads the release, swaps it in (the previous one stays in `~/.local/share/tamago.previous`)
and restarts Tama. If the sidebar itself changed, cmux shows "Extension Blocked" once; click
**Try Again**.

## Uninstall

```sh
tamago uninstall              # keeps Tama's memory in ~/.local/state/tamago
tamago uninstall --forget     # deletes that too
```

This stops Tama and removes the sidebar, `~/Applications/Tamago.app`, the line in your shell's
startup file, the `tamago` command and `~/.local/share/tamago`. Afterwards, right-click cmux's
sidebar toggle button to pick another sidebar.

## Privacy

- **To Anthropic, through your Claude Code login:** for each remark, a prompt with the digest
  described above: your last prompt, excerpts of the agent's answer, file names, a few lines of
  the last edit, command lines and error lines, workspace titles, and Tama's diary. Edits to files
  that look private (`.env`, keys, anything named secret, token, password or credential) are never
  quoted. Tama's calls run with hooks and tools off.
- **To GitHub:** one request a day for the latest release, while the update check is on.
- **Nothing else leaves your Mac.** The sidebar talks to Tama's daemon on `127.0.0.1:47321` with a
  token from `~/.local/state/tamago/token`, which only you can read.

## Commands

```sh
tamago help
tamago log                    # follow what Tama notices and says
tamago mood                   # the mood, what shaped it, the character's tastes
tamago version                # this version, and whether a newer one is out
tamago restart
tamago say "hello" happy      # push a remark by hand
```

Everything Tama keeps is in `~/.local/state/tamago/`: the log, `pet.json`, `mood.json`,
`settings.json`, the diary (`history.jsonl`) and the token.

## Troubleshooting

- **Tama never says anything.** Check `tamago log`. Each finished turn should appear as `turn ended
  in …`. `Access denied - only processes started inside cmux` means the daemon was started outside
  a cmux terminal; open a new cmux terminal and it gets replaced. `you're away` means no keyboard
  or mouse input for 5 minutes. Talk set to Quiet or Muted explains a lot too.
- **The sidebar says "Extension Blocked".** Click **Try Again**. It happens once after the sidebar
  was updated.
- **The sidebar shows the egg named Tama and never a remark.** The daemon isn't running: open a
  new cmux terminal, or run `tamago restart`.
- **`tamago: command not found`.** Add `~/.local/bin` to your `PATH`, or run
  `~/.local/share/tamago/scripts/install.sh` again to see what's missing.

## Advanced: environment variables

For tuning beyond the menu. Set them in front of the `ensure-running.sh` line in your shell's
startup file. A setting picked in the menu wins over its variable.

| Variable | Default | Meaning |
|---|---|---|
| `TAMAGO_TALK`, `TAMAGO_MODEL`, `TAMAGO_LANG` | `normal`, `sonnet`, `English` | Defaults for Talk, Model and Language |
| `TAMAGO_NO_UPDATE_CHECK` | unset | `1` turns the daily update check off by default |
| `TAMAGO_CHANCE` | `0.35` | Base chance to remark on a finished turn on Normal (at least 0.7 for turns the character cares about strongly), scaled by mood |
| `TAMAGO_DELAY_S` | `20-90` | Seconds between a turn ending and the remark |
| `TAMAGO_COOLDOWN_S` | `150` | Minimum quiet time between remarks on Normal |
| `TAMAGO_ACTION_CHANCE` | `0.3` | How often a remark comes with an action |
| `TAMAGO_AWAY_S`, `TAMAGO_BACK_S` | `300`, `1800` | No input this long counts as away; a break this long gets a welcome back |
| `TAMAGO_PORT` | `47321` | Port of the daemon's local server (the prebuilt sidebar expects 47321) |
| `TAMAGO_CLAUDE` | auto | Path to the real `claude` binary. Use the real binary, not cmux's wrapper, which would log Tama's calls as workspace prompts. |

## Mood

The mood has two parts: valence (miserable to delighted) and energy (asleep to hyper). It isn't
shown as text; you see it in Tama's eyes and hear it in what Tama says. Underneath runs an
underlying mood that changes on its own every 3 to 36 hours, for no reason: mostly mild, but now
and then Tama just has a really good or a really bad day. Without any input, the mood drifts
toward the character's baseline plus that underlying mood, so a quiet day isn't a neutral one.

Each species' character in `daemon/mood.mjs` sets a baseline the mood drifts back to over an hour
or two, when it's awake, how talkative it is, what it likes and hates, and how it takes feed, pet
and poke. Finished turns are tagged (tool errors, failing or passing tests, slow or quick turns,
giant or tidy diffs, commits, late night) and the character feels the ones it cares about; so do
hopping between sessions and long quiet stretches. Nice things wear off when repeated, annoying
ones add up.

## Development

### From a checkout

```sh
git clone https://github.com/mcurses/tamago.git ~/code/tamago
~/code/tamago/scripts/build-extension.sh    # the compiled sidebar; needs Xcode, no developer account
~/code/tamago/scripts/install.sh            # run in a cmux terminal
```

`build-extension.sh` downloads cmux's extension SDK (GPL-3.0, not part of this repo) at the commit
of cmux 0.64.22, compiles it with `swiftc`, and installs an ad-hoc signed
`~/Applications/Tamago.app`. Run it again after pulling changes. `install.sh` from a checkout
points the startup line and the `tamago` command at the checkout. A checkout never updates itself:
`git pull`, then run both scripts again.

Without the build, `install.sh` selects the script sidebar instead (`sidebar/tamago.swift`, which
cmux interprets at runtime). It can't scroll the workspace list on its own, so the whole sidebar
scrolls, and its footer is pinned with an explicit height: set `windowHeight()` at the top of the
file to your cmux window's height in points (default 1084, a full-height window on a 14" MacBook
Pro). It hot-reloads when you save. It has no Feed / Pet / Poke menu.

```sh
node --test test/*.test.mjs                                    # tests
node daemon/tamago.mjs --peek --brain                          # Tama's context for the open workspace, plus a sample line
node daemon/tamago.mjs --compare 8                             # replay the last 8 remarks on Haiku and Sonnet into build/compare.md
scripts/render-pet.sh                                          # draw the footer's animations to build/pet-sheet.png
TAMAGO_DELAY_S=2-4 TAMAGO_CHANCE=1 node daemon/tamago.mjs --dry-run   # log-only test run
```

### Releasing

Push a tag like `v0.2.0`. The release workflow runs the tests, builds a universal `Tamago.app`
with `scripts/package.sh`, and publishes `tamago-v0.2.0.tar.gz`, `install.sh` (with the version
stamped in) and `SHA256SUMS` as a GitHub release. Installed copies pick it up with their next daily
check. `scripts/package.sh v0.2.0` builds the same files locally into `build/dist/`.

### How it works

- `daemon/tamago.mjs` polls the cmux sidebar snapshot to notice workspace switches, hopping and
  idle time, and reads finished turns from the Claude Code transcripts themselves (every
  `~/.claude*/projects`), so sessions started without cmux's hooks count too. When it decides to
  speak, it builds a prompt from `daemon/transcript.mjs` (a digest of the transcript), the
  cross-session timeline, its diary, and its character and mood (`daemon/mood.mjs`), and asks
  `claude -p` for a one-liner as JSON (`{mood, action, text}`). A line too close to a recent one
  (`daemon/repeats.mjs`) gets a retry; if that repeats too, Tama stays quiet.
- `extension/` is the compiled sidebar, a sandboxed ExtensionKit extension:
  `TamagoSidebarExtension.swift` (entry point), `SidebarModel.swift`, `SidebarView.swift` (list,
  menus, footer and reaction animations), `Pet.swift` (sprites) and `DaemonClient.swift`. It reads
  workspaces from cmux itself; Tama and every workspace action cmux's extension API lacks (pin,
  rename, reorder, colors, close) go through `daemon/server.mjs` (`GET /state`, `POST /action`).
  The sandbox lets it read exactly one file outside its container, the daemon's token.
  `extension/Harness/` renders the footer offscreen for `scripts/render-pet.sh`.
- `daemon/details.mjs` collects the per-workspace details (status pills, progress and log from
  `cmux sidebar-state`, re-read on cmux `sidebar` events and once a minute) and reads cmux's
  sidebar settings from its preferences and `cmux.json`. Ports are checked against what actually
  listens, since cmux keeps a stopped dev server's port around.
- `daemon/settings.mjs` holds Tamago's own settings, `daemon/update.mjs` the release check and
  self-update.
- `sidebar/tamago.swift` is the script sidebar. It can't read files or the network, so the daemon
  puts one workspace progress label, `tamago|<epoch>|<mood>|<about>|<text>|<species>|<name>`, on
  the workspace the remark is about, and the sidebar finds it. Its menu items set a workspace
  description to a marker such as `tamago:rename` or `tamago:species:ghost`, which the daemon
  picks up and undoes. `scripts/gen-species.mjs` bakes `sidebar/species.json` into it, because it
  can't load data at runtime.

### cmux constraints found (0.64.22)

- Custom sidebars have no files, network or timers. The writable channels that reach them are
  `set-progress --label` and the workspace description; `set-status` doesn't.
- The root view of an interpreted sidebar sits in a vertical scroll view that also covers the
  title bar, so `Spacer`/`safeAreaInset` can't pin a footer; hence the explicit height knobs.
  Compiled (ExtensionKit) sidebars get a fixed-height area below cmux's header strip instead,
  with a fade over the bottom ~40pt.
- `\n`, `\\` and `\"` in string literals are not unescaped, but raw strings (`#"…"#`) work.
  `obj != nil` is unreliable; use interpolation (`"\(w.progress.label)"`) to tolerate missing
  values.
- A button action has to be a `cmux(...)` call itself. A helper `func` that calls `cmux` runs
  nothing.
- The cmux socket (default mode `cmuxOnly`) only admits processes started inside a cmux terminal.
  Detached children keep access. launchd jobs and `notifications.command` in cmux.json don't,
  hence the line in the shell's startup file. A daemon that loses access after a cmux restart
  stays up for the sidebar and Feed/Pet/Poke, and the next cmux shell replaces it.
- `TextField`/`@State` only exist in cmux's newer `.js` sidebar engine.
- Replacing a compiled extension's binary makes cmux 0.64 show "Extension Blocked" until Try
  Again is clicked.

## Credits

The species art comes from
[ramarivera/coding-buddy](https://github.com/ramarivera/coding-buddy) (MIT License, © 2026
coding-buddy contributors), an open-source recreation of Claude Code's `/buddy`. The attribution is
kept in `sidebar/species.json`. The prebuilt `Tamago.app` contains cmux's CmuxExtensionKit
(GPL-3.0-or-later, © Manaflow, Inc.); its license and a link to its source ship in the release's
`third-party/` folder.

## License

MIT, see [LICENSE](LICENSE). The release's `Tamago.app` also contains CmuxExtensionKit, so that
binary as a whole is distributed under GPL-3.0-or-later; this repository is its source.
