#!/usr/bin/env node
// Tamago daemon: watches cmux, occasionally asks Haiku for a snarky one-liner about the
// focused workspace, and hands it to the sidebar through that workspace's progress label.
//
//   node daemon/tamago.mjs            run in the foreground
//   node daemon/tamago.mjs --say "…"  push one comment and exit (manual test)
//   node daemon/tamago.mjs --dry-run  log what would be said, don't touch cmux
//
// Env overrides: TAMAGO_NAME, TAMAGO_LANG, TAMAGO_COOLDOWN_S, TAMAGO_POLL_MS, TAMAGO_CLAUDE.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);

const CMUX = "/Applications/cmux.app/Contents/Resources/bin/cmux";
// The `claude` on PATH inside cmux is a wrapper that records prompts as workspace activity;
// call the real binary so Tama's own LLM calls never show up in the sidebar.
const CLAUDE = process.env.TAMAGO_CLAUDE ?? "/opt/homebrew/bin/claude";
const NAME = process.env.TAMAGO_NAME ?? "Tama";
const LANG = process.env.TAMAGO_LANG ?? "English";
const POLL_MS = Number(process.env.TAMAGO_POLL_MS ?? 3000);
const COOLDOWN_S = Number(process.env.TAMAGO_COOLDOWN_S ?? 150);
const SWITCH_DWELL_S = 20;
const IDLE_S = 25 * 60;
const MOODS = ["idle", "smug", "happy", "shock", "sleepy", "sad"];

const STATE_DIR = path.join(os.homedir(), ".local/state/tamago");
const LOG = path.join(STATE_DIR, "tamago.log");
const PIDFILE = path.join(STATE_DIR, "tamago.pid");

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");

