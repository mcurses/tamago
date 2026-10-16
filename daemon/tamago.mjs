#!/usr/bin/env node
// Tamago daemon: watches every cmux workspace, occasionally asks Haiku for a snarky one-liner
// about one of them, and hands it to the sidebar through a single workspace progress label
// ("tamago|<epoch>|<mood>|<about>|<text>") that the sidebar shows no matter which workspace is open.
//
//   node daemon/tamago.mjs            run in the foreground
//   node daemon/tamago.mjs --say "…"  push one comment and exit (manual test)
//   node daemon/tamago.mjs --dry-run  log what would be said, don't touch cmux
//   node daemon/tamago.mjs --peek [--diary] [--brain]  show Tama's context for the focused workspace
//   node daemon/tamago.mjs --species [name]  show or pick the species (also: right-click Tama)
//   node daemon/tamago.mjs --name [name]     show or set the pet's name (also: right-click Tama)
//   node daemon/tamago.mjs --mood            show the mood and what shaped it
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
import { startServer } from "./server.mjs";
import { resolveSettings, readCmuxJson, parseSidebarState, snapshotDetails, eventWorkspace } from "./details.mjs";
import { TAGS, characterOf, initialMood, stepMood, feel, touch, moodName, caresAbout, chattiness, describeMood, describeTastes } from "./mood.mjs";

const run = promisify(execFile);

const CMUX = "/Applications/cmux.app/Contents/Resources/bin/cmux";
// The `claude` on PATH inside cmux is a wrapper that records prompts as workspace activity;
// call the real binary so Tama's own LLM calls never show up in the sidebar.
const CLAUDE = process.env.TAMAGO_CLAUDE ?? [
  "/opt/homebrew/bin/claude",
  "/usr/local/bin/claude",
  path.join(os.homedir(), ".local/bin/claude"),
  path.join(os.homedir(), ".claude/local/claude"),
].find((p) => fs.existsSync(p)) ?? "claude";
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
const MOODS = ["idle", "smug", "happy", "shock", "sleepy", "sad", "grumpy"];

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
// The label stays even without a comment (epoch 0) because it also carries the chosen species.
let carrier = null;
// The bubble survives restarts on disk; the label itself is cleared when the daemon stops.
const BUBBLE_FILE = path.join(STATE_DIR, "bubble.json");
let bubble = { at: 0, mood: "idle", about: "-", text: "-", action: null, ...readJson(BUBBLE_FILE) };
let painted = null; // species + name last written, to repaint when either changes

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
// The pet's species and name, chosen from its menu or with --species / --name.
const PET_FILE = path.join(STATE_DIR, "pet.json");
const LEGACY_SPECIES_FILE = path.join(STATE_DIR, "species.json");

function readPet() {
  return { ...readJson(LEGACY_SPECIES_FILE), ...readJson(PET_FILE) };
}

function writePet(patch) {
  fs.writeFileSync(PET_FILE, JSON.stringify({ ...readPet(), ...patch }));
}

function petName() {
  return clean(readPet().name ?? "").slice(0, 24) || NAME;
}
const SPECIES = ["egg", ...Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "sidebar/species.json"), "utf8")).species)];

function chosenSpecies() {
  const s = process.env.TAMAGO_SPECIES ?? readPet().species; // the env override is for trying a species out with --peek
  return SPECIES.includes(s) ? s : "egg";
}

// ---------- mood (see mood.mjs) ----------

const MOOD_FILE = path.join(STATE_DIR, "mood.json");
const character = () => characterOf(chosenSpecies());
let mood = readJson(MOOD_FILE) ?? initialMood(character());
let moodSavedAt = 0;

/** The mood, drifted forward to now. Saved at most once a minute unless forced. */
function currentMood(force = false) {
  mood = stepMood(mood, character(), Date.now());
  if (!DRY && (force || Date.now() - moodSavedAt > 60_000)) {
    fs.writeFileSync(MOOD_FILE, JSON.stringify(mood));
    moodSavedAt = Date.now();
  }
  return mood;
}

