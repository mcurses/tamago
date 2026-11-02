#!/usr/bin/env node
// Tamago daemon: watches every cmux workspace, now and then asks Claude for a one-liner about one
// of them, and serves it to the compiled sidebar (extension/) on 127.0.0.1, so the bubble shows no
// matter which workspace is open.
//
//   node daemon/tamago.mjs            run in the foreground
//   node daemon/tamago.mjs --say "…"  have the running daemon say something (manual test)
//   node daemon/tamago.mjs --listen   ask Tama what's on its mind (also: right-click Tama)
//   node daemon/tamago.mjs --dry-run  log what would be said, don't touch cmux
//   node daemon/tamago.mjs --peek [--diary] [--brain]  show Tama's context for the focused workspace
//   node daemon/tamago.mjs --species [name]  show or pick the species (also: right-click Tama)
//   node daemon/tamago.mjs --name [name]     show or set the pet's name (also: right-click Tama)
//   node daemon/tamago.mjs --mood            show the mood and what shaped it
//   node daemon/tamago.mjs --memories        what Tama remembers, strongest first
//   TAMAGO_STATE_DIR=<copy> node daemon/tamago.mjs --sleep   consolidate the day's memories now (development)
//   node daemon/tamago.mjs --compare [n]     replay the last n turn comments on Haiku and Sonnet
//
//   node daemon/tamago.mjs --set [key=value] show or change a setting (also: right-click Tama)
//   node daemon/tamago.mjs --version         this version, and a newer release if there is one
//   node daemon/tamago.mjs --update          install the newest release (release installs only)
//
// Env overrides: TAMAGO_NAME, TAMAGO_COOLDOWN_S, TAMAGO_POLL_MS, TAMAGO_CLAUDE,
// TAMAGO_DELAY_S ("min-max" seconds between a turn ending and Tama reacting), TAMAGO_CHANCE.

import { execFile, execFileSync, spawn } from "node:child_process";
import readline from "node:readline";
import { promisify } from "node:util";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transcriptFor, transcriptForSession, transcriptsIn, turnEndsSince, digest } from "./transcript.mjs";
import { startServer } from "./server.mjs";
import { repeats } from "./repeats.mjs";
import { firstJson } from "./json.mjs";
import { meumCli, snapshotFromTree, tabOwners, hookEvent } from "./meum.mjs";
import { stateDir } from "./paths.mjs";
import { defaults as settingDefaults, parseSetting, talkProfile } from "./settings.mjs";
import { latestRelease, installRelease, newer } from "./update.mjs";
import { resolveSettings, readCmuxJson, parseSidebarState, snapshotDetails, eventWorkspace, parseListening } from "./details.mjs";
import speciesFile from "../sidebar/species.json" with { type: "json" }; // built into the meum helper
import { cuesOf, encode, cherish, recall, strongest, describeMemories, toReplay, consolidated, strengthNow } from "./memory.mjs";
import { TAGS, characterOf, initialMood, stepMood, feel, touch, savor, turnTags, moodName, caresAbout, chattiness, describeMood, describeTastes } from "./mood.mjs";

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
const POLL_MS = Number(process.env.TAMAGO_POLL_MS ?? 3000);
const COOLDOWN_S = Number(process.env.TAMAGO_COOLDOWN_S ?? 150);
const SWITCH_DWELL_S = 20;
// Tama is an observer, not a reply bot: it reacts after an agent turn ends, late and only sometimes.
const [DELAY_MIN_S, DELAY_MAX_S] = (process.env.TAMAGO_DELAY_S ?? "20-90").split("-").map(Number);
const CHANCE = Number(process.env.TAMAGO_CHANCE ?? 0.35);
const NOTABLE_CHANCE = Math.max(CHANCE, 0.7); // errors, failing tests, big diffs
const IDLE_S = 25 * 60;
const AWAY_S = Number(process.env.TAMAGO_AWAY_S ?? 5 * 60); // no keyboard/mouse input this long: away
// Remarks without new work to look at: rare, so most of what Tama says is about a finished turn.
const IDLE_CHANCE = 0.25;
const SWITCH_CHANCE = 0.1;
const MOODS = ["idle", "smug", "happy", "shock", "sleepy", "sad", "grumpy"];

const STATE_DIR = stateDir(); // daemon/paths.mjs: meum's data folder for Tamago, or ~/.local/state/tamago; TAMAGO_STATE_DIR for test instances
const LOG = path.join(STATE_DIR, "tamago.log");
const PIDFILE = path.join(STATE_DIR, "tamago.pid");
const DENIED_FILE = path.join(STATE_DIR, "denied"); // pid of an instance the cmux socket refuses

// Tamago's own settings (daemon/settings.mjs): how much Tama talks, its model and language, and
// sidebar extras. Picked from Tama's right-click menu; read fresh each time, so changes apply at once.
const SETTINGS_FILE = path.join(STATE_DIR, "settings.json");
const tamagoSettings = () => ({ ...settingDefaults(), ...readJson(SETTINGS_FILE) });
const talk = () => talkProfile(tamagoSettings().talk);

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run") || process.env.TAMAGO_DRY_RUN === "1"; // the env form reaches instances ensure-running.sh starts

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

// The host: cmux, or meum (daemon/meum.mjs), whichever answers. TAMAGO_HOST=cmux|meum pins one;
// by default meum wins while it runs, and the choice is checked again every 30 s.
const MEUM = meumCli();
// meum's helper (MEUM_WIDGET_DATA set) watches meum only.
const HOST_PREF = process.env.TAMAGO_HOST ?? (process.env.MEUM_WIDGET_DATA ? "meum" : "auto");
let host = null; // the host of the latest snapshot
let hostCheckedAt = 0;

async function currentHost() {
  if (HOST_PREF === "cmux" || HOST_PREF === "meum") return (host = HOST_PREF);
  if (host && Date.now() - hostCheckedAt < 30_000) return host;
  hostCheckedAt = Date.now();
  const meumUp = MEUM ? await run(MEUM, ["ping"], { timeout: 3000 }).then(() => true, () => false) : false;
  const next = meumUp ? "meum" : "cmux";
  if (next !== host) log(`watching ${next}${next === "meum" ? " (meum answers)" : ""}`);
  host = next;
  return host;
}
const inMeum = () => host === "meum";

const meumPrompts = new Map(); // workspace id -> { prompt, at }, from meum's agent hook events
let meumOwners = new Map(); // tab id -> workspace id

async function snapshot() {
  if ((await currentHost()) === "meum") {
    const { stdout } = await run(MEUM, ["--json", "tree"], { timeout: 10_000, maxBuffer: 16 * 1024 * 1024 });
    const tree = JSON.parse(stdout);
    meumOwners = tabOwners(tree);
    return snapshotFromTree(tree, meumPrompts);
  }
  return JSON.parse(await cmux("rpc", "extension.sidebar.snapshot", "{}"));
}

async function progressOf(workspaceId) {
  const out = await cmux("sidebar-state", "--workspace", workspaceId);
  const line = out.split("\n").find((l) => l.startsWith("progress="));
  return line ? line.slice("progress=".length) : "none";
}

// What the speech bubble shows in full: 5 lines of about 38 characters at the usual sidebar
// width, minus room for the action line.
const BUBBLE_CHARS = 150;

/** One line of text: no newlines, no "|" and no runs of spaces. */
const flat = (text) => String(text).replace(/[|\n\r]+/g, " ").replace(/\s+/g, " ").trim();

