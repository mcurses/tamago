# Handoff, 2026-11-02: Tamago moves to meum

Written by the Tamago session that started this move. Max is continuing the work in a new session, run from
inside meum. This file is what that session needs to start without the old conversation.

## Where things stand

- **Tama runs on meum, live.**
  - Soup's background program (the daemon; pid in `~/.local/state/tamago/tamago.pid`) was restarted at
    14:30 on commit `28e9d15`. Its log says "watching meum (meum answers)".
  - It comments on meum sessions: at 16:46 it remarked on the "meum" workspace.
  - meum's Claude hooks are installed in all seven `~/.claude*` config dirs (`meum hooks status`).
- **Tama shows in meum's card under the sidebar**, as the widget `~/.local/share/meum/widgets/TamagoMeum.meumwidget`.
  It was built from `extension/Package.swift` with `scripts/build-meum-widget.sh`.
- **The cmux sidebar still works** from the same code, but while the daemon watches meum, cmux's extra details
  stop updating: status pills, ports and Claude session dots.
- **Nothing is pushed.** Max decides pushes and says "push". Six local commits sit on top of `origin/main`:
  - +1 on remarks
  - the +1 reason fix
  - taking swearing out again
  - the shared pet view
  - the meum widget
  - Tama watching meum

  This file is the seventh once committed.
- The untracked `package.json` and `test/transcript.test.mjs` aren't this work's; leave them uncommitted.

## What was built today (in order)

1. **Shared pet view.** `extension/Sources/PetModel.swift` (daemon polling and actions) and `PetFooter.swift`
   (sprite, bubble, +1, menu) no longer depend on cmux. `SidebarModel` subclasses `PetModel`. `PetFooter` takes
   `bottomInset` (40 in cmux, for its fade), `animating` (a still frame while hidden) and `inCmux` (hides the
   session-dots item and the cmux settings hint). `Pet.speciesURL` lets a host point at species.json.
2. **The meum widget.**
   - `extension/Package.swift` (product `TamagoMeum`, dynamic) and `extension/Meum/TamagoWidget.swift`.
   - The card follows Tama's measured height through `host.setPreferredHeight`, with Tama at the bottom.
   - The colour scheme comes from the card.
   - Polling and animation pause while meum says the widget isn't visible.
   - species.json sits next to the dylib and is found with `dladdr`.
3. **Daemon on meum.** `daemon/meum.mjs`:
   - maps `meum --json tree` onto the cmux snapshot shape the daemon already uses;
   - `hookEvent` reads `agent.hook` events (tab → workspace, transcript_path, prompt).

   `daemon/tamago.mjs` picks the host: `TAMAGO_HOST=cmux|meum|auto`. Auto means meum while `meum ping` answers,
   checked every 30 s. A transcript that a hook names is watched for turn ends even outside the workspace's dirs.
   The cmux-only work pauses on meum. Tests are in `test/meum.test.mjs`; 58 pass.

   Verified end to end on an isolated test meum with a fake model: hook → transcript → turn end → a remark
   about that workspace.

## Open requests (from the meum sessions, all at Max's request)

1. **Repo rename. Builds break until this is done.** meum moved from `~/code/mux` to `~/code/meum`, and its
   SwiftPM identity is now `meum`:
   - In `extension/Package.swift`, the default path `../../mux` becomes `../../meum`, and `package: "mux"`
     becomes `package: "meum"`.
   - In `scripts/build-meum-widget.sh`, `${ROOT:h}/mux` becomes `${ROOT:h}/meum`.
   - The README's development section mentions `../mux`.

   The installed widget keeps working until the next rebuild.
2. **Collapsed sidebar look.** meum's sidebar can collapse to a 60 pt rail (⌃⌘S). MeumKit added:
   - `MeumWidget.supportsCollapsedSidebar` (default false, which hides the widget);
   - `sidebarCollapsedDidChange(_:)` (it arrives before the animation and at start);
   - `MeumWidgetHost.isSidebarCollapsed`;
   - the card's `appearance.width` becomes 60.

   Wanted: a collapsed look, e.g. only the pet's face or a mood dot, about 60×60 to 60×90 pt, with no bubble.
   The pet's sprites are up to 12 monospaced characters wide (84 pt at 11 pt), so at 60 pt the face needs a
   smaller font or a one-line form. Examples: `~/code/meum/Examples/HelloWidget`. Docs:
   `~/code/meum/docs/design/sidebar-widgets-extensibility.md`, section "As built: the collapsed sidebar and
   workspace icons".