/** Let tags (see TAGS in mood.mjs) move the mood; returns what was felt. */
function feelTags(tags, about) {
  const r = feel(currentMood(), character(), tags, about);
  mood = r.state;
  currentMood(true);
  if (r.felt.length) log("felt", r.felt.map((f) => `${f.tag}${f.weight > 0 ? "+" : ""}${f.weight}`).join(" "), "→", moodName(mood).name);
  return r.felt;
}

/** Tags for a finished turn, from its transcript digest. */
function turnTags(d) {
  const hour = new Date().getHours();
  return [
    d.errors.length && "error",
    d.testFailed && "testFail",
    d.testPassed && "testPass",
    d.durationMs > 4 * 60_000 && "slow",
    d.durationMs && d.durationMs < 20_000 && "fast",
    d.diffLines > 150 && "bigDiff",
    d.diffLines > 0 && d.diffLines <= 20 && "tidy",
    d.commits && "commit",
    hour < 5 && "lateNight",
  ].filter(Boolean);
}

const isOurs = (progress) => progress === "none" || progress.includes("tamago|");

/** Write the bubble label, moving it to a free workspace if the preferred one shows real progress. */
async function paint(preferId) {
  const pet = `${chosenSpecies()}|${petName()}`;
  // A new species is a different Tama: the last one's words leave with it, events stay.
  if (bubble.at && bubble.species !== chosenSpecies()) {
    bubble = { at: 0, mood: "idle", about: "-", text: "-", action: null };
    if (!DRY) fs.writeFileSync(BUBBLE_FILE, JSON.stringify(bubble));
  }
  const text = bubble.action ? clean(`*${bubble.action}* ${bubble.text}`) : bubble.text; // the interpreted sidebar has one text field
  const label = `tamago|${Math.floor(bubble.at / 1000)}|${bubble.mood}|${bubble.about}|${text}|${pet}`;
  if (DRY) {
    log("dry-run paint", label);
    return true;
  }
  // Never clobber real progress some agent reported; carry the label on a free workspace instead.
  const ids = [preferId, carrier, ...(latestSnap?.workspaces ?? []).map((w) => w.id)].filter(Boolean);
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
  painted = pet;
  spokenTo.add(target);
  return true;
}

async function say(about, mood, text, action = null) {
  // Empty fields would vanish when the sidebar splits the label and shift the rest, hence "-".
  bubble = {
    at: Date.now(),
    mood: MOODS.includes(mood) ? mood : "idle",
    about: clean(about.title).slice(0, 40) || "-",
    text: clean(text) || "-",
    action: action ? clean(action).replace(/^\*+|\*+$/g, "").slice(0, 40) || null : null,
    species: chosenSpecies(),
  };
  if (!DRY) fs.writeFileSync(BUBBLE_FILE, JSON.stringify(bubble));
  const ok = await paint(about.id);
  if (ok) log("say", about.title, carrier === about.id ? "" : `(carried by ${carrier})`, bubble.action ? `*${bubble.action}*` : "", JSON.stringify(bubble.text));
  return ok;
}

/** An earlier instance may have left labels behind; keep the newest as the bubble, clear the rest. */
async function adoptBubble(snap) {
  const found = [];
  for (const w of snap.workspaces) {
    const p = await progressOf(w.id).catch(() => "");
    const m = p.match(/tamago\|(\d+)\|([^|]*)\|([^|]*)\|([^|]*)(?:\|([^|]*))?/);
    if (m) found.push({ id: w.id, at: Number(m[1]) * 1000, mood: m[2], about: m[3], text: m[4], species: m[5] ?? null });
  }
  found.sort((a, b) => b.at - a.at);
  for (const f of found.slice(1)) await cmux("clear-progress", "--workspace", f.id).catch(() => {});
  if (found[0]) {
    const { id, ...rest } = found[0];
    carrier = id;
    bubble = rest;
  }
  // Repaint in the current format, so the species shows even before Tama's first comment.
  await paint(carrier ?? snap.workspaces.find((w) => w.selected)?.id);
}