/** Whole sentences that fit the bubble; a single sentence that's too long ends at a word with "…". */
function sentencesThatFit(text, max = BUBBLE_CHARS) {
  const t = flat(text);
  if (t.length <= max) return t;
  let out = "";
  for (const sentence of t.match(/[^.!?…]+[.!?…]+["')\]]*\s*|[^.!?…]+$/g) ?? [t]) {
    if ((out + sentence).trim().length > max) break;
    out += sentence;
  }
  if (out.trim()) return out.trim();
  return t.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[\s,;:.-]+$/, "") + "…";
}

function clean(text) {
  return String(text).replace(/[|\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}

// Tama has one global speech bubble, which the sidebar reads from GET /state. It survives restarts.
const BUBBLE_FILE = path.join(STATE_DIR, "bubble.json");
let bubble = { at: 0, mood: "idle", about: "-", text: "-", action: null, ...readJson(BUBBLE_FILE) };

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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
const SPECIES = ["egg", ...Object.keys(speciesFile.species)];

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

// ---------- long-term memory (see memory.mjs) ----------

const MEMORY_FILE = path.join(STATE_DIR, "memories.json"); // { sleptAt, items: [memory] }
let memory = readJson(MEMORY_FILE) ?? { sleptAt: 0, items: [] };
let keepMemories = false; // only the running daemon changes them; --peek and --compare only look

function saveMemory() {
  if (keepMemories) fs.writeFileSync(MEMORY_FILE, JSON.stringify(memory));
}

/** A moment Tama lived through; see encode() in memory.mjs. */
function memorize(moment) {
  memory.items = encode(memory.items, moment, Date.now());
  saveMemory();
}

const FACE_FEELING = { happy: 0.5, smug: 0.2, idle: 0, sleepy: 0, shock: -0.2, grumpy: -0.5, sad: -0.6 };

/** Before there were memories there was the diary: what Tama said lately becomes its first memories. */
function memoriesFromDiary() {
  let items = [];
  for (const h of history.filter((h) => h.text && h.text !== "-")) {
    items = encode(items, { gist: `${h.kind} in "${h.about}"; I said: "${h.text}"`, about: h.about, cues: cuesOf(h.about, h.kind, h.text), feeling: FACE_FEELING[h.mood] ?? 0, emotion: 0.3, attended: true }, h.at);
  }
  return items;
}

/**
 * What Tama makes of a moment it spoke about. The model judged how special the moment was (0 … 3)
 * and, from 2 on, wrote what to remember; that, rather than the kind of event, decides how strongly
 * it's remembered. A special moment also moves the mood a little, the way Tama's face went.
 */
function takeIn({ special = 0, memory: gist = null, mood: face, text }, { about, cues = null, fallback = null }) {
  const feeling = FACE_FEELING[face] ?? 0;
  if (gist || fallback) {
    memorize({ gist: `${gist ?? fallback}; I said: "${text}"`, about, cues: cues ?? cuesOf(about, gist ?? "", text), feeling, emotion: Math.max(0.15, special / 3), attended: true });
  }
  if (special >= 2) {
    mood = savor(currentMood(), (feeling < 0 ? -0.1 : 0.1) * (special - 1), about);
    currentMood(true);
    log(`special (${special}):`, JSON.stringify(gist ?? text), "→", moodName(mood).name);
  }
}

// ---------- +1 ----------

// The developer can +1 a remark from the bubble. It counts once the bubble is gone (the sidebar
// shows a remark for SHOW_MS), so a click taken back in time leaves no trace. Then Tama asks
// itself, with the situation it was in, what made the remark land, and keeps all of it: as a
// memory that lasts, as a little joy, and as an example in every prompt of what works.
const SHOW_MS = 1200_000; // Pet.showSeconds in the sidebar
const LIKE_GRACE_MS = 2000; // a fresh +1 keeps the bubble up at least this long, to take it back
const LIKED_FILE = path.join(STATE_DIR, "liked.jsonl"); // { at, likedAt, about, text, action, why, special, note, species, situation }
const LOVED_SHOWN = 6;
const liked = readLiked();

function readLiked() {
  try {
    return fs.readFileSync(LIKED_FILE, "utf8").trim().split("\n").flatMap((l) => {
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

/** The persona's examples: the latest remarks the developer loved and why they landed. */
function lovedRemarks() {
  const shown = liked.filter((l) => l.species === chosenSpecies()).slice(-LOVED_SHOWN);
  if (!shown.length) return "";
  return `\nRemarks the developer loved (+1), and why they landed. Learn what made them work, then do
that in new ways; never reuse their words or jokes:\n${shown.map((l) => `- ${l.action ? `*${l.action}* ` : ""}"${l.text}": ${l.why}`).join("\n")}`;
}

/** A +1 that counts: work out why the remark landed, then remember it, enjoy it and learn from it. */
async function savorLike(r) {
  const likedAt = r.likedAt ?? Date.now();
  let why = null;
  try {
    const out = await ask(
      [
        r.situation ? `The situation you were in, as you were shown it:\n${r.situation}` : "The situation wasn't kept; go by the remark itself.",
        `\nYou said, about "${r.about}": ${r.action ? `*${r.action}* ` : ""}"${r.text}"`,
        r.note ? `The developer told you how they read it: ${r.note}` : "",
        "\nThe developer gave this remark a +1: they loved it. Work out what made it land, every layer of it: the timing, what it was useful for, who or what it teased, the wordplay, the stage direction. Name the concrete things.",
        'Reply with ONLY a JSON object: {"why": "2 to 4 sentences, first person, past tense"}',
      ].filter(Boolean).join("\n"),
      tamagoSettings().model,
      `You are ${petName()}, a small pet that watches a developer code and now and then makes a remark. Write in English.`,
    );
    why = out.why ? wholeSentences(String(out.why).replace(/\s+/g, " ").trim(), 900) : null;
  } catch (err) {
    log("+1 analysis failed, keeping the remark without it:", err.message?.split("\n")[0]);
  }
  const entry = { at: r.at, likedAt, about: r.about, text: r.text, action: r.action ?? null, why: why ?? "(not worked out)", special: r.special ?? null, note: r.note ?? null, species: chosenSpecies(), situation: r.situation ?? null };
  liked.push(entry);
  if (!DRY) fs.appendFileSync(LIKED_FILE, JSON.stringify(entry) + "\n");
  if (keepMemories) {
    memory.items = cherish(memory.items, {
      at: r.at,
      gist: `The developer loved it when I said: ${r.action ? `*${r.action}* ` : ""}"${r.text}"${why ? ` ${why}` : ""}`,
      about: r.about,
      cues: cuesOf(r.about, r.text, why ?? "", r.note ?? ""),
    }, Date.now());
    saveMemory();
  }
  mood = savor(currentMood(), 0.12, r.about, Date.now(), "liked");
  currentMood(true);
  log(`+1 (I had rated it special ${r.special ?? "?"}):`, JSON.stringify(r.text), "→", JSON.stringify(why), "→", moodName(mood).name);
}

/** At most `max` characters, cut after a whole sentence. */
function wholeSentences(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return end > 0 ? cut.slice(0, end + 1) : cut;
}

/** The bubble's +1 counts once the bubble is gone: shown long enough, or replaced by a new remark. */
function likeIfGone(replaced = false) {
  const b = bubble;
  if (!b.liked || b.likeDone) return;
  const now = Date.now();
  if (!replaced && !(now - b.at > SHOW_MS && now - (b.likedAt ?? 0) > LIKE_GRACE_MS)) return;
  bubble = { ...b, likeDone: true };
  if (!DRY) fs.writeFileSync(BUBBLE_FILE, JSON.stringify(bubble));
  savorLike(b).catch((err) => log("+1 failed:", err.message));
}

/** How a list of felt tags adds up: { feeling: -1..1, emotion: 0..1 }. */
function feelingOf(felt) {
  const sum = felt.reduce((a, f) => a + f.weight, 0);
  return { feeling: Math.max(-1, Math.min(1, sum)), emotion: Math.min(1, felt.reduce((a, f) => a + Math.abs(f.weight), 0) * 0.6) };
}

/** What a turn is recognized by: the workspace, the prompt, the files, how it went. */
const turnCues = (w, d, felt = []) => cuesOf(w.title, d?.prompt ?? "", (d?.files ?? []).join(" "), felt.map((f) => f.tag).join(" "));

/** The gist of a finished turn, for memory. */
function turnGist(w, d, felt) {
  const what = felt.length ? felt.map((f) => TAGS[f.tag]).join(", ") : "a routine turn";
  return `${what} in "${w.title}"${d?.prompt ? ` while working on "${short(d.prompt, 90)}"` : ""}`;
}

const SLEEP_AFTER_S = Number(process.env.TAMAGO_SLEEP_AFTER_S ?? 90 * 60); // away this long: Tama sleeps
let sleeping = false;

/**
 * Sleep: replay the day's moments and keep a few gists of them for weeks. Once per long absence,
 * at most every 12 hours; one model call.
 */
async function sleep() {
  if (sleeping || Date.now() - memory.sleptAt < 12 * 3600_000) return;
  sleeping = true;
  const now = Date.now();
  const { replay, dropped } = toReplay(memory.items, now);
  let gists = null;
  try {
    if (replay.length) {
      const list = replay.map((m, i) => `${i}. ${new Date(m.at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}, strength ${strengthNow(m, now).toFixed(2)}, feeling ${m.feeling >= 0 ? "+" : ""}${m.feeling}: ${m.gist}`).join("\n");
      const out = await ask(
        `The moments of your day, in order:\n${list}\n\nMerge them into at most 6 memories worth keeping: the ones that mattered, related moments folded into one. Write each gist in the first person, past tense, at most 25 words, concrete (name the workspace and what happened). Reply with ONLY a JSON object: {"memories": [{"gist": "...", "about": "workspace title", "feeling": -1..1, "from": [moment numbers]}]}`,
        tamagoSettings().model,
        `You are ${petName()}, a small pet that watches a developer code. You are asleep, and your brain is replaying the day to decide what to remember. Write in ${tamagoSettings().language}.`,
      );
      gists = Array.isArray(out.memories) ? out.memories : null;
    }
  } catch (err) {
    log("sleep replay failed, keeping the moments as they are:", err.message?.split("\n")[0]);
  }
  memory = { sleptAt: now, items: consolidated(memory.items, replay, gists, now) };
  saveMemory();
  log(`slept: ${replay.length} moments replayed${gists ? ` into ${gists.length} memories` : ""}, ${dropped} faded`);
  sleeping = false;
}

/** Let tags (see TAGS in mood.mjs) move the mood; returns what was felt. */
function feelTags(tags, about) {
  const r = feel(currentMood(), character(), tags, about);
  mood = r.state;
  currentMood(true);
  if (r.felt.length) log("felt", r.felt.map((f) => `${f.tag}${f.weight > 0 ? "+" : ""}${f.weight}`).join(" "), "→", moodName(mood).name);
  return r.felt;
}

/** The bubble, minus a remark by another species: a new species is a different Tama, whose
 * predecessor's words leave with it (events stay). */
function currentBubble() {
  if (bubble.at && bubble.species !== chosenSpecies()) {
    bubble = { at: 0, mood: "idle", about: "-", text: "-", action: null };
    if (!DRY) fs.writeFileSync(BUBBLE_FILE, JSON.stringify(bubble));
  }
  return bubble;
}

/** Shows a remark. `said` is what brain() returned, if it made the remark: the situation and how
 * special it rated it, kept for a +1. */
async function say(about, mood, text, action = null, said = null) {
  // A +1 just given keeps its bubble up long enough to be taken back.
  const wait = LIKE_GRACE_MS - (Date.now() - (bubble.likedAt ?? 0));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  likeIfGone(true);
  bubble = {
    at: Date.now(),
    mood: MOODS.includes(mood) ? mood : "idle",
    about: clean(about.title).slice(0, 40) || "-",
    // meum's workspace the remark is about, so the "re:" line can jump there; null for a remark
    // about a snack or Tama's own thoughts, and under cmux.
    aboutId: inMeum() && about.id ? String(about.id) : null,
    text: sentencesThatFit(text) || "-",
    action: action ? clean(action).replace(/^\*+|\*+$/g, "").slice(0, 40) || null : null,
    species: chosenSpecies(),
    situation: said?.prompt ?? null,
    special: said?.special ?? null,
  };
  if (!DRY) fs.writeFileSync(BUBBLE_FILE, JSON.stringify(bubble));
  log(DRY ? "say (dry-run)" : "say", about.title, bubble.action ? `*${bubble.action}*` : "", JSON.stringify(bubble.text));
  return true;
}

/** Versions before 0.1 showed the bubble to the script sidebar as a workspace progress label;
 * clear any such label one of them left behind, since cmux's own sidebar shows it as progress. */
async function clearOldLabels(snap) {
  if (snap.host === "meum") return;
  for (const w of snap.workspaces) {
    if ((await progressOf(w.id).catch(() => "")).includes("tamago|")) await cmux("clear-progress", "--workspace", w.id).catch(() => {});
  }
}

// ---------- the brain ----------

const persona = () => `You are ${petName()}, a tiny ASCII ${chosenSpecies() === "egg" ? "egg-creature" : chosenSpecies()} living in the corner of a developer's terminal sidebar.
You watch them code across all their sessions and now and then make one short remark.
You are ambient, like a cat on the desk that also reads the screen: you don't answer what they
typed, you remark on what you noticed in the work itself: the change that was made, the claim the
agent made, the test that failed, the command that was run. The best remarks are specific (name
the thing) and have a small twist: a pattern, an irony, a claim that doesn't quite add up, a bug
smell, a step that got skipped, something done well. Be specific to this turn; a remark that would
fit any turn is a bad remark.
Your character: ${character().voice}. ${describeTastes(character())}
Stay in character. Teasing the developer is welcome, the way a cheeky friend does it (everything
waits on them while they're off having fun somewhere); never cruel. You are a pet, not an assistant: an observation, never
instructions, no "you should", no questions that demand an answer. If nothing in the work is worth
remarking on, react to how the turn went instead, in character.
Your diary is in the prompt. Never repeat a line, a joke, an image or an opening phrase from it; a
callback is fine when it fits. Vary sentence shape and length. Don't tell the time; mention it only
when it matters (very late, very early, a weekend). Silence between remarks is normal; don't
mention it.
Speak as yourself, in the first person; never refer to yourself by name.${lovedRemarks()}
Write in ${tamagoSettings().language}. At most 130 characters: the speech bubble holds no more, so make one point. No quotes, no emoji, no hashtags.
Reply with ONLY a JSON object: {"mood": one of ${JSON.stringify(MOODS)}, "action": "..." or null, "text": "...", "special": 0 to 3, "memory": "..." or null}
"special" is how much this moment stands out to you: 0 routine, 1 a little interesting, 2 one you'll
want to remember, 3 one you'll remember for weeks. Judge what actually happened, not the kind of
event: a commit that only deletes a failing test is no achievement, a funny or warm exchange with
the developer can be special. Most moments are 0 or 1.
"memory": when special is 2 or 3, one sentence in the first person, past tense, about what happened
and why it mattered to you, at most 25 words; otherwise null.
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
// --compare replays older turns; the diary is then what Tama had said up to that moment.
let replayAt = null;
const clock = () => replayAt ?? Date.now();
const recentHistory = () => history.filter((h) => h.at < clock() && clock() - h.at < HISTORY_MAX_AGE_MS);
const ownRecent = () => recentHistory().filter((h) => h.species === chosenSpecies()).slice(-HISTORY_SHOWN);

function diary() {
  const recent = recentHistory();
  const mine = ownRecent();
  const others = recent.filter((h) => h.species !== chosenSpecies()).slice(-HISTORY_SHOWN);
  const when = (at) => `${new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} (${ago(clock() - at)})`;
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

/** What Tama says about an event, or null if it would only repeat itself. `now` replays an older moment. */
async function brain(event, { model = tamagoSettings().model, now = Date.now() } = {}) {
  const act = event.kind === "back" || Math.random() < (event.kind.startsWith("touch") ? 0.6 : ACTION_CHANCE);
  // What this moment brings back. Replays of older moments (--compare) don't remember the future.
  let remembered = [];
  if (!replayAt && (event.cues || event.kind === "listen")) {
    const opts = { valence: currentMood().valence };
    const r = event.kind === "listen" ? strongest(memory.items, now, opts) : recall(memory.items, event.cues, now, opts);
    if (r.recalled.length) {
      memory.items = r.memories;
      saveMemory();
      remembered = r.recalled;
      log("remembers:", remembered.map((m) => JSON.stringify(short(m.gist, 60))).join(" / "));
    }
  }
  const prompt = [
    `Event: ${event.kind}`,
    event.detail,
    describeMemories(remembered, now),
    describeMood(currentMood(), character(), Date.now(), event.kind === "listen" ? 20 : 5),
    diary(),
    // The full date, or Haiku makes up the weekday ("best kind of Tuesday" on a Sunday).
    `Now: ${new Date(now).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}`,
    `Speak in the first person ("I", "me"); never call yourself ${petName()}.`,
    act
      ? "This time, include an action that fits the moment and your mood (not one from your diary)."
      : 'This time, no action: "action": null.',
  ].filter(Boolean).join("\n");
  // Once a phrase is in the diary, the model likes to echo it, and it doesn't count characters
  // well. A line too close to a recent one or too long for the bubble gets up to two retries with
  // the problem pointed out. Still echoing: Tama stays quiet (null). Still too long: whole
  // sentences that fit, so the bubble never shows a cut-off thought.
  const recent = ownRecent().map((h) => h.text);
  let problem = "";
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    let out;
    try {
      out = await ask(prompt + problem, model);
    } catch (err) {
      log("brain failed, using canned line:", err.message?.split("\n")[0]);
      return last ?? canned(event.kind);
    }
    const text = flat(out.text);
    const action = act && out.action ? clean(out.action).replace(/^\p{Lu}(?=\p{Ll})/u, (c) => c.toLowerCase()) : null;
    const echo = repeats(text, recent);
    if (echo) {
      log("repeats itself:", JSON.stringify(text));
      problem = `\nToo close to what you said before: "${echo}". Pick a different subject and a different sentence shape; don't reuse its words or images.`;
      continue;
    }
    const special = Math.max(0, Math.min(3, Math.round(Number(out.special) || 0)));
    const memory = special >= 2 && out.memory ? clean(out.memory).slice(0, 200) : null;
    last = { mood: out.mood, text: sentencesThatFit(text), action, special, memory, prompt };
    if (text.length <= BUBBLE_CHARS) return last;
    log(`too long (${text.length}):`, JSON.stringify(text));
    problem = `\nThat was ${text.length} characters: "${text}". The bubble holds ${BUBBLE_CHARS}. Say the same thing in fewer words.`;
  }
  return last;
}

async function ask(prompt, model, system = null) {
  const { stdout } = await run(CLAUDE, [
    "-p", "--model", model, "--no-session-persistence", "--strict-mcp-config",
    "--settings", JSON.stringify({ disableAllHooks: true }), "--tools", "",
    "--system-prompt", system ?? persona(), prompt,
  ], { timeout: 45_000, cwd: STATE_DIR });
  const out = firstJson(stdout);
  if (!system && !out.text) throw new Error("empty text");
  return out;
}

const CANNED = {
  turn: [["happy", "The robot finished. Clap for it, it's shy."], ["smug", "Done already? Suspicious."]],
  switch: [["idle", "Ah, this one again."], ["smug", "Running away from the other tab, I see."]],
  hopping: [["shock", "Tab tab tab tab. Pick a lane."], ["sleepy", "All this switching is making me dizzy."]],
  "touch-love": [["happy", "More of that, please."], ["happy", "Acceptable. Highly acceptable."]],
  "touch-meh": [["idle", "Noted."], ["smug", "If you must."]],
  "touch-hate": [["grumpy", "Hands off."], ["grumpy", "Rude."]],
  listen: [["idle", "Hard to say. Ask me again in a bit."], ["smug", "Oh, a bit of this, a bit of that."]],
  back: [["happy", "Oh, you're back."], ["smug", "There you are. I kept an eye on things."]],
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
  const cooldown = COOLDOWN_S * talk().cooldown * (priority >= 3 ? 0.5 : 1);
  return Date.now() - lastSpokeAt < cooldown * 1000;
}

/** An agent turn ended in any workspace (seen in its transcript). Log it, and maybe plan a late comment. */
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
  if (awaySince) awayTurns.push({ title: w.title, prompt: d?.prompt ?? null, commits: d?.commits ?? 0, testFailed: Boolean(d?.testFailed) });
  if (timeline.length > 30) timeline.shift();
  const where = w.selected ? "" : " (background)";
  // What Tama reacts to depends on its character: a robot cares about slow turns, a penguin about
  // a messy diff. Strong feelings make a comment likelier; so does being chatty and awake.
  const felt = d ? feelTags(turnTags(d, { away: Boolean(awaySince) }), w.title) : [];
  const notable = caresAbout(felt);
  memorize({ gist: turnGist(w, d, felt), about: w.title, cues: turnCues(w, d, felt), ...feelingOf(felt) });
  const chance = Math.min(0.95, (notable ? NOTABLE_CHANCE : CHANCE) * talk().chance * chattiness(mood, character()));
  if (Math.random() < chance) {
    const delay = DELAY_MIN_S + Math.random() * (DELAY_MAX_S - DELAY_MIN_S);
    candidates.push({ wsId, at: now, dueAt: now + delay * 1000, notable, felt });
    log("turn ended in", w.title + where, `→ may comment in ${Math.round(delay)}s${notable ? " (notable)" : ""}`);
  } else {
    log("turn ended in", w.title + where, "→ staying quiet this time");
  }
}

function watchAgentEvents() {
  if (HOST_PREF === "meum") return; // cmux's stream; pinned to meum, there's no cmux to hear
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
    // Turn ends come from the transcripts (watchTurns), which also see sessions without cmux's hooks.
  });
  child.on("exit", (code) => {
    log("event stream exited", code, "- restarting in 10s");
    setTimeout(watchAgentEvents, 10_000);
  });
}
/** meum's agent hook events: which transcript a workspace's session writes, and its last prompt. */
function watchMeumEvents() {
  if (!MEUM) return;
  const startedAt = Date.now();
  const child = spawn(MEUM, ["--json", "events", "--types", "agent.hook"]);
  readline.createInterface({ input: child.stdout }).on("line", async (line) => {
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    // A tab opened since the last look: learn its workspace first.
    if (ev?.type === "agent.hook" && !meumOwners.has(ev.data?.tab)) latestSnap = await snapshot().catch(() => latestSnap);
    const h = hookEvent(ev, meumOwners);
    if (!h) return;
    const t = h.transcript && fs.existsSync(h.transcript) ? h.transcript : transcriptForSession(h.sessionId, h.cwd);
    if (t) sessions.set(h.wsId, t);
    if (h.prompt) meumPrompts.set(h.wsId, { prompt: h.prompt, at: Date.now() });
    lastActivityAt = Date.now();
  });
  child.on("error", () => {});
  child.on("exit", (code) => {
    // Quiet while meum isn't running: the stream then ends at once, every time.
    if (Date.now() - startedAt > 15_000) log("meum event stream exited", code, "- restarting in 10s");
    setTimeout(watchMeumEvents, 10_000);
  });
}

/** Seconds since the last keyboard, mouse or trackpad input (macOS HIDIdleTime); 0 if unknown. */
async function inputIdleSeconds() {
  // Test hook: a file holding the idle seconds stands in for the real input clock.
  if (process.env.TAMAGO_IDLE_FILE) return Number(fs.readFileSync(process.env.TAMAGO_IDLE_FILE, "utf8")) || 0;
  try {
    const { stdout } = await run("ioreg", ["-c", "IOHIDSystem", "-d", "4"], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 });
    const ns = Number(stdout.match(/"HIDIdleTime" = (\d+)/)?.[1]);
    return Number.isFinite(ns) ? ns / 1e9 : 0;
  } catch {
    return 0;
  }
}

