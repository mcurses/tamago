# Tamago

A tiny ASCII pet for the [cmux](https://cmux.com) terminal, in the spirit of the Claude Code
`/buddy` April Fools companion. It lives at the bottom of cmux's left sidebar, under your workspace
list. It watches all your coding-agent sessions and now and then makes a cute, deliberately
unhelpful one-liner about one of them, no matter which workspace is open. How it says it depends
on its species' character and its current mood.

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

- **A global watcher.** Every finished Claude Code turn, in any workspace, may get a comment. It
  comes a bit later and only sometimes, not as an instant reply. Comments use a digest of the
  session transcript: what you asked, what the agent said, the files it edited and a few lines of
  its last edit (never from `.env`, keys or similar), the last commands, errors, failing test lines
  and diff size. They also see what happened in your other sessions recently. Tama remarks on the
  work itself (a claim that doesn't add up, a skipped step, something done well), as an
  observation, never advice. Idle stretches and workspace switches only rarely get a remark.
- **A memory.** Tama keeps a diary of what it said, so it can follow up on itself instead of
  repeating the same jokes. The diary belongs to the species: after a switch, the new one knows
  what happened (turns, switches, feedings) but not what the old one said, as if it had always
  been this species. A line too close to a recent one (daemon/repeats.mjs) gets one retry; if
  that repeats too, Tama stays quiet.
- **19 looks.** The default egg, plus the 18 original `/buddy` species: duck, goose, blob, cat,
  dragon, octopus, owl, penguin, turtle, snail, ghost, axolotl, capybara, cactus, robot, rabbit,
  mushroom and chonk. Each is animated, and its eyes show its mood.
- **A character and a mood.** Every species has its own personality, likes and dislikes: the
  robot hates slow turns and loves green tests, the penguin is scandalized by giant diffs, the
  ghost adores failing things at 3 a.m., the snail distrusts speed. The mood drifts slowly on its
  own, follows the time of day (larks and night owls), and moves with what happens in your sessions. It colors what Tama says and how often it bothers to talk;
  things its character cares about strongly make a comment likelier.
- **Actions.** Now and then (about a third of the comments) Tama also does something, like
  `*rattles spines at the sidebar*` or `*shuffles roots deeper, pot creaking under protest*`. The
  daemon decides when; the action is made up fresh each time from what the species has to act
  with (spines and pot for the cactus, sheet and chains for the ghost). `TAMAGO_ACTION_CHANCE`
  changes how often.
- **Feed, Pet, Poke.** Right-click Tama in the compiled sidebar. Nothing needs looking after: left
  alone, Tama settles into its character's normal mood; these just nudge it. Each species takes them
  differently (a cactus hates all three, a cat only likes petting when it's in a good mood, nobody
  likes being poked ten times in a row), with a short animation
  and a reply.
- **A full workspace sidebar.** Click a row to switch, drag to reorder, right-click for Rename,
  Pin, Mark as Read, Move, Color and Close. The compiled sidebar also shows what cmux's own
  sidebar shows per workspace: agent status pills and the working spinner, description, latest
  notification, branch and directory, progress, log lines, ports and pull requests (clickable) and
  SSH targets. It follows cmux's own switches in Settings → Sidebar (or `"sidebar"` in
  `cmux.json`), so turn details on and off there. Ports nothing listens on anymore are left out,
  since cmux keeps a stopped dev server's port around.

## Requirements

- macOS with [cmux](https://cmux.com) installed in `/Applications`. Developed against cmux
  0.64.22.
- Node.js 18 or newer (`node` on your PATH).
- The [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI, logged in. Tama writes its
  lines with `claude -p --model haiku`, so they count against your Claude usage, a little. Its
  context (excerpts of your session transcripts) goes to Anthropic like any other Claude Code
  request.
- Claude Code running inside cmux with cmux's agent hooks, which is cmux's default. Tama learns
  about finished turns from them.

## Setup

1. **Clone and install.** Run this from a terminal inside cmux; the cmux socket only accepts
   processes started in a cmux terminal.

   ```sh
   git clone https://github.com/mcurses/tamago.git ~/code/tamago
   ~/code/tamago/scripts/install.sh
   ```

   This symlinks `sidebar/tamago.swift` into `~/.config/cmux/sidebars/`, selects it as the left
   sidebar, and starts the daemon in the background.

2. **Start it automatically.** cmux reopens its terminals when it launches, so a line in
   `~/.zshrc` brings Tama back after every cmux restart. If Tama is already running, the line
   does nothing.

   ```sh
   echo '[[ -n "$CMUX_SOCKET_PATH" ]] && ~/code/tamago/scripts/ensure-running.sh 2>/dev/null' >> ~/.zshrc
   ```

   Without it, start Tama by hand after a restart with `~/code/tamago/scripts/ensure-running.sh`.
   Rename in the sidebar menus needs the daemon too (see below).

3. **Optional, recommended: the compiled sidebar.** cmux has two kinds of custom sidebars. The
   one from step 1 is a script cmux interprets; it can't scroll the workspace list on its own, so
   the whole sidebar scrolls. The compiled one is a real SwiftUI sidebar extension: the workspace
   list scrolls by itself, Tama stays put, and rename happens inline. It needs Xcode (for the
   macOS SDK; no Apple developer account) and is built with:

   ```sh
   ~/code/tamago/scripts/build-extension.sh
   ```

   This downloads cmux's extension SDK (GPL-3.0, not part of this repo) at the commit of cmux
   0.64.22, compiles it with `swiftc`, and installs an ad-hoc signed `~/Applications/Tamago.app`
   that only holds the extension. Then, once, in cmux:

   - Settings → Custom Sidebars → turn on **Extensions** (or set
     `"extensions": { "beta": { "enabled": true } }` in `cmux.json`).
   - Right-click the sidebar toggle button and pick **Extension Sidebar**. In minimal mode the
     button only shows while you hover the top of the stock sidebar; with a custom sidebar active,
     click **Use Default** first.
   - If the sidebar says Tamago needs approval, open **Manage**, switch Tamago on, then
     **Review Access…** → **Allow Requested Access**. It asks for the workspace list and names
     and for selecting workspaces.

   The extension runs in the macOS sandbox, so for Tama and for every workspace action cmux's
   extension API lacks (pin, rename, reorder, colors, close) it talks to the daemon on
   `127.0.0.1:47321`, using a token the build script generates and bakes in. Without the daemon,
   the list and selecting still work. After pulling changes, run the build script again; if
   cmux shows "Extension Blocked", click **Try Again**.

4. **If you use the interpreted sidebar: fit it to your screen.** cmux wraps interpreted sidebars
   in a scroll view, so the footer is pinned with an explicit height. Open `sidebar/tamago.swift` and set `windowHeight()` to your
   cmux window's height in points. The default, 1084, is a full-height window on a 14" MacBook
   Pro. If the whole sidebar scrolls, lower the number; if there's a gap under Tama, raise it.
   The sidebar hot-reloads when you save.

To switch back to the stock sidebar, right-click cmux's sidebar toggle button. To remove Tamago
completely, run `scripts/uninstall.sh` and delete the line from `~/.zshrc`.

## Choosing a species and a name

Right-click Tama, or right-click any workspace row and open the submenu at the bottom named after your pet:

- **Species** → pick one; the sidebar updates within a few seconds.
- **Rename Tama…** → type a new name in the dialog.

Or from a terminal:

```sh
node ~/code/tamago/daemon/tamago.mjs --species        # list species and show the current one
node ~/code/tamago/daemon/tamago.mjs --species capybara
node ~/code/tamago/daemon/tamago.mjs --name Pip
```

The choice is stored in `~/.local/state/tamago/pet.json`. The daemon passes it to the sidebar, so
while the daemon isn't running the sidebar shows the egg named Tama. You can change that fallback
with `defaultSpecies()` / `defaultName()` in `tamago.swift`.

## Mood

The mood has two parts: valence (miserable to delighted) and energy (asleep to hyper). It isn't
shown as text; you see it in Tama's eyes and hear it in what Tama says. Underneath runs an underlying mood that changes on
its own every 3 to 36 hours, for no reason: mostly mild, but now and then Tama just has a really
good or a really bad day. Without any input, the mood drifts toward the character's baseline plus
that underlying mood, so a quiet day isn't a neutral one.
Each species' character in `daemon/mood.mjs` sets a baseline the mood drifts back to over an hour
or two, when it's awake, how talkative it is, what it
likes and hates, and how it takes feed, pet and poke. Finished turns are tagged (tool errors,
failing or passing tests, slow or quick turns, giant or tidy diffs, commits, late night) and the
character feels the ones it cares about; so do hopping between sessions and long quiet stretches.
Nice things wear off when repeated, annoying ones add up.

```sh
node ~/code/tamago/daemon/tamago.mjs --mood     # current mood, what shaped it, the character's tastes
```

The mood is stored in `~/.local/state/tamago/mood.json`. The interpreted sidebar has no Feed / Pet
/ Poke menu; the mood still shapes what Tama says there.

## Settings

What the compiled sidebar shows per workspace follows cmux's sidebar settings (Settings → Sidebar:
show branch and directory, ports, pull requests, log, progress, status pills, agent activity,
notification text, hide all details, …). The daemon reads them every 10 seconds. Branch and pull
request data need cmux's "watch git status" setting.

Tamago adds one thing of its own: a faint dot per Claude Code session running in a workspace,
next to its title (counted from the `claude` processes and the `CMUX_WORKSPACE_ID` in their
environment). Turn it off with right-click Tama → **Sidebar** → **Claude Session Dots**; the choice
is stored in `~/.local/state/tamago/settings.json`.

Environment variables for the daemon. Set them in the shell that starts it, for example in front
of `ensure-running.sh` in your `~/.zshrc` line.

| Variable | Default | Meaning |
|---|---|---|
| `TAMAGO_LANG` | `English` | Language Tama speaks |
| `TAMAGO_MODEL` | `sonnet` | Model for Tama's remarks; `haiku` is cheaper but blander and slips into advice more |
| `TAMAGO_CHANCE` | `0.35` | Base chance to comment on a finished turn (at least 0.7 for turns the character cares about strongly), scaled by how chatty and awake Tama is |
| `TAMAGO_DELAY_S` | `20-90` | Seconds between a turn ending and the comment |
| `TAMAGO_COOLDOWN_S` | `150` | Minimum quiet time between comments, across all sessions |
| `TAMAGO_POLL_MS` | `3000` | How often the daemon looks at cmux |
| `TAMAGO_NAME` | `Tama` | Name used until you pick one |
| `TAMAGO_CLAUDE` | auto | Path to the real `claude` binary. Use the real binary, not cmux's wrapper, which would log Tama's calls as workspace prompts. |

At the top of `sidebar/tamago.swift` you can also change `footerHeight()`, `bubbleWidth()`, how
long a comment stays (`showSeconds()`, default 20 minutes) and how long Tama "talks"
(`talkSeconds()`).

## Useful commands

```sh
tail -f ~/.local/state/tamago/tamago.log                  # what Tama notices and says
node daemon/tamago.mjs --peek --brain                     # Tama's context for the open workspace, plus a sample line
node daemon/tamago.mjs --say "hello" happy                # push a comment by hand
node daemon/tamago.mjs --mood                             # mood, causes, tastes
node daemon/tamago.mjs --compare 8                        # replay the last 8 turn remarks on Haiku and Sonnet into build/compare.md
scripts/render-pet.sh                                     # draw the compiled footer's animations to build/pet-sheet.png
node --test test/mood.test.mjs                            # mood engine tests
TAMAGO_DELAY_S=2-4 TAMAGO_CHANCE=1 node daemon/tamago.mjs --dry-run   # log-only test run
```

Its state is all in `~/.local/state/tamago/`: the log, the pid file, `pet.json`, `mood.json`, the
diary (`history.jsonl`) and saved workspace descriptions.

## Troubleshooting

- **Tama never says anything.** Check the log first. `Access denied - only processes started
  inside cmux` means the daemon was started outside a cmux terminal; start it again from a cmux
  terminal. Also check that a finished Claude turn shows up as `turn ended in …` in the log. If it
  doesn't, cmux's agent hooks aren't active for that session.
- **Rename or a species pick does nothing.** Those menu items write a short marker into a
  workspace description, and the daemon picks it up. The sidebar has no text input of its own.
  With the daemon stopped they wait until it's back.
- **The sidebar scrolls, or there's a gap under Tama.** Adjust `windowHeight()` (Setup, step 4).

## How it works

- `sidebar/tamago.swift` is a cmux custom sidebar, a runtime-interpreted SwiftUI subset. It can't
  read files or the network, so everything reaches it through cmux data. The daemon puts one
  workspace progress label, `tamago|<epoch>|<mood>|<about>|<text>|<species>|<name>`, on the
  workspace the comment is about, or on a free one if that workspace shows real progress. The
  sidebar finds the label wherever it is.
- `daemon/details.mjs` collects the per-workspace details for the compiled sidebar (status
  pills, progress and log from `cmux sidebar-state`, re-read when cmux sends a `sidebar` event for
  that workspace and once a minute while the sidebar is in use) and reads cmux's sidebar settings
  from its preferences and `cmux.json`.
- `daemon/tamago.mjs` follows `cmux events` for agent hook events (turn ends, session starts) and
  polls the sidebar snapshot to notice workspace switches, hopping and idle time. When it decides
  to speak, it builds a prompt from `daemon/transcript.mjs` (a digest of the Claude Code
  transcript), the cross-session timeline, its diary, and its character and mood
  (`daemon/mood.mjs`). It then asks Haiku for a one-liner as
  JSON (`{mood, text}`).
- Sidebar menu items can't take text input or store anything, so they set a workspace description
  to a marker such as `tamago:rename` or `tamago:species:ghost`. The daemon restores the
  description and does the rest: a native dialog for names, `pet.json` for the species.
- `extension/` is the compiled sidebar: `TamagoSidebarExtension.swift` (entry point),
  `SidebarModel.swift`, `SidebarView.swift` (list, menus, footer and reaction animations),
  `Pet.swift` (sprites, same rules as the interpreted sidebar) and `DaemonClient.swift`.
  `extension/Harness/` renders the footer offscreen for `scripts/render-pet.sh`. `daemon/server.mjs` is its side of the conversation:
  `GET /state` and `POST /action`, both requiring the token.
- `scripts/gen-species.mjs` bakes `sidebar/species.json` into the sidebar file, because the
  sidebar can't load data at runtime. Run it after editing the species data.

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
  hence the `~/.zshrc` line.
- `TextField`/`@State` only exist in cmux's newer `.js` sidebar engine.

## Credits

The species art comes from
[ramarivera/coding-buddy](https://github.com/ramarivera/coding-buddy) (MIT License, © 2026
coding-buddy contributors), an open-source recreation of Claude Code's `/buddy`. The attribution is
kept in `sidebar/species.json`.