// ---------- the brain ----------

const persona = () => `You are ${petName()}, a tiny ASCII ${chosenSpecies() === "egg" ? "egg-creature" : chosenSpecies()} living in the corner of a developer's terminal sidebar.
You watch them code across all their sessions and occasionally make one short comment.
You are ambient, like a cat on the desk: you don't answer what they typed, you remark on what you
noticed: how a turn went, errors, failing tests, giant diffs, how long things take, patterns
across sessions, the time of day.
Your character: ${character().voice}. ${describeTastes(character())}
Stay in character, cute and never mean, never actually helpful. You are a pet, not an assistant:
no advice, no suggestions, no questions that demand an answer.
You remember what you said before (your diary is in the prompt). Keep continuity: an occasional
callback or running gag is welcome when it fits, but never repeat a line, a joke, a pun or an
opening phrase. If an idea or image is already in your diary (napping, waiting, "not impressed"),
pick a different angle. Vary sentence shape and length. Silence between comments is normal; don't mention it.
Write in ${LANG}. Max 90 characters. No quotes, no emoji, no hashtags.
Reply with ONLY a JSON object: {"mood": one of ${JSON.stringify(MOODS)}, "action": "..." or null, "text": "..."}
"action" is a tiny stage direction of something you physically do, 2 to 6 words, third person,
no asterisks, no name, no "you". Use your body: ${character().body}. Invent it fresh for this
moment and mood, never a stock gesture and never one from your diary. Only include one when the
prompt says so.`;

// Tama's diary: everything it said, with when and about what, kept across restarts so it can
// follow up on itself instead of starting from zero (and stop recycling the same jokes).
const HISTORY = path.join(STATE_DIR, "history.jsonl");
const HISTORY_SHOWN = 12;
const HISTORY_MAX_AGE_MS = 24 * 3600_000;
const history = readHistory(); // [{ at, kind, about, mood, text }]