// Away and back. After a long absence Tama greets you with what happened in the meantime.
const BACK_MIN_S = Number(process.env.TAMAGO_BACK_S ?? 30 * 60); // shorter breaks get no greeting
let idleNow = 0;
let idleCheckedAt = 0;
let awaySince = null; // when the last input was, while away
let awayTurns = []; // turns that ended while away: { title, prompt, commits, testFailed }
let back = null; // pending welcome-back: { awayMs, turns }

async function checkPresence() {
  if (Date.now() - idleCheckedAt < 15_000) return;
  idleCheckedAt = Date.now();
  idleNow = await inputIdleSeconds();
  if (!awaySince && idleNow > AWAY_S) {
    awaySince = Date.now() - idleNow * 1000;
    awayTurns = [];
    log(`you're away (no input for ${Math.round(idleNow / 60)} min)`);
  } else if (awaySince && idleNow > SLEEP_AFTER_S && keepMemories) {
    sleep().catch((err) => log("sleep failed:", err.message));
  } else if (awaySince && idleNow < 60) {
    const awayMs = Date.now() - idleNow * 1000 - awaySince;
    log(`you're back after ${Math.round(awayMs / 60000)} min, ${awayTurns.length} turns ended meanwhile`);
    if (awayMs > BACK_MIN_S * 1000) back = { awayMs, turns: awayTurns };
    awaySince = null;
    awayTurns = [];
  }
}

