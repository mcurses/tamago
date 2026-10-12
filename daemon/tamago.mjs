#!/usr/bin/env node
// Tamago daemon: watches every cmux workspace, occasionally asks Haiku for a snarky one-liner
// about one of them, and hands it to the sidebar through a single workspace progress label
// ("tamago|<epoch>|<mood>|<about>|<text>") that the sidebar shows no matter which workspace is open.
//
//   node daemon/tamago.mjs            run in the foreground
//   node daemon/tamago.mjs --say "…"  push one comment and exit (manual test)
//   node daemon/tamago.mjs --dry-run  log what would be said, don't touch cmux
//   node daemon/tamago.mjs --peek [--brain]  show Tama's context for the focused workspace
//
// Env overrides: TAMAGO_NAME, TAMAGO_LANG, TAMAGO_COOLDOWN_S, TAMAGO_POLL_MS, TAMAGO_CLAUDE,
// TAMAGO_DELAY_S ("min-max" seconds between a turn ending and Tama reacting), TAMAGO_CHANCE.

import { execFile, spawn } from "node:child_process";
import readline from "node:readline";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transcriptFor, transcriptForSession, digest } from "./transcript.mjs";

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
// Tama is an observer, not a reply bot: it reacts after an agent turn ends, late and only sometimes.
const [DELAY_MIN_S, DELAY_MAX_S] = (process.env.TAMAGO_DELAY_S ?? "20-90").split("-").map(Number);
const CHANCE = Number(process.env.TAMAGO_CHANCE ?? 0.35);
const NOTABLE_CHANCE = Math.max(CHANCE, 0.7); // errors, failing tests, big diffs
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

// Tama has one global speech bubble. Its label lives on one "carrier" workspace (preferably the one
// the comment is about) and the sidebar finds it wherever it is, so switching never hides it.
let carrier = null;

const isOurs = (progress) => progress === "none" || progress.includes("tamago|");

async function say(about, mood, text) {
  const label = `tamago|${Math.floor(Date.now() / 1000)}|${MOODS.includes(mood) ? mood : "idle"}|${clean(about.title).slice(0, 40)}|${clean(text)}`;
  if (DRY) {
    log("dry-run say", about.title, label);
    return true;
  }
  // Never clobber real progress some agent reported; carry the label on a free workspace instead.
  const ids = [about.id, carrier, ...(latestSnap?.workspaces ?? []).map((w) => w.id)].filter(Boolean);
  let target = null;
  for (const id of new Set(ids)) {
    if (isOurs(await progressOf(id))) {
      target = id;
      break;
    }
  }
  if (!target) {
    log("skip: every workspace shows real progress");
    return false;
  }
  if (carrier && carrier !== target && (await progressOf(carrier).catch(() => "")).includes("tamago|")) {
    await cmux("clear-progress", "--workspace", carrier).catch(() => {});
  }
  await cmux("set-progress", "0", "--label", label, "--workspace", target);
  carrier = target;
  spokenTo.add(target);
  log("say", about.title, target === about.id ? "" : `(carried by ${target})`, label);
  return true;
}

/** An earlier instance may have left labels behind; keep the newest as the bubble, clear the rest. */
async function adoptBubble(snap) {
  const found = [];
  for (const w of snap.workspaces) {
    const p = await progressOf(w.id).catch(() => "");
    const at = Number(p.match(/tamago\|(\d+)/)?.[1]);
    if (at) found.push({ id: w.id, at });
  }
  found.sort((a, b) => b.at - a.at);
  carrier = found[0]?.id ?? null;
  for (const f of found.slice(1)) await cmux("clear-progress", "--workspace", f.id).catch(() => {});
  if (carrier) spokenTo.add(carrier);
}

// ---------- the brain ----------

