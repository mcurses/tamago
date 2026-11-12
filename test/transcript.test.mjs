// Tests for daemon/transcript.mjs. Run with `npm test` (uses the built-in node:test runner).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The projects folders are found under os.homedir(), so point HOME at a scratch dir first.
const home = fs.mkdtempSync(path.join(os.tmpdir(), "tamago-home-"));
process.env.HOME = home;
const { digest, transcriptFor, transcriptForSession } = await import("../daemon/transcript.mjs");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tamago-transcripts-"));
const now = new Date().toISOString();

const user = (text, extra = {}) => ({ type: "user", timestamp: now, message: { content: text }, ...extra });
const toolUse = (name, input = {}) => ({ type: "assistant", timestamp: now, message: { content: [{ type: "tool_use", name, input }] } });
const toolResult = (text, isError = false) => ({
  type: "user",
  timestamp: now,
  message: { content: [{ type: "tool_result", content: text, is_error: isError }] },
});
const said = (text) => ({ type: "assistant", timestamp: now, message: { content: [{ type: "text", text }] } });
const turnEnd = (durationMs = 4000) => ({ type: "system", subtype: "turn_duration", timestamp: now, durationMs });

function writeTranscript(name, entries) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

test("digest: a finished turn reports prompt, tools, said text and duration", () => {
  const file = writeTranscript("finished.jsonl", [
    user("first question"),
    said("earlier answer"),
    turnEnd(1000),
    user("fix the parser"),
    toolUse("Edit", { old_string: "a\nb", new_string: "c\nd\ne" }),
    toolResult("ok"),
    toolUse("Bash", { command: "ls" }),
    toolResult("file.txt"),
    said("Parser fixed."),
    turnEnd(12345),
  ]);
  const d = digest(file);
  assert.equal(d.prompt, "fix the parser");
  assert.deepEqual(d.earlierPrompts, ["first question"]);
  assert.equal(d.said, "Parser fixed.");
  assert.deepEqual(d.tools, { Edit: 1, Bash: 1 });
  assert.equal(d.diffLines, 5); // 3 new lines + 2 old lines
  assert.equal(d.durationMs, 12345);
  assert.equal(d.ended, true);
  assert.equal(d.testFailed, false);
  assert.deepEqual(d.errors, []);
  assert.equal(d.turnsToday, 2);
});

test("digest: a turn that started by itself counts only what happened since the turn before", () => {
  const file = writeTranscript("watcher.jsonl", [
    user("keep an eye on the deploy"),
    toolUse("Bash", { command: "git commit -m 'bookkeeping'" }),
    toolUse("Bash", { command: "git commit -m 'more bookkeeping'" }),
    said("Committed; now waiting."),
    turnEnd(1000),
    { type: "user", timestamp: now, message: { content: "<task-notification>timer fired</task-notification>" } },
    toolUse("Monitor", {}),
    said("Nothing new; waiting again."),
    turnEnd(1800_000),
  ]);
  const d = digest(file);
  assert.equal(d.prompt, "keep an eye on the deploy");
  assert.equal(d.continued, true);
  assert.equal(d.commits, 0);
  assert.deepEqual(d.tools, { Monitor: 1 });
  assert.equal(d.said, "Nothing new; waiting again.");
  assert.equal(d.durationMs, 1800_000);
  assert.equal(d.ended, true);
  // Mid-turn after such a wake: still only the current stretch, and not ended yet.
  const live = writeTranscript("watcher-live.jsonl", [
    user("keep an eye on the deploy"),
    toolUse("Bash", { command: "git commit -m 'bookkeeping'" }),
    turnEnd(1000),
    toolUse("Read", { file_path: "x" }),
  ]);
  const l = digest(live);
  assert.equal(l.continued, true);
  assert.equal(l.ended, false);
  assert.equal(l.commits, 0);
  assert.deepEqual(l.tools, { Read: 1 });
});

test("digest: a compaction summary is never the prompt, and starts the turn after it", () => {
  const summary = "This session is being continued from a previous conversation that ran out of context. The summary below covers it.";
  const file = writeTranscript("compacted.jsonl", [
    user("make the bubble show dots"),
    toolUse("Bash", { command: "git commit -m 'old work'" }),
    turnEnd(1000),
    user(summary, { isCompactSummary: true, isVisibleInTranscriptOnly: true }),
    toolUse("Read", { file_path: "x" }),
    said("Picked up where we left off."),
    turnEnd(2000),
  ]);
  const d = digest(file);
  assert.equal(d.prompt, "make the bubble show dots");
  assert.ok(!d.earlierPrompts.some((p) => p.startsWith("This session")));
  assert.equal(d.continued, true);
  assert.equal(d.commits, 0);
  assert.deepEqual(d.tools, { Read: 1 });
  // An older transcript without the flag, and only the summary in the tail: still not a prompt.
  const bare = writeTranscript("compacted-bare.jsonl", [user(summary), toolUse("Read", { file_path: "y" }), said("Resumed."), turnEnd(500)]);
  const b = digest(bare);
  assert.equal(b.prompt, null);
  assert.deepEqual(b.tools, { Read: 1 });
  assert.equal(b.said, "Resumed.");
});