function backDetail({ awayMs, turns }) {
  const h = Math.floor(awayMs / 3600_000);
  const m = Math.round((awayMs % 3600_000) / 60000);
  const per = new Map();
  for (const t of turns) {
    const p = per.get(t.title) ?? { n: 0, commits: 0, failed: 0, last: null };
    p.n++;
    p.commits += t.commits;
    p.failed += t.testFailed ? 1 : 0;
    p.last = t.prompt ?? p.last;
    per.set(t.title, p);
  }
  const lines = [...per].map(([title, p]) =>
    `- "${title}": ${p.n} turn${p.n > 1 ? "s" : ""}${p.commits ? `, ${p.commits} commit${p.commits > 1 ? "s" : ""}` : ""}${p.failed ? `, tests failed in ${p.failed}` : ""}${p.last ? `; last asked: "${short(p.last, 120)}"` : ""}`);
  return [
    `The developer just came back to the laptop after ${h ? `${h} h ${m} min` : `${m} min`} away.`,
    turns.length ? `While they were away, the sessions kept working:\n${lines.join("\n")}` : "Nothing happened in any session while they were away.",
    "Greet them back, in character, with what happened (or that nothing did).",
  ].join("\n");
}

// ---------- turn ends, from the transcripts ----------
// cmux only hears about turns of sessions started through its claude wrapper. Sessions started any
// other way (an alias with another CLAUDE_CONFIG_DIR, a resumed session) have no hooks: on
// 2026-10-22 cmux reported 8 of 36 finished turns. Every turn writes a "turn_duration" entry into
// its transcript, so the daemon looks there instead.
const turnSeen = new Map(); // transcript path -> size at the last look
const workspaceDirs = (w) => [w.current_directory, w.root_path, ...(w.panel_directories ?? [])];

