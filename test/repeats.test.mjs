// Tests for daemon/repeats.mjs: node --test test/repeats.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { repeats } from "../daemon/repeats.mjs";

const diary = [
  "Handoff done and the :5191 preview is gone, so I'm just here with the Jira lamp humming.",
  "Handoff again, and the rev1 preview is gone, so the Jira lamp hums on. Fourteen oh six, still sulking.",
];

test("the same gag in new words around it counts as a repeat", () => {
  assert.ok(repeats("Fifteen hundred and the rev1 preview is still gone, the Jira lamp hums on.", diary));
  assert.ok(repeats("Fourteen thirty-one and the rev1 preview is still gone, the Jira lamp hums on.", diary));
});

test("a new remark passes", () => {
  assert.equal(repeats("Eleven Bash calls and a green test run. I'll allow it.", diary), null);
  assert.equal(repeats("Quiet tabs. I count my arms, all eight present.", diary), null);
  assert.equal(repeats("Anything at all.", []), null);
});
