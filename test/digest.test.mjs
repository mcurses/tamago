// Tests for what daemon/transcript.mjs's digest shows Tama of the work itself:
// node --test test/digest.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { digest } from "../daemon/transcript.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tamago-digest-"));
const at = (min) => new Date(Date.UTC(2026, 9, 20, 12, min)).toISOString();
const user = (text, t) => ({ type: "user", timestamp: at(t), message: { content: text } });
const use = (name, input, t) => ({ type: "assistant", timestamp: at(t), message: { content: [{ type: "tool_use", name, input }] } });
const result = (text, t) => ({ type: "user", timestamp: at(t), message: { content: [{ type: "tool_result", content: text }] } });
const end = (t) => ({ type: "system", subtype: "turn_duration", timestamp: at(t), durationMs: 1000 });

function write(name, entries) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
}

test("files, the last edit, commands and failing test lines", () => {
  const d = digest(write("work.jsonl", [
    user("fix the parser", 0),
    use("Edit", { file_path: "/x/src/parser.js", old_string: "return a", new_string: "return a ?? b" }, 1),
    use("Write", { file_path: "/x/.env", content: "TOKEN=hunter2" }, 2),
    use("Bash", { command: "npm test\necho done" }, 3),
    result("not ok 3 - parses empty input\n# fail 1\nTests: 1 failed", 4),
    end(5),
  ]));
  assert.deepEqual(d.files, ["src/parser.js", "x/.env"]);
  assert.equal(d.excerpt, null); // the last edit was the .env file: never shown
  assert.deepEqual(d.commands, ["npm test"]);
  assert.ok(d.failures.some((l) => l.includes("parses empty input")));
});

test("the last edit becomes a small diff", () => {
  const d = digest(write("diff.jsonl", [
    user("go", 0),
    use("Edit", { file_path: "/x/a.js", old_string: "let n = 1", new_string: "let n = 2\nlet m = 3" }, 1),
    end(2),
  ]));
  assert.equal(d.excerpt, "- let n = 1\n+ let n = 2\n+ let m = 3");
});

test("until replays the transcript as it was then", () => {
  const file = write("replay.jsonl", [user("first", 0), end(1), user("second", 10), end(11)]);
  assert.equal(digest(file, { until: Date.parse(at(5)) }).prompt, "first");
  assert.equal(digest(file).prompt, "second");
});

test("a long turn full of logged API requests still has its prompt", () => {
  const blob = { type: "api-request", timestamp: at(2), body: "x".repeat(400 * 1024) };
  const d = digest(write("long.jsonl", [
    user("build the depot", 0),
    ...Array.from({ length: 6 }, () => blob), // ~2.4 MB, far past the first 768 KB tail
    use("Bash", { command: "factorio --benchmark" }, 3),
    end(4),
  ]));
  assert.equal(d.prompt, "build the depot");
  assert.deepEqual(d.commands, ["factorio --benchmark"]);
});

test("turn ends are counted only in bytes written since the last look", async () => {
  const { turnEndsSince } = await import("../daemon/transcript.mjs");
  const file = write("ends.jsonl", [user("a", 0), end(1)]);
  const first = turnEndsSince(file, 0);
  assert.equal(first.ends, 1);
  fs.appendFileSync(file, [user("b", 2), use("Bash", { command: "ls" }, 3)].map((e) => JSON.stringify(e)).join("\n") + "\n");
  const mid = turnEndsSince(file, first.size);
  assert.equal(mid.ends, 0); // still running
  fs.appendFileSync(file, JSON.stringify(end(4)) + "\n");
  assert.equal(turnEndsSince(file, mid.size).ends, 1);
});

test("endedOnError: only when the turn's last tool call failed", () => {
  const failed = (text, t) => ({ type: "user", timestamp: at(t), message: { content: [{ type: "tool_result", is_error: true, content: text }] } });
  const recovered = digest(write("recovered.jsonl", [
    user("build it", 0), use("Bash", { command: "make" }, 1), failed("make: *** missing", 2),
    use("Bash", { command: "make all" }, 3), result("ok", 4), end(5),
  ]));
  assert.equal(recovered.errors.length, 1);
  assert.equal(recovered.endedOnError, false);
  const stuck = digest(write("stuck.jsonl", [user("build it", 0), use("Bash", { command: "make" }, 1), failed("make: *** missing", 2), end(3)]));
  assert.equal(stuck.endedOnError, true);
});

test("test results count only from a command that runs tests", () => {
  const d = (command, out) => digest(write(`t-${Math.random()}.jsonl`, [user("check", 0), use("Bash", { command }, 1), result(out, 2), end(3)]));
  const report = "FAIL  AC9/l2 both proof passes exited 0\n3 failed";
  assert.equal(d("cat proofs/run.log", report).testFailed, false);
  assert.equal(d("grep -r FAIL logs/", report).testFailed, false);
  for (const cmd of ["npm test", "node --test test/*.test.mjs", "pytest -q", "cargo test", "npx vitest run", "python -m pytest", "go test ./...", "make check"]) {
    assert.equal(d(cmd, "Tests: 2 failed, 5 passed").testFailed, true, cmd);
  }
  assert.equal(d("node --test test/*.test.mjs", "# pass 41\n# fail 0").testPassed, true);
});