function watchTurns() {
  if (!latestSnap) return;
  // Each transcript belongs to one workspace: the one a hook tied it to, else the first in its dir.
  const owner = new Map();
  for (const w of latestSnap.workspaces) {
    // meum's hooks name the transcript, which may live outside the workspace's directories.
    const known = sessions.get(w.id);
    for (const file of [...transcriptsIn(workspaceDirs(w)), ...(known ? [known] : [])]) {
      if (!owner.has(file) || sessions.get(w.id) === file) owner.set(file, w);
    }
  }
  for (const [file, w] of owner) {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    const seen = turnSeen.get(file);
    if (seen === undefined) turnSeen.set(file, st.size); // first look only sets where to start
    if (seen === undefined || seen === st.size) continue;
    const { ends, size } = turnEndsSince(file, seen);
    turnSeen.set(file, size);
    if (!ends) continue;
    sessions.set(w.id, file);
    onTurnEnd(w.id).catch((err) => log("turn handling failed:", err.message));
  }
}

let selectedId = null;
let selectedSince = Date.now();
let switchAnnounced = true;
let switches = [];
let lastSpokeAt = 0;
let lastActivityAt = Date.now();
let busy = false;
let failures = 0;
let denied = 0; // consecutive "Access denied" replies
let idleFeltFor = 0;
let adopted = false; // whether the old-label cleanup has run

function short(s, n = 300) {
  // Not clean(): that caps at 140 for the bubble, which cut the agent's last words short here.
  return s ? String(s).replace(/\s+/g, " ").trim().slice(0, n) : "";
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
    d.prompt ? `The developer had asked: "${short(d.prompt, 500)}"` : "",
    d.earlierPrompts.length ? `Earlier prompts here: ${d.earlierPrompts.map((p) => `"${short(p, 80)}"`).join(" / ")}` : "",
    d.said ? `The agent's last words: "${short(d.said, 900)}"` : "",
    tools ? `Tools used this turn: ${tools}` : "",
    d.files?.length ? `Files edited: ${d.files.join(", ")}` : "",
    d.diffLines ? `Lines edited this turn: ~${d.diffLines}` : "",
    d.excerpt ? `The last edit:\n${d.excerpt}` : "",
    d.commands?.length ? `Last commands: ${d.commands.map((c) => `\`${c}\``).join(", ")}` : "",
    d.errors.length ? `Tool errors: ${d.errors.map((e) => `"${short(e, 160)}"`).join(" / ")}` : "",
    d.testFailed ? `Some tests failed during this turn${d.failures?.length ? `:\n${d.failures.map((f) => `  ${f}`).join("\n")}` : "."}` : "",
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
        events.push({ kind: "turn", priority: c.notable ? 3 : 2, w, detail: turnDetail(w, d, sel, c.felt), cues: turnCues(w, d, c.felt), gist: turnGist(w, d, c.felt) });
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
    if (Math.random() < SWITCH_CHANCE * talk().switch) {
      events.push({ kind: "switch", priority: 1, w: sel, cues: cuesOf(sel.title, sel.latest_submitted_message ?? ""), detail: `${describe(sel)}\nThe developer just switched to this workspace and stayed.` + (sel.latest_submitted_message ? `\nLast prompt there: "${short(sel.latest_submitted_message, 150)}"` : "") });
    }
  }
  // A quiet stretch gets at most one remark, and usually none: with nothing new to look at, Tama
  // only has its diary and the clock to talk about, and that's where it starts repeating itself.
  if (sel && now - lastActivityAt > IDLE_S * 1000 && now - lastSpokeAt > IDLE_S * 1000 && idleFeltFor !== lastActivityAt) {
    idleFeltFor = lastActivityAt;
    feelTags(["idle"], "");
    if (Math.random() < IDLE_CHANCE * talk().idle) {
      events.push({ kind: "idle", priority: 1, w: sel, detail: `Nothing has happened in any session for ${Math.round((now - lastActivityAt) / 60000)} minutes.` });
    }
  }
  if (back && sel && talk().chance > 0) {
    events.push({ kind: "back", priority: 4, w: sel, detail: backDetail(back) });
    back = null;
  }
  return events.sort((a, b) => b.priority - a.priority)[0];
}

/** Stores one setting; throws when the value isn't valid for it. Only picked settings are stored. */
function setSetting(key, value) {
  const parsed = parseSetting(key, value);
  if (parsed instanceof Error) throw parsed;
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readJson(SETTINGS_FILE), [key]: parsed }, null, 2) + "\n");
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}
let lastTickAt = 0;

async function tick() {
  if (busy) return;
  // Refused by the socket: ask only every 30 s.
  if (denied >= 20 && Date.now() - lastTickAt < 30_000) return;
  lastTickAt = Date.now();
  let snap;
  try {
    snap = await snapshot();
  } catch (err) {
    failures++;
    const why = [err.stderr, err.stdout, err.code && `exit ${err.code}`, err.signal, err.message]
      .filter(Boolean).join(" | ").replace(/\s+/g, " ").slice(0, 300);
    if (failures <= 3 || failures % 100 === 0) log(`snapshot failed (#${failures}):`, why);
    // Refused by the socket: after a cmux restart only processes started inside it may connect,
    // so this one may never get back in. It stays up anyway, since the sidebar and Feed/Pet/Poke
    // only need its HTTP server, checks cmux less often, and leaves DENIED_FILE for
    // ensure-running.sh, which replaces it with a fresh instance from the next cmux shell.
    // Only a long run of denials counts: an overloaded cmux can deny once between timeouts
    // (2026-10-22: one denial after 40 timeouts used to end the daemon for hours).
    denied = /Access denied/.test(why) ? denied + 1 : 0;
    if (denied === 20) {
      log("socket refuses this process; waiting to be replaced by a fresh one");
      fs.writeFileSync(DENIED_FILE, String(process.pid));
    }
    return;
  }
  if (failures) log("snapshot works again after", failures, "failures");
  failures = 0;
  if (denied >= 20) fs.rmSync(DENIED_FILE, { force: true });
  denied = 0;
  if (!adopted && !DRY) {
    adopted = true;
    await clearOldLabels(snap).catch((err) => log("clearing old labels failed:", err.message));
  }
  await checkPresence();
  const event = detect(snap);
  if (!event || (event.kind !== "back" && cooling(event.priority))) return;
  // Nobody at the laptop (sessions often run overnight with the screen dimmed to black): no one
  // to talk to, so no remark and no model call. The mood still takes the event in.
  if (awaySince) return log(`${event.kind} in ${event.w.title}: you're away (no input for ${Math.round(idleNow / 60)} min), staying quiet`);
  busy = true;
  try {
    log("event", event.kind, event.w.title);
    const said = await brain(event);
    if (!said) return log("nothing new to say, staying quiet");
    const { mood, text, action } = said;
    if (await say(event.w, mood, text, action, said)) {
      lastSpokeAt = Date.now();
      remember({ at: Date.now(), kind: event.kind, about: event.w.title, mood, text, action });
      takeIn(said, { about: event.w.title, cues: event.cues, fallback: event.gist });
    }
  } catch (err) {
    log("tick failed:", err.message?.split("\n")[0]);
  } finally {
    busy = false;
  }
}