const PERSONA = `You are ${NAME}, a tiny ASCII egg-creature living in the corner of a developer's terminal sidebar.
You watch them code across all their sessions and occasionally make one short comment.
You are ambient, like a cat on the desk: you don't answer what they typed, you remark on what you
noticed: how a turn went, errors, failing tests, giant diffs, how long things take, patterns
across sessions, the time of day.
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
  turn: [["happy", "The robot finished. Clap for it, it's shy."], ["smug", "Done already? Suspicious."]],
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
const sessions = new Map(); // workspace id -> transcript path, learned from cmux agent hook events
const timeline = []; // recent turn ends across all workspaces: { at, wsId, title, prompt }
const transcripts = new Map(); // workspace id -> { path, mtime, digest }
const candidates = []; // finished turns Tama may still comment on: { wsId, at, dueAt, notable }
const CANDIDATE_TTL_S = 5 * 60; // a turn older than this is old news
let latestSnap = null;

/** True while Tama is still quiet after the last comment. Notable turns may cut in sooner. */
function cooling(priority) {
  const cooldown = priority >= 3 ? COOLDOWN_S / 2 : COOLDOWN_S;
  return Date.now() - lastSpokeAt < cooldown * 1000;
}

/** An agent turn ended in any workspace (cmux agent.hook.Stop). Log it, and maybe plan a late comment. */
async function onTurnEnd(wsId) {
  const now = Date.now();
  lastActivityAt = now;
  // Fresh snapshot: the cached one can be seconds old and miss a just-made workspace switch.
  latestSnap = await snapshot().catch(() => latestSnap);
  const w = latestSnap?.workspaces.find((x) => x.id === wsId);
  if (!w) return log("turn ended in unknown workspace", wsId);
  // A wrapped `claude` can report one turn end twice in quick succession.
  if (timeline.some((t) => t.wsId === wsId && now - t.at < 5000)) return;
  const d = transcriptOf(w);
  timeline.push({ at: now, wsId, title: w.title, prompt: d?.prompt ? `"${short(d.prompt, 100)}"` : "(no prompt)" });
  if (timeline.length > 30) timeline.shift();
  const where = w.selected ? "" : " (background)";
  const notable = !!d && (d.errors.length > 0 || d.testFailed || d.diffLines > 150);
  if (Math.random() < (notable ? NOTABLE_CHANCE : CHANCE)) {
    const delay = DELAY_MIN_S + Math.random() * (DELAY_MAX_S - DELAY_MIN_S);
    candidates.push({ wsId, at: now, dueAt: now + delay * 1000, notable });
    log("turn ended in", w.title + where, `→ may comment in ${Math.round(delay)}s${notable ? " (notable)" : ""}`);
  } else {
    log("turn ended in", w.title + where, "→ staying quiet this time");
  }
}

function watchAgentEvents() {
  const names = ["agent.hook.Stop", "agent.hook.SessionStart", "agent.hook.UserPromptSubmit"];
  const child = spawn(CMUX, ["events", "--reconnect", "--no-heartbeat", "--no-ack", ...names.flatMap((n) => ["--name", n])]);
  const handled = new Set(); // each hook arrives once per phase (received, completed, ...)
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    const p = ev.payload ?? {};
    const wsId = ev.workspace_id ?? p.workspace_id;
    if (!wsId) return;
    const key = p._opencode_request_id ?? `${ev.name}|${p.session_id}|${ev.occurred_at}`;
    if (handled.has(key)) return;
    handled.add(key);
    if (handled.size > 500) handled.clear();
    if (p._source === "claude" || ev.source === "claude") {
      const t = transcriptForSession(p.session_id, p.cwd);
      if (t) sessions.set(wsId, t);
    }
    lastActivityAt = Date.now();
    if (ev.name === "agent.hook.Stop") onTurnEnd(wsId).catch((err) => log("turn handling failed:", err.message));
  });
  child.on("exit", (code) => {
    log("event stream exited", code, "- restarting in 10s");
    setTimeout(watchAgentEvents, 10_000);
  });
}
const spokenTo = new Set();
let selectedId = null;
let selectedSince = Date.now();
let switchAnnounced = true;
let switches = [];
let lastSpokeAt = 0;
let lastActivityAt = Date.now();
let busy = false;
let failures = 0;
let adopted = false; // whether we've taken over a bubble left by an earlier instance

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

/** Cached transcript digest for a workspace; re-parsed only when the transcript file changes. */
function transcriptOf(w) {
  const known = sessions.get(w.id);
  const t = known
    ? { path: known, mtime: fs.statSync(known).mtimeMs }
    : transcriptFor([w.current_directory, w.root_path, ...(w.panel_directories ?? [])]);
  if (!t) return null;
  const cached = transcripts.get(w.id);
  if (cached && cached.path === t.path && cached.mtime === t.mtime) return cached.digest;
  try {
    const d = digest(t.path);
    transcripts.set(w.id, { ...t, digest: d });
    return d;
  } catch (err) {
    log("transcript read failed:", t.path, err.message);
    return null;
  }
}

function ago(ms) {
  const m = Math.round(ms / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

function turnDetail(w, d, sel) {
  const tools = Object.entries(d.tools).map(([k, v]) => `${k}×${v}`).join(", ");
  const looking = sel && sel.id !== w.id
    ? `The developer is looking at another workspace ("${sel.title}") right now; this turn finished in the background.`
    : "";
  const elsewhere = timeline
    .filter((t) => t.wsId !== w.id && Date.now() - t.at < 2 * 3600_000)
    .slice(-5)
    .map((t) => `- "${t.title}" (${ago(Date.now() - t.at)}): ${t.prompt}`);
  return [
    describe(w),
    `A coding-agent turn in this workspace just ended${d.durationMs ? ` after ${Math.round(d.durationMs / 1000)}s` : ""}.`,
    looking,
    d.prompt ? `The developer had asked: "${short(d.prompt, 300)}"` : "",
    d.earlierPrompts.length ? `Earlier prompts here: ${d.earlierPrompts.map((p) => `"${short(p, 80)}"`).join(" / ")}` : "",
    d.said ? `The agent's last words: "${short(d.said, 400)}"` : "",
    tools ? `Tools used this turn: ${tools}` : "",
    d.diffLines ? `Lines edited this turn: ~${d.diffLines}` : "",
    d.errors.length ? `Tool errors: ${d.errors.map((e) => `"${short(e, 160)}"`).join(" / ")}` : "",
    d.testFailed ? "Some tests failed during this turn." : "",
    `Turns in this session's recent history: ${d.turnsToday}`,
    elsewhere.length ? `Meanwhile in other workspaces:\n${elsewhere.join("\n")}` : "",
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
    if (prev && (cur.submittedAt !== prev.submittedAt || cur.notification !== prev.notification)) lastActivityAt = now;
  }
  latestSnap = snap;

  // Turn comments don't care which workspace is open. When several sessions finished close together,
  // Tama talks about the most interesting one (notable first, then newest) and lets the rest go.
  const fresh = candidates.filter((c) => now - c.at < CANDIDATE_TTL_S * 1000);
  candidates.splice(0, candidates.length, ...fresh);
  const due = candidates.filter((c) => now >= c.dueAt);
  if (due.length && !cooling(due.some((c) => c.notable) ? 3 : 2)) {
    const picks = [...candidates].sort((a, b) => b.notable - a.notable || b.at - a.at);
    candidates.length = 0;
    for (const c of picks) {
      const w = snap.workspaces.find((x) => x.id === c.wsId);
      const d = w && transcriptOf(w);
      if (d) {
        events.push({ kind: "turn", priority: c.notable ? 3 : 2, w, detail: turnDetail(w, d, sel) });
        break;
      }
    }
  }

  if (sel && sel.id !== selectedId) {
    if (selectedId !== null) switches.push({ at: now, title: sel.title });
    selectedId = sel.id;
    selectedSince = now;
    switchAnnounced = false;
  }
  switches = switches.filter((s) => now - s.at < 120_000);
  if (switches.length >= 6) {
    const route = switches.map((s) => `"${s.title}"`).join(" → ");
    events.push({ kind: "hopping", priority: 2, w: sel, detail: `The developer is hopping between sessions: ${switches.length} switches in two minutes (${route}).` });
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
// Remembered on disk too, so a Rename clicked while the daemon was down doesn't lose the description.
const DESCRIPTIONS = path.join(STATE_DIR, "descriptions.json");
const descriptions = new Map(Object.entries(readJson(DESCRIPTIONS) ?? {})); // workspace id -> description

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
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
      if (descriptions.get(w.id) !== (w.description ?? null)) {
        descriptions.set(w.id, w.description ?? null);
        fs.writeFileSync(DESCRIPTIONS, JSON.stringify(Object.fromEntries(descriptions)));
      }
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
    failures++;
    const why = [err.stderr, err.stdout, err.code && `exit ${err.code}`, err.signal, err.message]
      .filter(Boolean).join(" | ").replace(/\s+/g, " ").slice(0, 300);
    if (failures <= 3 || failures % 100 === 0) log(`snapshot failed (#${failures}):`, why);
    // Refused by the socket: this process can never get back in (only processes started inside a
    // cmux terminal may connect), so make room for a fresh one. Anything else, such as cmux being
    // busy or restarting, is waited out instead of giving up.
    if (/Access denied/.test(why) && failures >= 20) {
      log("socket refuses this process; exiting");
      await cleanup().catch(() => {});
      process.exit(1);
    }
    return;
  }
  if (failures) log("snapshot works again after", failures, "failures");
  failures = 0;
  if (!adopted) {
    adopted = true;
    await adoptBubble(snap).catch((err) => log("adopting bubble failed:", err.message));
  }
  await handleRequests(snap).catch((err) => log("requests failed:", err.message));
  const event = detect(snap);
  if (!event || cooling(event.priority)) return;
  busy = true;
  try {
    log("event", event.kind, event.w.title);
    const { mood, text } = await brain(event);
    if (await say(event.w, mood, text)) {
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

if (args[0] === "--peek") {
  // Print what Tama would see for the focused workspace (and, with --brain, what it would say).
  const snap = await snapshot();
  const sel = snap.workspaces.find((w) => w.selected);
  const d = transcriptOf(sel);
  const event = { kind: "turn", w: sel, detail: d ? turnDetail(sel, d) : describe(sel) };
  console.log(event.detail);
  if (args.includes("--brain")) console.log("\n→", JSON.stringify(await brain(event)));
  process.exit(0);
}

if (args[0] === "--say") {
  const snap = await snapshot();
  latestSnap = snap;
  await adoptBubble(snap);
  const sel = snap.workspaces.find((w) => w.selected);
  await say(sel, args[2] ?? "smug", args[1] ?? "Testing, testing. Is this thing on?");
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
watchAgentEvents();
setInterval(tick, POLL_MS);
