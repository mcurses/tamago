// Reads Claude Code transcripts (~/.claude/projects/<slug>/<session>.jsonl) for a workspace and
// condenses the latest turn into a small digest Tama can react to.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROJECTS = path.join(os.homedir(), ".claude/projects");
const TAIL_BYTES = 768 * 1024;
const MAX_AGE_MS = 12 * 3600_000;
const TEST_FAIL = /(\b\d+ (failed|failing)\b|^FAIL\b|\bTests?:.*\bfailed\b|AssertionError|✗ |\bnot ok \d+)/m;

// Claude Code names project dirs after the cwd with every non-alphanumeric char replaced by "-".
const slug = (dir) => dir.replace(/[^a-zA-Z0-9]/g, "-");

/** Transcript of a Claude session reported by a cmux agent hook ("claude-<uuid>" + cwd), or null. */
export function transcriptForSession(sessionId, cwd) {
  const uuid = String(sessionId ?? "").replace(/^claude-/, "");
  if (!uuid) return null;
  const direct = cwd && path.join(PROJECTS, slug(cwd), `${uuid}.jsonl`);
  if (direct && fs.existsSync(direct)) return direct;
  // The session may have started in another directory than the hook's cwd; look everywhere.
  for (const d of fs.readdirSync(PROJECTS)) {
    const p = path.join(PROJECTS, d, `${uuid}.jsonl`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Most recently written transcript among the given directories, or null. */
export function transcriptFor(dirs) {
  let best = null;
  for (const dir of new Set(dirs.filter(Boolean))) {
    const proj = path.join(PROJECTS, slug(dir));
    let files;
    try {
      files = fs.readdirSync(proj).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const p = path.join(proj, f);
      const mtime = fs.statSync(p).mtimeMs;
      if (Date.now() - mtime < MAX_AGE_MS && (!best || mtime > best.mtime)) best = { path: p, mtime };
    }
  }
  return best;
}

function readTail(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // first line is probably cut in half
    return lines.flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  } finally {
    fs.closeSync(fd);
  }
}

const blocks = (e) => (Array.isArray(e.message?.content) ? e.message.content : []);
const resultText = (b) =>
  typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((c) => c.text ?? "").join("\n") : "";
const lineCount = (s) => (typeof s === "string" && s ? s.split("\n").length : 0);

/** A real prompt typed by the user, as opposed to tool results, meta entries or subagent traffic. */
function promptText(e) {
  if (e.type !== "user" || e.isSidechain || e.isMeta) return null;
  const c = e.message?.content;
  if (typeof c === "string") return c.startsWith("<") ? null : c; // skip <command-…>/<local-…> wrappers
  if (blocks(e).some((b) => b.type === "tool_result")) return null;
  const text = blocks(e).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  return text && !text.startsWith("<") ? text : null;
}

/**
 * Digest of the latest turn: { prompt, earlierPrompts, said, tools, errors, testFailed, diffLines,
 * durationMs, ended, lastTurnEndAt, turnsToday }.
 */
export function digest(file) {
  const entries = readTail(file);
  let promptIdx = -1;
  const prompts = [];
  let lastTurnEndAt = null;
  let turnsToday = 0;
  const today = new Date().toDateString();
  entries.forEach((e, i) => {
    const p = promptText(e);
    if (p) {
      promptIdx = i;
      prompts.push(p);
    }
    if (e.type === "system" && e.subtype === "turn_duration") {
      lastTurnEndAt = e.timestamp;
      if (new Date(e.timestamp).toDateString() === today) turnsToday++;
    }
  });
  const turn = promptIdx >= 0 ? entries.slice(promptIdx + 1).filter((e) => !e.isSidechain) : [];
  const tools = {};
  const errors = [];
  let said = "";
  let testFailed = false;
  let diffLines = 0;
  let durationMs = null;
  let ended = false;
  for (const e of turn) {
    if (e.type === "system" && e.subtype === "turn_duration") {
      ended = true;
      durationMs = e.durationMs;
    }
    for (const b of blocks(e)) {
      if (e.type === "assistant" && b.type === "text" && b.text.trim()) said = b.text;
      if (b.type === "tool_use") {
        tools[b.name] = (tools[b.name] ?? 0) + 1;
        diffLines += lineCount(b.input?.new_string) + lineCount(b.input?.old_string) + lineCount(b.input?.content);
      }
      if (b.type === "tool_result") {
        const text = resultText(b);
        if (b.is_error && errors.length < 2) errors.push(text.trim().slice(0, 200));
        if (TEST_FAIL.test(text)) testFailed = true;
      }
    }
  }
  return {
    prompt: prompts.at(-1) ?? null,
    earlierPrompts: prompts.slice(-4, -1),
    said,
    tools,
    errors,
    testFailed,
    diffLines,
    durationMs,
    ended,
    lastTurnEndAt,
    turnsToday,
  };
}
