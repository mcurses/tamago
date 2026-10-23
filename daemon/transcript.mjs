// Reads Claude Code transcripts (~/.claude/projects/<slug>/<session>.jsonl) for a workspace and
// condenses the latest turn into a small digest Tama can react to. Sessions of other accounts live
// in other config dirs (CLAUDE_CONFIG_DIR, e.g. ~/.claude-work), so every ~/.claude*/projects counts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Every Claude config dir's projects folder: ~/.claude, ~/.claude-work, ~/.claude-wa1, … */
export function projectRoots(home = os.homedir()) {
  const roots = [];
  for (const e of fs.readdirSync(home, { withFileTypes: true })) {
    if (!e.name.startsWith(".claude") || !(e.isDirectory() || e.isSymbolicLink())) continue;
    const p = path.join(home, e.name, "projects");
    if (fs.existsSync(p)) roots.push(p);
  }
  return roots;
}
const TAIL_BYTES = 768 * 1024;
const MAX_AGE_MS = 12 * 3600_000;
const TEST_FAIL = /(\b[1-9]\d* (failed|failing)\b|^FAIL\b|\bTests?:.*\b[1-9]\d* failed\b|AssertionError|✗ |\bnot ok \d+)/m;
const TEST_PASS = /(\b[1-9]\d* (passed|passing)\b|^# pass [1-9]|\bTests?:.*\b[1-9]\d* passed\b|^PASS\b|\bAll tests passed\b)/m;
const COMMIT = /\bgit\b[^\n|;&]*\bcommit\b/;

// Claude Code names project dirs after the cwd with every non-alphanumeric char replaced by "-".
const slug = (dir) => dir.replace(/[^a-zA-Z0-9]/g, "-");

/** Transcript of a Claude session reported by a cmux agent hook ("claude-<uuid>" + cwd), or null. */
export function transcriptForSession(sessionId, cwd) {
  const uuid = String(sessionId ?? "").replace(/^claude-/, "");
  if (!uuid) return null;
  const roots = projectRoots();
  for (const root of roots) {
    const direct = cwd && path.join(root, slug(cwd), `${uuid}.jsonl`);
    if (direct && fs.existsSync(direct)) return direct;
  }
  // The session may have started in another directory than the hook's cwd; look everywhere.
  for (const root of roots) {
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, `${uuid}.jsonl`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

/** Every transcript of the given directories, in every account's config dir. */
export function transcriptsIn(dirs) {
  const roots = projectRoots();
  return [...new Set(dirs.filter(Boolean))].flatMap((dir) => roots.flatMap((root) => {
    const proj = path.join(root, slug(dir));
    try {
      return fs.readdirSync(proj).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(proj, f));
    } catch {
      return [];
    }
  }));
}

/**
 * How many turns ended in `file` between byte `from` and its end. Claude Code writes a
 * "turn_duration" entry when a turn finishes, whether or not the session runs with cmux's hooks,
 * so this catches turns cmux never hears about. Only the last 8 MB of new bytes are read.
 */
export function turnEndsSince(file, from) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(from, size - 8 * 1024 * 1024);
    if (start >= size) return { ends: 0, size };
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return { ends: buf.toString("utf8").split('"subtype":"turn_duration"').length - 1, size };
  } finally {
    fs.closeSync(fd);
  }
}