test("digest: an unfinished turn is not ended and has no duration", () => {
  const file = writeTranscript("running.jsonl", [user("still going"), toolUse("Read", { file_path: "x" })]);
  const d = digest(file);
  assert.equal(d.prompt, "still going");
  assert.equal(d.ended, false);
  assert.equal(d.durationMs, null);
});

test("digest: tool errors are collected (max 2, trimmed) and failing tests are flagged", () => {
  const file = writeTranscript("failing.jsonl", [
    user("run the suite"),
    toolUse("Bash", { command: "npm test" }),
    toolResult("Tests: 2 failed, 10 passed", true),
    toolResult("boom", true),
    toolResult("third error", true),
    turnEnd(),
  ]);
  const d = digest(file);
  assert.equal(d.testFailed, true);
  assert.deepEqual(d.errors, ["Tests: 2 failed, 10 passed", "boom"]);
});

test("digest: tool results are not mistaken for prompts; sidechain and meta entries are ignored", () => {
  const file = writeTranscript("noise.jsonl", [
    user("the real prompt"),
    toolUse("Read", {}),
    toolResult("contents"),
    user("subagent chatter", { isSidechain: true }),
    user("meta note", { isMeta: true }),
    user("<command-name>/clear</command-name>"),
    turnEnd(),
  ]);
  const d = digest(file);
  assert.equal(d.prompt, "the real prompt");
  assert.deepEqual(d.earlierPrompts, []);
});

test("digest: text-block prompts are read, wrapper blocks are skipped", () => {
  const file = writeTranscript("blocks.jsonl", [
    { type: "user", timestamp: now, message: { content: [{ type: "text", text: "block prompt" }] } },
    { type: "user", timestamp: now, message: { content: [{ type: "text", text: "<local-command-stdout>x</local-command-stdout>" }] } },
  ]);
  assert.equal(digest(file).prompt, "block prompt");
});

test("digest: a file with no prompt yields an empty digest", () => {
  const file = writeTranscript("empty.jsonl", [said("hello?"), turnEnd()]);
  const d = digest(file);
  assert.equal(d.prompt, null);
  assert.equal(d.ended, false);
  assert.equal(d.said, "");
});

test("digest: malformed JSON lines are skipped instead of throwing", () => {
  const file = path.join(dir, "broken.jsonl");
  fs.writeFileSync(file, `{not json\n${JSON.stringify(user("survivor"))}\n{"half":\n`);
  assert.equal(digest(file).prompt, "survivor");
});

test("transcriptFor: picks the newest recent transcript in the project slug dir", () => {
  const cwd = "/Users/test/some.project";
  const proj = path.join(home, ".claude/projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(proj, { recursive: true });
  const older = path.join(proj, "old.jsonl");
  const newer = path.join(proj, "new.jsonl");
  fs.writeFileSync(older, "{}\n");
  fs.writeFileSync(newer, "{}\n");
  const t = new Date();
  fs.utimesSync(older, t, new Date(t.getTime() - 60_000));
  fs.utimesSync(newer, t, t);
  assert.equal(transcriptFor([cwd])?.path, newer);
  assert.equal(transcriptFor(["/nowhere/at/all"]), null);
});

test("transcriptForSession: finds the transcript by uuid, stripping the claude- prefix", () => {
  const cwd = "/Users/test/elsewhere";
  const proj = path.join(home, ".claude/projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
  fs.mkdirSync(proj, { recursive: true });
  const file = path.join(proj, "abc-123.jsonl");
  fs.writeFileSync(file, "{}\n");
  assert.equal(transcriptForSession("claude-abc-123", cwd), file);
  // Hook cwd is wrong: the search falls back to scanning every project dir.
  assert.equal(transcriptForSession("claude-abc-123", "/wrong/dir"), file);
  assert.equal(transcriptForSession("", cwd), null);
  assert.equal(transcriptForSession("claude-missing", cwd), null);
});