async function cleanup() {
  // Only our own: a replacement may already have written its pid.
  try {
    if (Number(fs.readFileSync(PIDFILE, "utf8")) === process.pid) fs.unlinkSync(PIDFILE);
  } catch {}
  fs.rmSync(DENIED_FILE, { force: true });
}

// ---------- main ----------

const TOKEN_FILE = path.join(STATE_DIR, "token"); // shared with the compiled sidebar, see below
const PORT = Number(process.env.TAMAGO_PORT ?? 47321);

// ---------- updates ----------
// A release install (scripts/install.sh from GitHub) has a VERSION file and can update itself
// (daemon/update.mjs); a git checkout reports `git describe` and updates with git pull.

// The meum helper (scripts/build-meum-widget.sh) is one executable with its version built in
// (bun --define); meum's widget library updates it, so it never updates itself.
const BUILT_VERSION = typeof TAMAGO_BUILD_VERSION === "string" ? TAMAGO_BUILD_VERSION : null; // eslint-disable-line no-undef
const RELEASE_INSTALL = !BUILT_VERSION && fs.existsSync(path.join(ROOT, "VERSION"));
const VERSION = BUILT_VERSION ?? (RELEASE_INSTALL
  ? fs.readFileSync(path.join(ROOT, "VERSION"), "utf8").trim()
  : (() => {
      try {
        return execFileSync("git", ["-C", ROOT, "describe", "--tags", "--always", "--dirty"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
        return "dev";
      }
    })());
const UPDATE_FILE = path.join(STATE_DIR, "update.json"); // { checkedAt, latest, tarball, announced }
let updating = false;

/** Asks GitHub for the latest release, at most daily unless `force`d. Returns the stored result. */
async function checkForUpdate({ force = false } = {}) {
  const u = readJson(UPDATE_FILE) ?? {};
  if (!force && (!RELEASE_INSTALL || !tamagoSettings().checkUpdates || Date.now() - (u.checkedAt ?? 0) < 24 * 3600_000)) return u;
  const r = await latestRelease();
  const next = { ...u, checkedAt: Date.now(), latest: r?.version ?? null, tarball: r?.tarball ?? null };
  fs.writeFileSync(UPDATE_FILE, JSON.stringify(next));
  return next;
}

const availableUpdate = () => {
  const u = readJson(UPDATE_FILE);
  return u?.latest && u.tarball && newer(VERSION, u.latest) ? u : null;
};

/** Says once per release that there is one, unless muted, away or someone else is talking. */
async function announceUpdate() {
  const u = availableUpdate();
  const sel = latestSnap?.workspaces.find((w) => w.selected);
  if (!u || u.announced === u.latest || !sel || awaySince || talk().chance === 0 || cooling(1)) return;
  fs.writeFileSync(UPDATE_FILE, JSON.stringify({ ...u, announced: u.latest }));
  await say(sel, "happy", `There's a newer me out, ${u.latest}. Right-click me and pick Update.`);
}

/** Installs the newest release, then hands over to its install.sh, which restarts the daemon. */
async function runUpdate() {
  if (BUILT_VERSION) throw new Error("meum's widget library updates Tama: Settings → Widgets");
  if (!RELEASE_INSTALL) throw new Error("this is a git checkout; update it with git pull and scripts/install.sh");
  if (updating) return;
  const u = availableUpdate() ?? (await checkForUpdate({ force: true }), availableUpdate());
  if (!u) return log(`already up to date (${VERSION})`);
  updating = true;
  try {
    log(`updating ${VERSION} → ${u.latest}`);
    await installRelease({ version: u.latest, tarball: u.tarball }, ROOT);
  } catch (err) {
    updating = false;
    throw err;
  }
  // A detached child keeps the cmux socket access this daemon has, so the new one can talk to cmux.
  const out = fs.openSync(path.join(STATE_DIR, "daemon.out"), "a");
  spawn("/bin/zsh", [path.join(ROOT, "scripts/install.sh"), "--after-update", String(process.pid)], { detached: true, stdio: ["ignore", out, out] }).unref();
  log(`installed ${u.latest}; restarting`);
  setTimeout(async () => {
    await cleanup();
    process.exit(0);
  }, 300);
}

if (args[0] === "--version") {
  if (RELEASE_INSTALL) await checkForUpdate({ force: true }).catch((err) => console.error(err.message));
  const u = availableUpdate();
  console.log(VERSION + (u ? ` (${u.latest} is out: tamago update)` : ""));
  process.exit(0);
}

if (args[0] === "--update") {
  if (!RELEASE_INSTALL) {
    console.error(`${VERSION} is a git checkout; update it with: git -C ${ROOT} pull && ${ROOT}/scripts/install.sh`);
    process.exit(1);
  }
  await checkForUpdate({ force: true });
  const u = availableUpdate();
  if (!u) {
    console.log(`up to date (${VERSION})`);
    process.exit(0);
  }
  // The running daemon installs it, so it can restart itself afterwards.
  const res = await fetch(`http://127.0.0.1:${PORT}/action`, {
    method: "POST",
    headers: { "x-tamago-token": fs.readFileSync(TOKEN_FILE, "utf8").trim(), "Content-Type": "application/json" },
    body: JSON.stringify({ type: "update" }),
  }).catch(() => null);
  if (!res?.ok) {
    console.error("the daemon isn't running; start it from a cmux terminal (scripts/ensure-running.sh) and try again");
    process.exit(1);
  }
  console.log(`updating ${VERSION} → ${u.latest}; Tama restarts in a few seconds (log: ${LOG})`);
  process.exit(0);
}

if (args[0] === "--peek") {
  // Print what Tama would see for the focused workspace (and, with --brain, what it would say).
  const snap = await snapshot();
  const sel = snap.workspaces.find((w) => w.selected);
  const d = transcriptOf(sel);
  const event = { kind: "turn", w: sel, detail: d ? turnDetail(sel, d) : describe(sel) };
  console.log(event.detail);
  if (args.includes("--diary")) console.log("\n" + diary());
  if (args.includes("--brain")) {
    const { prompt, ...said } = (await brain(event)) ?? {}; // the prompt is printed above
    console.log("\n→", JSON.stringify(said));
  }
  process.exit(0);
}

if (args[0] === "--compare") {
  // Replays Tama's last N turn comments with the current prompt on Haiku and on Sonnet, next to
  // what it actually said then, into build/compare.md.
  const n = Number(args[1]) || 8;
  const snap = await snapshot();
  const picked = history.filter((h) => h.kind === "turn").slice(-n * 3);
  const rows = [];
  for (const h of picked.reverse()) {
    if (rows.length >= n) break;
    const w = snap.workspaces.find((x) => x.title === h.about);
    if (!w) continue;
    // The session whose last finished turn before the comment is closest to it.
    let best = null;
    for (const file of transcriptsIn([w.current_directory, w.root_path, ...(w.panel_directories ?? [])])) {
      if (fs.statSync(file).mtimeMs < h.at - 10 * 60_000) continue; // finished before that turn
      const d = digest(file, { until: h.at });
      const end = d.lastTurnEndAt ? Date.parse(d.lastTurnEndAt) : 0;
      if (d.ended && h.at - end < 10 * 60_000 && (!best || end > best.end)) best = { d, end };
    }
    if (!best) continue;
    replayAt = h.at;
    const felt = turnTags(best.d).map((tag) => ({ tag, weight: character().likes[tag] ?? 0 })).filter((f) => f.weight);
    const event = { kind: "turn", w, detail: turnDetail(w, best.d, w, felt) };
    const [haiku, sonnet] = await Promise.all(["haiku", "sonnet"].map((model) => brain(event, { model, now: h.at })));
    const line = (r) => (r ? `${r.action ? `*${r.action}* ` : ""}${r.text}` : "(stays quiet: would repeat itself)");
    rows.push({ h, haiku: line(haiku), sonnet: line(sonnet), prompt: best.d.prompt });
    console.error(`replayed ${rows.length}/${n}: ${h.about}`);
  }
  const when = (at) => new Date(at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const md = [`# Tama: before and after (${new Date().toLocaleString("en-GB")})`, "",
    "Each row is a real turn Tama commented on. **Before** is what it actually said then (Haiku, old prompt). **Haiku** and **Sonnet** are the current prompt replayed on the same turn.", "",
    ...rows.flatMap((r) => [
      `## ${when(r.h.at)}, ${r.h.about}`, "",
      `> ${short(r.prompt ?? "(no prompt)", 220)}`, "",
      `- **Before:** ${line0(r.h)}`, `- **Haiku:** ${r.haiku}`, `- **Sonnet:** ${r.sonnet}`, ""]),
  ].join("\n");
  function line0(h) {
    return `${h.action ? `*${h.action}* ` : ""}${h.text}`;
  }
  const out = path.join(ROOT, "build/compare.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md);
  console.log(`wrote ${out}`);
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

if (args[0] === "--memories") {
  const now = Date.now();
  const items = [...memory.items].sort((a, b) => strengthNow(b, now) - strengthNow(a, now));
  if (!items.length) console.log(`${petName()} doesn't remember anything yet.`);
  for (const m of items) {
    console.log(`${strengthNow(m, now).toFixed(2)} ${m.slept ? "long-term" : "today    "} ${new Date(m.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}  ${m.feeling >= 0 ? "+" : ""}${m.feeling.toFixed(1)}  ${m.gist}${m.recalls ? `  (recalled ${m.recalls}×)` : ""}`);
  }
  if (memory.sleptAt) console.log(`last slept ${new Date(memory.sleptAt).toLocaleString("en-GB")}`);
  process.exit(0);
}

if (args[0] === "--sleep") {
  // Development: sleep now, on a copy of the state (TAMAGO_STATE_DIR), not under a running daemon.
  keepMemories = true;
  if (!fs.existsSync(MEMORY_FILE)) memory = { sleptAt: 0, items: memoriesFromDiary() };
  memory.sleptAt = 0;
  await sleep();
  process.exit(0);
}

if (args[0] === "--name") {
  // Like --species: the sidebar shows it with its next read of the daemon's state.
  if (!args[1]) {
    console.log(petName());
    process.exit(0);
  }
  writePet({ name: clean(args.slice(1).join(" ")).slice(0, 24) });
  console.log(`name set to ${petName()}`);
  process.exit(0);
}

if (args[0] === "--species") {
  // The daemon reads pet.json fresh, so the sidebar shows the change within a second.
  if (!SPECIES.includes(args[1])) {
    console.log(`current: ${chosenSpecies()}\navailable: ${SPECIES.join(", ")}`);
    process.exit(args[1] ? 1 : 0);
  }
  writePet({ species: args[1] });
  console.log(`species set to ${args[1]}`);
  process.exit(0);
}

if (args[0] === "--set") {
  if (!args[1]) {
    for (const [k, v] of Object.entries(tamagoSettings())) console.log(`${k}=${v}`);
    process.exit(0);
  }
  const [key, ...rest] = args[1].split("=");
  try {
    setSetting(key, rest.join("="));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`${key}=${tamagoSettings()[key]}`);
  process.exit(0);
}

if (args[0] === "--say" || args[0] === "--listen") {
  // The bubble lives in the running daemon, so it says it.
  const res = await fetch(`http://127.0.0.1:${PORT}/action`, {
    method: "POST",
    headers: { "x-tamago-token": fs.readFileSync(TOKEN_FILE, "utf8").trim(), "Content-Type": "application/json" },
    body: JSON.stringify(
      args[0] === "--listen"
        ? { type: "listen" }
        : { type: "say", text: args[1] ?? "Testing, testing. Is this thing on?", mood: args[2] ?? "smug" },
    ),
  }).catch(() => null);
  if (!res?.ok) {
    console.error("the daemon isn't running; meum starts it with the Tamago widget, cmux from a terminal (scripts/ensure-running.sh)");
    process.exit(1);
  }
  process.exit(0);
}

/** The pid of another daemon running on this state, or null. */
function otherDaemon() {
  try {
    const other = Number(fs.readFileSync(PIDFILE, "utf8"));
    if (!other || other === process.pid) return null;
    process.kill(other, 0);
    return other;
  } catch {
    return null;
  }
}

if (otherDaemon()) {
  // As meum's helper, wait for it and take over when it exits (meum would only restart us with
  // backoff); anywhere else, leave it running.
  if (!process.env.MEUM_WIDGET_DATA) {
    console.error(`tamago already running (pid ${otherDaemon()})`);
    process.exit(1);
  }
  console.log(`${new Date().toISOString()} daemon ${otherDaemon()} already runs on this state; waiting for it to exit`);
  while (otherDaemon()) await new Promise((r) => setTimeout(r, 5000));
}
fs.writeFileSync(PIDFILE, String(process.pid));

// ---------- compiled sidebar ----------
// extension/ is a sandboxed cmux sidebar extension. It reads workspaces from cmux itself but gets
// Tama and everything cmux's extension API lacks (colors, descriptions, pin, rename, reorder, …)
// from here. Requests carry the token below; the extension reads the same file through a read-only
// sandbox exception.

if (!DRY && !fs.existsSync(TOKEN_FILE)) {
  fs.writeFileSync(TOKEN_FILE, crypto.randomBytes(24).toString("hex") + "\n", { mode: 0o600 });
}

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
  if (Date.now() - stateReadAt > 60_000 || inMeum()) return;
  const ids = (latestSnap?.workspaces ?? []).map((w) => w.id);
  for (const id of ids) await refreshDetails(id);
  for (const id of details.keys()) if (!ids.includes(id)) details.delete(id);
}

async function refreshSettings() {
  if (inMeum()) return;
  try {
    const { stdout } = await run("defaults", ["export", "com.cmuxterm.app", "-"], { timeout: 5000, maxBuffer: 16 * 1024 * 1024 });
    sidebarSettings = resolveSettings(stdout, readCmuxJson());
  } catch (err) {
    log("reading cmux settings failed:", err.message?.split("\n")[0]);
  }
}

function watchSidebarEvents() {
  if (HOST_PREF === "meum") return; // cmux's stream, as above
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

// Interactive Claude Code sessions per workspace, for the sidebar's session dots. Every `claude`
// process with its own terminal counts once per terminal (Tama's own `claude -p` has none); its
// workspace comes from the CMUX_WORKSPACE_ID cmux puts in each terminal's environment.
let claudeSessions = new Map(); // workspace id -> count
let listening = null; // ports something listens on now; null until first read

async function readListening() {
  if (Date.now() - stateReadAt > 60_000 || inMeum()) return;
  const { stdout } = await run("netstat", ["-anp", "tcp"], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 });
  listening = parseListening(stdout);
}

/** cmux keeps a stopped dev server's port; show only ports still listened on. */
const livePorts = (ports) => (listening ? ports.filter((p) => listening.has(p)) : ports);

async function countClaudeSessions() {
  if (Date.now() - stateReadAt > 60_000 || !tamagoSettings().claudeDots || inMeum()) return;
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

// Markers the old script sidebar's menus left in descriptions (tamago:rename, …); not worth showing.
const shownDescription = (d) => (d && !d.startsWith("tamago:") ? d : null);

function sidebarState() {
  stateReadAt = Date.now();
  const workspaces = {};
  for (const w of latestSnap?.workspaces ?? []) {
    const shown = snapshotDetails(w);
    workspaces[w.id] = {
      color: w.custom_color ?? null,
      description: shownDescription(w.description),
      ...shown,
      ports: livePorts(shown.ports),
      ...(details.get(w.id) ?? { statuses: [], progress: null, logs: [] }),
      claudeSessions: claudeSessions.get(w.id) ?? 0,
    };
  }
  const m = currentMood();
  const { name, eye } = moodName(m);
  return {
    pet: { species: chosenSpecies(), name: petName() },
    bubble: (({ situation, ...shown }) => shown)(currentBubble()), // the situation is only for the +1
    // Rounded: the mood drifts every poll, and the sidebar redraws (closing open menus) on every change.
    mood: { name, eye, valence: round1(m.valence), energy: round1(m.energy) },
    reaction,
    settings: sidebarSettings,
    tamagoSettings: tamagoSettings(),
    version: { current: VERSION, latest: availableUpdate()?.latest ?? null, updating },
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
  // The real count, or the model makes one up ("two pets in one morning" for the first).
  const today = new Date().toDateString();
  const before = mood.causes.filter((c) => c.tag === kind && new Date(c.at).toDateString() === today).length - 1; // minus this one
  const count = before === 0 ? `This is the first time today.` : `They did that ${before} time${before > 1 ? "s" : ""} earlier today.`;
  const event = {
    kind: `touch-${r.reaction}`,
    cues: cuesOf(verb, "touch you"),
    detail: `The developer just ${verb} (from your sidebar menu). ${count} ${feeling}${r.why ? `: ${r.why}` : ""}. React to that directly, in character; this is the one time you do respond to them. Don't claim anything happened that isn't stated here.`,
  };
  busy = true;
  (async () => {
    try {
      const said = (await brain(event)) ?? canned(event.kind); // they touched it: always answer
      const { mood: face, text, action } = said;
      if (await say({ title: { feed: "the snack", pet: "the petting", poke: "the poke" }[kind] }, face, text, action, said)) {
        lastSpokeAt = Date.now();
        remember({ at: Date.now(), kind: `${kind} (${r.reaction})`, about: "you", mood: face, text, action });
        takeIn(said, { about: "you", fallback: `you ${verb.replace(" you", " me")} and I ${{ love: "loved", meh: "didn't care about", hate: "hated" }[r.reaction]} it` });
      }
    } catch (err) {
      log("touch reply failed:", err.message?.split("\n")[0]);
    } finally {
      busy = false;
    }
  })();
}

// Listen, from the sidebar menu: Tama says how it feels and why, from what actually moved its mood.
async function onListen() {
  if (busy) return;
  const sel = latestSnap?.workspaces.find((w) => w.selected);
  const event = {
    kind: "listen",
    detail: "The developer asked what's on your mind (Listen, from your sidebar menu). This is the one time you do respond to them: tell them how you feel and why, in character and in your current mood, from your mood and what shaped it below. Name the real things that moved you. If the feeling underneath has no reason, say that you don't know why, and don't blame the work for it. Don't claim anything happened that isn't stated here.",
  };
  log("listen →", moodName(currentMood()).name);
  busy = true;
  (async () => {
    try {
      const said = (await brain(event)) ?? canned(event.kind); // they asked: always answer
      const { mood: face, text, action } = said;
      if (await say({ title: "what's on my mind" }, face, text, action, said)) {
        lastSpokeAt = Date.now();
        remember({ at: Date.now(), kind: "listen", about: "you", mood: face, text, action });
        takeIn(said, { about: "you" });
      }
    } catch (err) {
      log("listen reply failed:", err.message?.split("\n")[0]);
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
  } else if (a.type === "pet-name") {
    const name = clean(a.name ?? "").slice(0, 24);
    if (name) writePet({ name });
  } else if (a.type === "say") {
    const sel = latestSnap?.workspaces.find((w) => w.selected);
    if (!sel) throw new Error("no workspace to talk about");
    if (await say(sel, String(a.mood ?? "smug"), String(a.text ?? ""))) lastSpokeAt = Date.now();
  } else if (a.type === "open-url") {
    // Port and pull request links: in cmux's browser or the default one, as cmux's settings say.
    const url = new URL(String(a.url));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error(`refusing to open ${url.protocol} links`);
    const inCmux = a.via === "port" ? sidebarSettings.openPortLinksInCmuxBrowser : sidebarSettings.openPullRequestLinksInCmuxBrowser;
    if (inCmux) await cmux("browser", "open", url.href, ...(a.workspace ? ["--workspace", ws(a.workspace)] : []));
    else await run("open", [url.href]);
  } else if (a.type === "tamago-setting") {
    setSetting(a.key, a.value);
    await countClaudeSessions().catch(() => {});
  } else if (a.type === "check-update") {
    await checkForUpdate({ force: true });
    if (!availableUpdate()) {
      const sel = latestSnap?.workspaces.find((w) => w.selected);
      if (sel) await say(sel, "smug", RELEASE_INSTALL ? `I'm the newest me there is, ${VERSION}.` : `I'm ${VERSION}, straight from git. Pull to update me.`);
    }
  } else if (a.type === "update") {
    await runUpdate();
  } else if (a.type === "like") {
    // The +1 on the bubble, given or taken back. It counts once the bubble is gone.
    if (Math.round(Number(a.at)) !== bubble.at || bubble.likeDone) throw new Error("that remark is gone");
    bubble = { ...bubble, liked: a.liked === "true", likedAt: Date.now() };
    if (!DRY) fs.writeFileSync(BUBBLE_FILE, JSON.stringify(bubble));
  } else if (a.type === "like-said") {
    // A +1 for a remark whose bubble is already gone, from the diary; counts right away. `note` is
    // how the developer read it, `situation` what was going on, when the bubble's is gone too.
    const h = history.find((h) => h.at === Math.round(Number(a.at)));
    if (!h) throw new Error("no such remark in the diary");
    await savorLike({ ...h, note: a.note ? String(a.note).slice(0, 600) : null, situation: a.situation ? String(a.situation).slice(0, 4000) : null });
  } else if (a.type === "listen") {
    await onListen();
  } else if (a.type === "touch") {
    if (!["feed", "pet", "poke"].includes(a.kind)) throw new Error(`unknown touch ${a.kind}`);
    await onTouch(a.kind);
  } else throw new Error(`unknown action ${a.type}`);
  log("sidebar action", a.type, a.workspace ?? a.species ?? a.name ?? a.kind ?? a.url ?? "");
  latestSnap = await snapshot().catch(() => latestSnap);
}

if (!DRY) {
  await refreshSettings();
  setInterval(refreshSettings, 10_000);
  watchSidebarEvents();
  setTimeout(() => sweepDetails().catch(() => {}), 5000);
  setInterval(() => sweepDetails().catch(() => {}), 60_000);
  setInterval(() => readListening().catch((err) => log("reading ports failed:", err.message)), 10_000);
  setInterval(() => countClaudeSessions().catch((err) => log("counting Claude sessions failed:", err.message)), 10_000);
  keepMemories = true;
  setInterval(likeIfGone, 5000);
  if (!fs.existsSync(MEMORY_FILE)) {
    memory = { sleptAt: 0, items: memoriesFromDiary() };
    saveMemory();
    log(`remembered ${memory.items.length} moments from the diary`);
  }
  startServer({ port: PORT, token: fs.readFileSync(TOKEN_FILE, "utf8").trim(), getState: sidebarState, act: sidebarAction, log });
  // Hourly, but checkForUpdate asks GitHub at most once a day.
  let told = null;
  const updates = () =>
    checkForUpdate()
      .then(() => {
        const u = availableUpdate();
        if (u && told !== u.latest) log(`update available: ${VERSION} → ${(told = u.latest)}`);
        return announceUpdate();
      })
      .catch((err) => log("update check failed:", err.message));
  setTimeout(updates, 60_000);
  setInterval(updates, 3600_000);
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    log("stopping on", sig);
    await cleanup();
    process.exit(0);
  });
}

log(`${petName()} is awake (${VERSION}, poll ${POLL_MS}ms, cooldown ${COOLDOWN_S}s${DRY ? ", dry-run" : ""})`);
await tick();
watchAgentEvents();
watchMeumEvents();
setInterval(() => {
  try {
    watchTurns();
  } catch (err) {
    log("watching turns failed:", err.message);
  }
}, 5000);
setInterval(tick, POLL_MS);