/** Most recently written transcript among the given directories, or null. */
export function transcriptFor(dirs) {
  let best = null;
  const roots = projectRoots();
  for (const proj of new Set(dirs.filter(Boolean).flatMap((dir) => roots.map((root) => path.join(root, slug(dir)))))) {
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

// Newer Claude Code versions log every raw API request into the transcript ("api-request…"
// entries, megabytes per turn). They are skipped without parsing, and the tail grows until it
// reaches back to the turn's prompt, so a long turn isn't seen as tool results without a start.
const SKIPPED = /^\{[^{]{0,200}"type":"api-request/;
const MAX_TAIL_BYTES = 48 * 1024 * 1024;

function readTurnTail(file) {
  for (let bytes = TAIL_BYTES; ; bytes *= 4) {
    const { entries, whole } = readTail(file, bytes);
    if (whole || bytes >= MAX_TAIL_BYTES || entries.some(promptText)) return entries;
  }
}

function readTail(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // first line is probably cut in half
    const entries = lines.flatMap((l) => {
      if (!l || SKIPPED.test(l)) return [];
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
    return { entries, whole: start === 0 };
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

// Files whose contents never go into Tama's prompt, even as a diff excerpt.
const PRIVATE_FILE = /(^|\/)\.env|secret|credential|token|password|\.pem$|\.key$|id_rsa/i;
const FAIL_LINE = /(\bFAIL\b|✗|✖|\bnot ok\b|\bfailed\b|AssertionError|Error:)/;

/** The last edit of the turn as a small diff: a few removed and added lines. */
function excerptOf(edit) {
  if (!edit || PRIVATE_FILE.test(edit.file)) return null;
  const take = (s, n, mark) => (s ? s.split("\n").filter((l) => l.trim()).slice(0, n).map((l) => `${mark} ${l.slice(0, 120)}`) : []);
  const lines = [...take(edit.old, 5, "-"), ...take(edit.new, 8, "+")];
  return lines.length ? lines.join("\n").slice(0, 900) : null;
}

/**
 * Digest of the latest turn: { prompt, earlierPrompts, said, tools, errors, testFailed, testPassed,
 * commits, diffLines, durationMs, ended, lastTurnEndAt, turnsToday, files, excerpt, commands,
 * failures }. testPassed means the last test run of the turn passed. `until` (ms) reads the
 * transcript as it was then, to replay an older turn.
 */
export function digest(file, { until = Infinity } = {}) {
  const entries = readTurnTail(file).filter((e) => !e.timestamp || Date.parse(e.timestamp) <= until);
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
  let testPassed = false;
  let commits = 0;
  let diffLines = 0;
  let durationMs = null;
  let ended = false;
  const files = [];
  const commands = [];
  const failures = [];
  let lastEdit = null;
  for (const e of turn) {
    if (e.type === "system" && e.subtype === "turn_duration") {
      ended = true;
      durationMs = e.durationMs;
    }
    for (const b of blocks(e)) {
      if (e.type === "assistant" && b.type === "text" && b.text.trim()) said = b.text;
      if (b.type === "tool_use") {
        tools[b.name] = (tools[b.name] ?? 0) + 1;
        if (b.name === "Bash" && COMMIT.test(String(b.input?.command ?? ""))) commits++;
        diffLines += lineCount(b.input?.new_string) + lineCount(b.input?.old_string) + lineCount(b.input?.content);
        const f = b.input?.file_path ?? b.input?.notebook_path;
        if (f && /^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name)) {
          const rel = path.basename(path.dirname(f)) + "/" + path.basename(f);
          if (!files.includes(rel)) files.push(rel);
          const edit = b.input.edits?.at(-1) ?? b.input;
          lastEdit = { file: f, old: edit.old_string, new: edit.new_string ?? edit.content ?? edit.new_source };
        }
        if (b.name === "Bash" && b.input?.command) commands.push(String(b.input.command).split("\n")[0].slice(0, 100));
      }
      if (b.type === "tool_result") {
        const text = resultText(b);
        if (b.is_error && errors.length < 2) errors.push(text.trim().slice(0, 200));
        if (TEST_FAIL.test(text)) {
          [testFailed, testPassed] = [true, false];
          for (const l of text.split("\n")) if (FAIL_LINE.test(l) && failures.length < 3) failures.push(l.trim().slice(0, 140));
        }
        else if (TEST_PASS.test(text)) testPassed = true;
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
    testPassed,
    commits,
    diffLines,
    durationMs,
    ended,
    lastTurnEndAt,
    turnsToday,
    files: files.slice(-6),
    excerpt: excerptOf(lastEdit),
    commands: commands.slice(-4),
    failures,
  };
}