fs.mkdirSync(STATE_DIR, { recursive: true });

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(" ")}`;
  console.log(line);
  fs.appendFileSync(LOG, line + "\n");
}

async function cmux(...a) {
  const { stdout } = await run(CMUX, a, { timeout: 10_000 });
  return stdout;
}

async function snapshot() {
  return JSON.parse(await cmux("rpc", "extension.sidebar.snapshot", "{}"));
}

async function progressOf(workspaceId) {
  const out = await cmux("sidebar-state", "--workspace", workspaceId);
  const line = out.split("\n").find((l) => l.startsWith("progress="));
  return line ? line.slice("progress=".length) : "none";
}

function clean(text) {
  return String(text).replace(/[|\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}

async function say(workspaceId, mood, text) {
  const label = `tamago|${Math.floor(Date.now() / 1000)}|${MOODS.includes(mood) ? mood : "idle"}|${clean(text)}`;
  if (DRY) return log("dry-run say", workspaceId, label);
  // Never clobber real progress some agent reported; only overwrite our own label or nothing.
  const current = await progressOf(workspaceId);
  if (current !== "none" && !current.includes("tamago|")) {
    log("skip: workspace has real progress", workspaceId, current);
    return false;
  }
  await cmux("set-progress", "0", "--label", label, "--workspace", workspaceId);
  spokenTo.add(workspaceId);
  log("say", workspaceId, label);
  return true;
}

// ---------- the brain ----------

const PERSONA = `You are ${NAME}, a tiny ASCII egg-creature living in the corner of a developer's terminal sidebar.
You watch them code across all their sessions and occasionally make one short comment.
Personality: snarky, cute, a little smug, never mean, never actually helpful. You are a pet, not an assistant:
no advice, no suggestions, no questions that demand an answer. Tease, observe, gloat, yawn.
Write in ${LANG}. Max 90 characters. No quotes, no emoji, no hashtags.
Reply with ONLY a JSON object: {"mood": one of ${JSON.stringify(MOODS)}, "text": "..."}`;

const recent = []; // last few things Tama said, to avoid repeating itself

async function brain(event) {
  const prompt = [
    `Event: ${event.kind}`,
    event.detail,
    recent.length ? `Things you already said recently (don't repeat): ${recent.join(" / ")}` : "",
    `Local time: ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
  ].filter(Boolean).join("\n");
  try {
    const { stdout } = await run(CLAUDE, [
      "-p", "--model", "haiku", "--no-session-persistence", "--strict-mcp-config",
      "--settings", JSON.stringify({ disableAllHooks: true }), "--tools", "",
      "--system-prompt", PERSONA, prompt,
    ], { timeout: 45_000, cwd: STATE_DIR });
    const json = stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1);
    const out = JSON.parse(json);
    if (!out.text) throw new Error("empty text");
    return { mood: out.mood, text: clean(out.text) };
  } catch (err) {
    log("brain failed, using canned line:", err.message?.split("\n")[0]);
    return canned(event.kind);
  }
}

const CANNED = {
  prompt: [["smug", "Another prompt. Bold of you to assume it'll work this time."], ["idle", "I'd type that too. Probably."]],
  reply: [["happy", "The robot finished. Clap for it, it's shy."], ["smug", "Done already? Suspicious."]],
  switch: [["idle", "Ah, this one again."], ["smug", "Running away from the other tab, I see."]],
  hopping: [["shock", "Tab tab tab tab. Pick a lane."], ["sleepy", "All this switching is making me dizzy."]],
  idle: [["sleepy", "Still here. Still judging. Quietly."], ["sleepy", "Is it nap time? It feels like nap time."]],
};

function canned(kind) {
  const pool = CANNED[kind] ?? CANNED.idle;
  const [mood, text] = pool[Math.floor(Math.random() * pool.length)];
  return { mood, text };
}

// ---------- event detection ----------

const seen = new Map(); // workspace id -> { submittedAt, notification }
const spokenTo = new Set();
let selectedId = null;
let selectedSince = Date.now();
let switchAnnounced = true;
let switches = [];
let lastSpokeAt = 0;
let lastActivityAt = Date.now();
let busy = false;
let failures = 0;

function short(s, n = 300) {
  return s ? clean(s).slice(0, n) : "";
}

function describe(w) {
  return [
    `Workspace: "${w.title}" in ${path.basename(w.current_directory ?? "") || "?"}`,
    w.git_branches?.length ? `Branch: ${w.git_branches.map((b) => b.branch ?? b).join(", ")}` : "",
    w.listening_ports?.length ? `Ports listening: ${w.listening_ports.join(", ")}` : "",
    w.unread_count ? `Unread notifications: ${w.unread_count}` : "",
  ].filter(Boolean).join("\n");
}

function detect(snap) {
  const now = Date.now();
  const sel = snap.workspaces.find((w) => w.selected);
  const events = [];

  for (const w of snap.workspaces) {
    const prev = seen.get(w.id);
    const cur = { submittedAt: w.latest_submitted_at, notification: w.latest_notification_text };
    seen.set(w.id, cur);
    if (!prev) continue; // first sight: baseline only
    if (cur.submittedAt !== prev.submittedAt || cur.notification !== prev.notification) lastActivityAt = now;
    if (!sel || w.id !== sel.id) continue; // Tama only comments on the focused session
    if (cur.submittedAt && cur.submittedAt !== prev.submittedAt) {
      events.push({ kind: "prompt", priority: 3, w, detail: `${describe(w)}\nThe developer just sent their coding agent this prompt: "${short(w.latest_submitted_message)}"` });
    } else if (cur.notification && cur.notification !== prev.notification) {
      events.push({ kind: "reply", priority: 2, w, detail: `${describe(w)}\nTheir coding agent just finished and said: "${short(w.latest_notification_text)}"\nThe developer's prompt had been: "${short(w.latest_submitted_message, 150)}"` });
    }
  }

  if (sel && sel.id !== selectedId) {
    if (selectedId !== null) switches.push(now);
    selectedId = sel.id;
    selectedSince = now;
    switchAnnounced = false;
  }
  switches = switches.filter((t) => now - t < 120_000);
  if (switches.length >= 6) {
    events.push({ kind: "hopping", priority: 2, w: sel, detail: `The developer switched workspaces ${switches.length} times in two minutes. Now on "${sel.title}".` });
    switches = [];
  }
  if (sel && !switchAnnounced && now - selectedSince > SWITCH_DWELL_S * 1000) {
    switchAnnounced = true;
    if (Math.random() < 0.35) {
      events.push({ kind: "switch", priority: 1, w: sel, detail: `${describe(sel)}\nThe developer just switched to this workspace and stayed.` + (sel.latest_submitted_message ? `\nLast prompt there: "${short(sel.latest_submitted_message, 150)}"` : "") });
    }
  }
  if (sel && now - lastActivityAt > IDLE_S * 1000 && now - lastSpokeAt > IDLE_S * 1000) {
    events.push({ kind: "idle", priority: 1, w: sel, detail: `Nothing has happened in any session for ${Math.round((now - lastActivityAt) / 60000)} minutes.` });
  }
  return events.sort((a, b) => b.priority - a.priority)[0];
}

// ---------- sidebar requests ----------
// Sidebars have no text input, so the sidebar's "Rename…" menu item sets the workspace description
// to this marker. We restore the previous description and ask for the new name in a native dialog.

