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