3. **One-click install from meum's widget library**, which needs the daemon to ship inside the widget.

   meum's side: `manifest.json` gets `"helper": {"command": "bin/tamago-daemon", "args": []}` and
   `"scope": "global"`. meum then:
   - starts one helper per installed widget at its own launch;
   - restarts it with backoff when it dies;
   - stops it (the process group) on disable, remove or quit;
   - passes `MEUM_SOCKET`, `MEUM_WIDGET_DATA` (`~/.local/state/meum/widgets/<id>/`) and a PATH that includes
     meum's bin;
   - logs the helper to `~/.local/state/meum/helpers/<id>.log`.

   Plan: `~/code/meum/docs/design/widget-library.md`, sections 2 to 4.

   Tamago's side, to design:
   - **A helper that runs without Homebrew or nvm.** Options: a bundled Node runtime, a single-file executable
     (Node SEA / `bun build --compile`), or a Swift port. The daemon calls `claude -p`, so the helper must still
     find a `claude` binary.
   - **State in `MEUM_WIDGET_DATA` instead of `~/.local/state/tamago`.** The daemon already honours
     `TAMAGO_STATE_DIR`. Migrating Soup's existing state (mood, memories, diary, liked.jsonl, settings, token)
     is a decision for Max.
   - **The widget reads the token from that directory too.** `DaemonClient` reads
     `~/.local/state/tamago/token` today.
   - **A packaging script** that makes `TamagoMeum.meumwidget.zip` (the manifest, the dylib built against
     `~/code/meum`, the helper and species.json).
   - **Signing**, either with meum's coming `scripts/release-widget.sh` or with "Developer ID Application:
     Max Studanski (XHXWK3RG86)" from the keychain.
   - **Avoiding two daemons.** On Max's Mac the cmux line in `~/.zshrc` still starts the daemon in cmux
     terminals. With a meum helper there'd be two, unless the pidfile and state are shared or the cmux path
     stops. Ask Max.
4. **Still open from earlier:** the "re: <workspace>" line under the bubble could jump to the workspace through
   `host.selectWorkspace`. That needs the daemon to put the workspace id in the bubble (an `aboutId` next to
   `about`).

These requests came in through AXOS from the sessions mux-d0 and meum-3f. Answer the meum project through Max
or a note in `~/code/meum/docs/research/`: the projects aren't linked in AXOS.

## Testing rules that held

- **Never test against Max's running meum.** Use an isolated one: `MEUMT=<dir> ~/code/meum/scripts/run-test-app.sh`,
  with the widget in `$MEUMT/widgets`, driven with `scripts/meumt` and stopped with `scripts/meumt quit`.
  - The socket path must be under 104 bytes, and the Claude scratchpad is too long. A short symlink such as
    `~/.cache/tmt -> <scratch dir>` works; remove it afterwards.
  - Clicks in a test meum still reach the live daemon through the widget (feed, +1 and so on), so don't click
    Tama there.
- **Test daemons:**
  - Use a scratch `TAMAGO_STATE_DIR`, `TAMAGO_PORT=47391`, `CMUX_SOCKET_PATH=/nonexistent/sock` and
    `TAMAGO_TEST=1`.
  - Use a fake `TAMAGO_CLAUDE` script that prints the JSON reply.
  - Use `TAMAGO_CHANCE=1 TAMAGO_DELAY_S=1-2 TAMAGO_COOLDOWN_S=0`, and `TAMAGO_IDLE_FILE` holding 0 so it doesn't
    think Max is away.
  - Point `MEUM_SOCKET` at the test meum.
  - Stop it by its captured pid.
- **Standing rules:**
  - Restart Soup's own daemon only through its pidfile, then `scripts/ensure-running.sh`.
  - Never kill processes not identified that way.
  - Never print the token.
  - Don't edit `~/.zshrc` or write cmux's defaults.
  - Use small commits ending with the Co-Authored-By line.
  - No `git stash`, no `git reset --hard`, no force-push.

## Later on 2026-11-02 (session tamago-f9)

Max ruled on request 3's two questions: Tama's state moves into meum's data folder, and the cmux
path stops. Requests 1 and 4 are done too.

- **Rename done:** the widget builds against `~/code/meum` (package "meum").
- **State moved:** mood, memories, diary, likes, settings, token, pet, bubble and log now live in
  `~/.local/state/meum/widgets/io.github.mcurses.tamago/`. Only cmux's old `daemon.out` and launchd
  logs remain in `~/.local/state/tamago/`. `daemon/paths.mjs` picks the folder.
- **cmux path stopped:** `scripts/ensure-running.sh` does nothing once that folder holds a token. The
  line in `~/.zshrc` is still there (not edited) but no longer starts anything.
- **Helper:** the widget manifest names `bin/tamago-daemon` → `scripts/meum-helper.sh`. It waits for
  a daemon already running on the same state. It is verified in an isolated meum built from
  `~/code/meum`: it starts at launch, restarts after a kill, stops on quit.
- **The installed meum (`/Applications/meum.app`, built at 9b01f2f) predates helpers.** Until it is
  updated, the daemon was started by hand (clean env, `MEUM_WIDGET_DATA` set; output in
  `~/.local/state/meum/tamago-manual.log`). After a reboot nothing starts it until meum has helpers.
  Once it does, its helper waits for a hand-started daemon and then takes over.
- **"re: <workspace>" jumps** to the workspace in meum (bubble `aboutId`; verified by clicks in an
  isolated meum, both the current build and the installed 9b01f2f app).
- The widget finds the data folder next to meum's socket, not via `host.dataDirectory`, so it also
  loads in meum builds without that API.
- The daemon logs which clients read the state and which are refused (wrong token). The cmux
  sidebar, still running, is refused now; that's expected.
- Still open: the collapsed sidebar look (request 2), and the rest of one-click install (a bundled
  runtime or a single executable, a zip, signing).