const RENAME_MARKER = "tamago:rename";
const descriptions = new Map(); // workspace id -> last description that wasn't the marker
let renaming = false;

async function askName(current) {
  const script = [
    "on run argv",
    "  tell current application to activate",
    '  set r to display dialog "Rename workspace" default answer (item 1 of argv) with title "Tamago" buttons {"Cancel", "Rename"} default button "Rename" cancel button "Cancel"',
    "  return text returned of r",
    "end run",
  ];
  try {
    const { stdout } = await run("osascript", [...script.flatMap((l) => ["-e", l]), current], { timeout: 300_000 });
    return stdout.replace(/\n$/, "");
  } catch (err) {
    // osascript exits 1 with "User canceled. (-128)" on Cancel; anything else is a real failure.
    if (!String(err.stderr).includes("-128")) log("rename dialog failed:", String(err.stderr || err.message).trim());
    return null;
  }
}

async function handleRequests(snap) {
  for (const w of snap.workspaces) {
    if (w.description !== RENAME_MARKER) {
      descriptions.set(w.id, w.description ?? null);
      continue;
    }
    if (renaming) continue;
    renaming = true;
    const previous = descriptions.get(w.id) ?? null;
    try {
      if (previous) await cmux("workspace-action", "--action", "set-description", "--description", previous, "--workspace", w.id);
      else await cmux("workspace-action", "--action", "clear-description", "--workspace", w.id);
      log("rename requested", w.title);
      askName(w.title).then(async (title) => {
        log("rename dialog returned", JSON.stringify(title));
        if (title && title.trim() && title !== w.title) {
          await cmux("workspace-action", "--action", "rename", "--title", title.trim(), "--workspace", w.id);
          log("renamed", w.title, "->", title.trim());
        }
      }).catch((err) => log("rename failed:", err.message)).finally(() => { renaming = false; });
    } catch (err) {
      renaming = false;
      log("rename request failed:", err.message?.split("\n")[0]);
    }
  }
}

async function tick() {
  if (busy) return;
  let snap;
  try {
    snap = await snapshot();
  } catch (err) {
    log("snapshot failed:", (err.stderr || err.message || "").trim().split("\n").slice(0, 2).join(" | "));
    // cmux quit or refuses us; exit so scripts/ensure-running.sh can start a fresh one later.
    if (++failures >= 20) {
      log("giving up after", failures, "failed snapshots");
      await cleanup().catch(() => {});
      process.exit(1);
    }
    return;
  }
  failures = 0;
  await handleRequests(snap).catch((err) => log("requests failed:", err.message));
  const event = detect(snap);
  if (!event) return;
  const cooldown = event.priority >= 3 ? COOLDOWN_S / 2 : COOLDOWN_S;
  if (Date.now() - lastSpokeAt < cooldown * 1000) return;
  busy = true;
  try {
    log("event", event.kind, event.w.title);
    const { mood, text } = await brain(event);
    // The user may have moved on while the LLM thought; a stale comment is worse than none.
    const now = await snapshot().catch(() => snap);
    const target = now.workspaces.find((w) => w.selected)?.id === event.w.id ? event.w.id : null;
    if (!target) return log("dropped (focus moved):", text);
    if (await say(target, mood, text)) {
      lastSpokeAt = Date.now();
      recent.push(text);
      if (recent.length > 6) recent.shift();
    }
  } catch (err) {
    log("tick failed:", err.message?.split("\n")[0]);
  } finally {
    busy = false;
  }
}

async function cleanup() {
  for (const id of spokenTo) {
    try {
      if ((await progressOf(id)).includes("tamago|")) await cmux("clear-progress", "--workspace", id);
    } catch {}
  }
  try { fs.unlinkSync(PIDFILE); } catch {}
}

// ---------- main ----------

if (args[0] === "--say") {
  const snap = await snapshot();
  const sel = snap.workspaces.find((w) => w.selected);
  await say(sel.id, args[2] ?? "smug", args[1] ?? "Testing, testing. Is this thing on?");
  process.exit(0);
}

try {
  const other = Number(fs.readFileSync(PIDFILE, "utf8"));
  if (other && other !== process.pid) {
    process.kill(other, 0);
    console.error(`tamago already running (pid ${other})`);
    process.exit(1);
  }
} catch {}
fs.writeFileSync(PIDFILE, String(process.pid));

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    log("stopping on", sig);
    await cleanup();
    process.exit(0);
  });
}

log(`${NAME} is awake (poll ${POLL_MS}ms, cooldown ${COOLDOWN_S}s${DRY ? ", dry-run" : ""})`);
await tick();
setInterval(tick, POLL_MS);