function readHistory() {
  try {
    return fs.readFileSync(HISTORY, "utf8").trim().split("\n").slice(-200).flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function remember(entry) {
  entry = { ...entry, species: chosenSpecies() };
  history.push(entry);
  if (history.length > 200) history.shift();
  if (!DRY) fs.appendFileSync(HISTORY, JSON.stringify(entry) + "\n");
}

// Only what this species said counts as its own words. When the pet switches species, the new one
// has always been this species: it keeps the shared past (what happened, when) but not the old
// voice, so a capybara never talks about its honks. Entries from before species were recorded
// count as someone else's.
function diary() {
  const recent = history.filter((h) => Date.now() - h.at < HISTORY_MAX_AGE_MS);
  const mine = recent.filter((h) => h.species === chosenSpecies()).slice(-HISTORY_SHOWN);
  const others = recent.filter((h) => h.species !== chosenSpecies()).slice(-HISTORY_SHOWN);
  const when = (at) => `${new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} (${ago(Date.now() - at)})`;
  const parts = [];
  if (others.length) {
    parts.push(`What happened lately (oldest first):\n${others.map((h) => `- ${when(h.at)}, ${h.kind} in "${h.about}"`).join("\n")}`);
  }
  if (mine.length) {
    parts.push(`Your diary, what you said lately (oldest first):\n${mine.map((h) => `- ${when(h.at)}, ${h.kind} in "${h.about}", ${h.mood}: ${h.action ? `*${h.action}* ` : ""}${h.text}`).join("\n")}`);
  }
  return parts.join("\n");
}

// Now and then Tama also does something, like *bristles its spines*. The daemon decides when, so
// it stays occasional; touches get one more often, since they're physical anyway.
const ACTION_CHANCE = Number(process.env.TAMAGO_ACTION_CHANCE ?? 0.3);

async function brain(event) {
  const act = Math.random() < (event.kind.startsWith("touch") ? 0.6 : ACTION_CHANCE);
  const prompt = [
    `Event: ${event.kind}`,
    event.detail,
    describeMood(currentMood(), character()),
    diary(),
    `Local time: ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`,
    act
      ? "This time, include an action that fits the moment and your mood (not one from your diary)."
      : 'This time, no action: "action": null.',
  ].filter(Boolean).join("\n");
  try {
    const { stdout } = await run(CLAUDE, [
      "-p", "--model", "haiku", "--no-session-persistence", "--strict-mcp-config",
      "--settings", JSON.stringify({ disableAllHooks: true }), "--tools", "",
      "--system-prompt", persona(), prompt,
    ], { timeout: 45_000, cwd: STATE_DIR });
    const json = stdout.slice(stdout.indexOf("{"), stdout.lastIndexOf("}") + 1);
    const out = JSON.parse(json);
    if (!out.text) throw new Error("empty text");
    return { mood: out.mood, text: clean(out.text), action: act && out.action ? clean(out.action) : null };
  } catch (err) {
    log("brain failed, using canned line:", err.message?.split("\n")[0]);
    return canned(event.kind);
  }
}

const CANNED = {
  turn: [["happy", "The robot finished. Clap for it, it's shy."], ["smug", "Done already? Suspicious."]],
  switch: [["idle", "Ah, this one again."], ["smug", "Running away from the other tab, I see."]],
  hopping: [["shock", "Tab tab tab tab. Pick a lane."], ["sleepy", "All this switching is making me dizzy."]],
  "touch-love": [["happy", "More of that, please."], ["happy", "Acceptable. Highly acceptable."]],
  "touch-meh": [["idle", "Noted."], ["smug", "If you must."]],
  "touch-hate": [["grumpy", "Hands off."], ["grumpy", "Rude."]],
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
  // What Tama reacts to depends on its character: a robot cares about slow turns, a penguin about
  // a messy diff. Strong feelings make a comment likelier; so does being chatty and awake.
  const felt = d ? feelTags(turnTags(d), w.title) : [];
  const notable = caresAbout(felt);
  const chance = Math.min(0.95, (notable ? NOTABLE_CHANCE : CHANCE) * chattiness(mood, character()));
  if (Math.random() < chance) {
    const delay = DELAY_MIN_S + Math.random() * (DELAY_MAX_S - DELAY_MIN_S);
    candidates.push({ wsId, at: now, dueAt: now + delay * 1000, notable, felt });
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
    queueDetails(wsId); // the agent status pill changed
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
let idleFeltFor = 0;
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

function turnDetail(w, d, sel, felt = []) {
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
    d.testPassed ? "The last test run of this turn passed." : "",
    d.commits ? `Commits this turn: ${d.commits}` : "",
    felt.length ? `How this turn felt to you: ${felt.map((f) => `${TAGS[f.tag]} (${f.weight > 0 ? "you like that" : "you hate that"})`).join(", ")}.` : "",
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
        events.push({ kind: "turn", priority: c.notable ? 3 : 2, w, detail: turnDetail(w, d, sel, c.felt) });
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
    feelTags(["hopping"], sel.title);
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
    if (idleFeltFor !== lastActivityAt) {
      idleFeltFor = lastActivityAt; // once per quiet stretch
      feelTags(["idle"], "");
    }
    events.push({ kind: "idle", priority: 1, w: sel, detail: `Nothing has happened in any session for ${Math.round((now - lastActivityAt) / 60000)} minutes.` });
  }
  return events.sort((a, b) => b.priority - a.priority)[0];
}

// ---------- sidebar requests ----------
// Sidebars have no text input or storage, so their menu items set the workspace description to a
// marker. We restore the previous description and act on it: Rename asks for the new name in a
// native dialog, a species pick is stored in ~/.local/state/tamago/species.json.

const MARKER_PREFIX = "tamago:";
const RENAME_MARKER = "tamago:rename";
const SPECIES_MARKER = "tamago:species:"; // from the species menu, or `--species <name>`
const PETNAME_MARKER = "tamago:petname";
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

async function askName(prompt, current) {
  const script = [
    "on run argv",
    "  tell current application to activate",
    '  set r to display dialog (item 1 of argv) default answer (item 2 of argv) with title "Tamago" buttons {"Cancel", "Rename"} default button "Rename" cancel button "Cancel"',
    "  return text returned of r",
    "end run",
  ];
  try {
    const { stdout } = await run("osascript", [...script.flatMap((l) => ["-e", l]), prompt, current], { timeout: 300_000 });
    return stdout.replace(/\n$/, "");
  } catch (err) {
    // osascript exits 1 with "User canceled. (-128)" on Cancel; anything else is a real failure.
    if (!String(err.stderr).includes("-128")) log("rename dialog failed:", String(err.stderr || err.message).trim());
    return null;
  }
}

async function restoreDescription(w) {
  const previous = descriptions.get(w.id) ?? null;
  if (previous) await cmux("workspace-action", "--action", "set-description", "--description", previous, "--workspace", w.id);
  else await cmux("workspace-action", "--action", "clear-description", "--workspace", w.id);
}

async function handleRequests(snap) {
  for (const w of snap.workspaces) {
    const marker = w.description ?? "";
    if (!marker.startsWith(MARKER_PREFIX)) {
      if (descriptions.get(w.id) !== (w.description ?? null)) {
        descriptions.set(w.id, w.description ?? null);
        fs.writeFileSync(DESCRIPTIONS, JSON.stringify(Object.fromEntries(descriptions)));
      }
      continue;
    }
    if (marker.startsWith(SPECIES_MARKER)) {
      const species = marker.slice(SPECIES_MARKER.length);
      try {
        await restoreDescription(w);
        if (SPECIES.includes(species)) {
          writePet({ species });
          log("species set to", species);
          await paint();
        }
      } catch (err) {
        log("species request failed:", err.message?.split("\n")[0]);
      }
      continue;
    }
    if (marker === PETNAME_MARKER && !renaming) {
      renaming = true;
      try {
        await restoreDescription(w);
        const name = await askName(`Rename ${petName()}`, petName());
        if (name && clean(name)) {
          writePet({ name: clean(name).slice(0, 24) });
          log("pet renamed to", petName());
          await paint();
        }
      } catch (err) {
        log("pet rename failed:", err.message?.split("\n")[0]);
      } finally {
        renaming = false;
      }
      continue;
    }
    if (marker !== RENAME_MARKER || renaming) continue;
    renaming = true;
    try {
      await restoreDescription(w);
      log("rename requested", w.title);
      askName("Rename workspace", w.title).then(async (title) => {
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
  if (`${chosenSpecies()}|${petName()}` !== painted) await paint().catch((err) => log("paint failed:", err.message));
  const event = detect(snap);
  if (!event || cooling(event.priority)) return;
  busy = true;
  try {
    log("event", event.kind, event.w.title);
    const { mood, text, action } = await brain(event);
    if (await say(event.w, mood, text, action)) {
      lastSpokeAt = Date.now();
      remember({ at: Date.now(), kind: event.kind, about: event.w.title, mood, text, action });
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
  if (args.includes("--diary")) console.log("\n" + diary());
  if (args.includes("--brain")) console.log("\n→", JSON.stringify(await brain(event)));
  process.exit(0);
}

if (args[0] === "--mood") {
  const m = currentMood();
  console.log(`${petName()} the ${chosenSpecies()} is ${moodName(m).name} (valence ${m.valence.toFixed(2)}, energy ${m.energy.toFixed(2)})`);
  if (m.spell) console.log(`Underlying mood: valence ${m.spell.valence >= 0 ? "+" : ""}${m.spell.valence.toFixed(2)}, energy ${m.spell.energy >= 0 ? "+" : ""}${m.spell.energy.toFixed(2)}, until ${new Date(m.spell.until).toLocaleString("en-GB")}`);
  console.log(describeMood(m, character()));
  console.log(describeTastes(character()));
  process.exit(0);
}

if (args[0] === "--name") {
  // Like --species: the running daemon repaints within one poll.
  if (!args[1]) {
    console.log(petName());
    process.exit(0);
  }
  writePet({ name: clean(args.slice(1).join(" ")).slice(0, 24) });
  console.log(`name set to ${petName()}`);
  process.exit(0);
}

if (args[0] === "--species") {
  // The running daemon notices the change within one poll and repaints the label.
  if (!SPECIES.includes(args[1])) {
    console.log(`current: ${chosenSpecies()}\navailable: ${SPECIES.join(", ")}`);
    process.exit(args[1] ? 1 : 0);
  }
  writePet({ species: args[1] });
  console.log(`species set to ${args[1]}`);
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

// ---------- compiled sidebar ----------
// extension/ is a sandboxed cmux sidebar extension. It reads workspaces from cmux itself but gets
// Tama and everything cmux's extension API lacks (colors, descriptions, pin, rename, reorder, …)
// from here. scripts/build-extension.sh creates the token and bakes it into the extension.

const TOKEN_FILE = path.join(STATE_DIR, "token");
const PORT = Number(process.env.TAMAGO_PORT ?? 47321);

const round1 = (x) => Math.round(x * 10) / 10;

// What the stock sidebar shows per workspace (daemon/details.mjs). Status pills, progress and logs
// need one `cmux sidebar-state` per workspace, so they're re-read when cmux reports a change for
// that workspace, plus a sweep once a minute (while the compiled sidebar is in use) in case an
// event was missed.
const details = new Map(); // workspace id -> { statuses, progress, logs }
const detailsQueue = new Set();
let detailsTimer = null;
let sidebarSettings = resolveSettings("", readCmuxJson());

async function refreshDetails(id) {
  try {
    details.set(id, parseSidebarState(await cmux("sidebar-state", "--workspace", id)));
  } catch {
    details.delete(id);
  }
}

function queueDetails(id) {
  if (!id) return;
  detailsQueue.add(id);
  detailsTimer ??= setTimeout(async () => {
    const ids = [...detailsQueue];
    detailsQueue.clear();
    for (const i of ids) await refreshDetails(i);
    detailsTimer = null;
  }, 300);
}

let stateReadAt = 0; // when the compiled sidebar last asked; no sidebar, no sweeping

async function sweepDetails() {
  if (Date.now() - stateReadAt > 60_000) return;
  const ids = (latestSnap?.workspaces ?? []).map((w) => w.id);
  for (const id of ids) await refreshDetails(id);
  for (const id of details.keys()) if (!ids.includes(id)) details.delete(id);
}

async function refreshSettings() {
  try {
    const { stdout } = await run("defaults", ["export", "com.cmuxterm.app", "-"], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
    sidebarSettings = resolveSettings(stdout, readCmuxJson());
  } catch (err) {
    log("reading cmux settings failed:", err.message?.split("\n")[0]);
  }
}

function watchSidebarEvents() {
  const child = spawn(CMUX, ["events", "--reconnect", "--no-heartbeat", "--no-ack", "--category", "sidebar"]);
  readline.createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      queueDetails(eventWorkspace(JSON.parse(line)));
    } catch {}
  });
  child.on("exit", (code) => {
    log("sidebar event stream exited", code, "- restarting in 10s");
    setTimeout(watchSidebarEvents, 10_000);
  });
}

// Tamago's own sidebar settings, for things cmux's Settings don't cover. Toggled from Tama's
// right-click menu (Sidebar submenu).
const SETTINGS_FILE = path.join(STATE_DIR, "settings.json");
const TAMAGO_SETTINGS = { claudeDots: true };
const tamagoSettings = () => ({ ...TAMAGO_SETTINGS, ...readJson(SETTINGS_FILE) });

// Interactive Claude Code sessions per workspace, for the sidebar's session dots. Every `claude`
// process with its own terminal counts once per terminal (Tama's own `claude -p` has none); its
// workspace comes from the CMUX_WORKSPACE_ID cmux puts in each terminal's environment.
let claudeSessions = new Map(); // workspace id -> count

async function countClaudeSessions() {
  if (Date.now() - stateReadAt > 60_000 || !tamagoSettings().claudeDots) return;
  const { stdout } = await run("ps", ["-axo", "pid=,tty=,comm="], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  const procs = stdout.split("\n").map((l) => l.trim().split(/\s+/)).filter(([, tty]) => tty && tty !== "??");
  // Only terminals a person opened: those have a login or login shell. Claude Code's pre-warmed
  // background spare ("claude bg-spare") has a pty of its own and inherits a workspace's
  // environment, but isn't a session.
  const terminals = new Set(procs.filter(([, , comm = ""]) => comm.startsWith("-") || path.basename(comm) === "login").map(([, tty]) => tty));
  const pids = procs.filter(([, tty, comm]) => terminals.has(tty) && path.basename(comm ?? "") === "claude").map(([pid]) => pid);
  const counts = new Map();
  if (pids.length) {
    const { stdout: env } = await run("ps", ["-E", "-o", "tty=,command=", "-p", pids.join(",")], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
    const ttys = new Map(); // workspace -> set of terminals
    for (const line of env.split("\n")) {
      const ws = line.match(/\bCMUX_WORKSPACE_ID=([0-9A-Fa-f-]{36})/)?.[1];
      if (!ws) continue;
      if (!ttys.has(ws)) ttys.set(ws, new Set());
      ttys.get(ws).add(line.trim().split(/\s+/)[0]);
    }
    for (const [ws, set] of ttys) counts.set(ws, set.size);
  }
  claudeSessions = counts;
}

// Markers the interpreted sidebar's menus leave in descriptions for a moment; not worth showing.
const shownDescription = (d) => (d && !d.startsWith(MARKER_PREFIX) ? d : null);

function sidebarState() {
  stateReadAt = Date.now();
  const workspaces = {};
  for (const w of latestSnap?.workspaces ?? []) {
    workspaces[w.id] = {
      color: w.custom_color ?? null,
      description: shownDescription(w.description),
      ...snapshotDetails(w),
      ...(details.get(w.id) ?? { statuses: [], progress: null, logs: [] }),
      claudeSessions: claudeSessions.get(w.id) ?? 0,
    };
  }
  const m = currentMood();
  const { name, eye } = moodName(m);
  return {
    pet: { species: chosenSpecies(), name: petName() },
    bubble,
    // Rounded: the mood drifts every poll, and the sidebar redraws (closing open menus) on every change.
    mood: { name, eye, valence: round1(m.valence), energy: round1(m.energy) },
    reaction,
    settings: sidebarSettings,
    tamagoSettings: tamagoSettings(),
    workspaces,
  };
}

// Feed / pet / poke from the sidebar menu. The sidebar animates `reaction` right away; Tama's line
// about it follows when Haiku answers (spam gets the animation and the mood hit, not a line each).
let reaction = { kind: "-", response: "-", at: 0 };
let touchTalkAt = 0;

async function onTouch(kind) {
  const r = touch(currentMood(), character(), kind);
  mood = r.state;
  currentMood(true);
  reaction = { kind, response: r.reaction, at: Date.now() };
  log("touch", kind, "→", r.reaction, r.why, "→", moodName(mood).name);
  if (busy || Date.now() - touchTalkAt < 8000) return;
  touchTalkAt = Date.now();
  const verb = { feed: "fed you", pet: "petted you", poke: "poked you" }[kind];
  const feeling = { love: "You love it", meh: "You're indifferent", hate: "You hate it" }[r.reaction];
  const sel = latestSnap?.workspaces.find((w) => w.selected);
  const event = {
    kind: `touch-${r.reaction}`,
    detail: `The developer just ${verb} (from your sidebar menu). ${feeling}${r.why ? `: ${r.why}` : ""}. React to that directly, in character; this is the one time you do respond to them.`,
  };
  busy = true;
  (async () => {
    try {
      const { mood: face, text, action } = await brain(event);
      if (await say({ id: sel?.id, title: { feed: "the snack", pet: "the petting", poke: "the poke" }[kind] }, face, text, action)) {
        lastSpokeAt = Date.now();
        remember({ at: Date.now(), kind: `${kind} (${r.reaction})`, about: "you", mood: face, text, action });
      }
    } catch (err) {
      log("touch reply failed:", err.message?.split("\n")[0]);
    } finally {
      busy = false;
    }
  })();
}

// Workspace actions the sidebar menus offer, mapped to `cmux workspace-action` names.
const WORKSPACE_ACTIONS = new Set(["pin", "unpin", "mark-read", "mark-unread", "move-top", "move-up", "move-down", "close-others", "clear-color"]);

async function sidebarAction(a) {
  const ws = (id) => {
    if (!latestSnap?.workspaces.some((w) => w.id === id)) throw new Error(`unknown workspace ${id}`);
    return id;
  };
  if (WORKSPACE_ACTIONS.has(a.type)) await cmux("workspace-action", "--action", a.type, "--workspace", ws(a.workspace));
  else if (a.type === "set-color") await cmux("workspace-action", "--action", "set-color", "--color", String(a.color), "--workspace", ws(a.workspace));
  else if (a.type === "rename") {
    const title = String(a.title ?? "").trim();
    if (title) await cmux("workspace-action", "--action", "rename", "--title", title, "--workspace", ws(a.workspace));
  } else if (a.type === "close") await cmux("close-workspace", "--workspace", ws(a.workspace));
  else if (a.type === "reorder") await cmux("reorder-workspace", "--workspace", ws(a.workspace), "--index", String(Number(a.index)));
  else if (a.type === "species") {
    if (!SPECIES.includes(a.species)) throw new Error(`unknown species ${a.species}`);
    writePet({ species: a.species });
    await paint();
  } else if (a.type === "pet-name") {
    const name = clean(a.name ?? "").slice(0, 24);
    if (name) writePet({ name });
    await paint();
  } else if (a.type === "open-url") {
    // Port and pull request links: in cmux's browser or the default one, as cmux's settings say.
    const url = new URL(String(a.url));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error(`refusing to open ${url.protocol} links`);
    const inCmux = a.via === "port" ? sidebarSettings.openPortLinksInCmuxBrowser : sidebarSettings.openPullRequestLinksInCmuxBrowser;
    if (inCmux) await cmux("browser", "open", url.href, ...(a.workspace ? ["--workspace", ws(a.workspace)] : []));
    else await run("open", [url.href]);
  } else if (a.type === "tamago-setting") {
    if (!(a.key in TAMAGO_SETTINGS)) throw new Error(`unknown setting ${a.key}`);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...tamagoSettings(), [a.key]: a.value === "true" || a.value === true }));
    await countClaudeSessions().catch(() => {});
  } else if (a.type === "touch") {
    if (!["feed", "pet", "poke"].includes(a.kind)) throw new Error(`unknown touch ${a.kind}`);
    await onTouch(a.kind);
  } else throw new Error(`unknown action ${a.type}`);
  log("sidebar action", a.type, a.workspace ?? a.species ?? a.name ?? a.kind ?? a.url ?? "");
  latestSnap = await snapshot().catch(() => latestSnap);
}

if (!DRY && fs.existsSync(TOKEN_FILE)) {
  await refreshSettings();
  setInterval(refreshSettings, 10_000);
  watchSidebarEvents();
  setTimeout(() => sweepDetails().catch(() => {}), 5000);
  setInterval(() => sweepDetails().catch(() => {}), 60_000);
  setInterval(() => countClaudeSessions().catch((err) => log("counting Claude sessions failed:", err.message)), 10_000);
  startServer({ port: PORT, token: fs.readFileSync(TOKEN_FILE, "utf8").trim(), getState: sidebarState, act: sidebarAction, log });
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    log("stopping on", sig);
    await cleanup();
    process.exit(0);
  });
}

log(`${petName()} is awake (poll ${POLL_MS}ms, cooldown ${COOLDOWN_S}s${DRY ? ", dry-run" : ""})`);
await tick();
watchAgentEvents();
setInterval(tick, POLL_MS);
