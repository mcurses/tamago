// Tests for daemon/json.mjs: node --test test/json.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { firstJson } from "../daemon/json.mjs";

test("the first object is read, whatever comes around it", () => {
  assert.deepEqual(firstJson('{"why":"a } in a string, and \\"quotes\\"","n":{"x":1}}'), { why: 'a } in a string, and "quotes"', n: { x: 1 } });
  assert.deepEqual(firstJson('Here you go:\n{"a":1}\n\nAnd a note {with braces}.'), { a: 1 });
  assert.deepEqual(firstJson('{"a":1}\n{"b":2}'), { a: 1 });
  assert.throws(() => firstJson("no object"));
  assert.throws(() => firstJson('{"a":'));
});

test("a broken first object followed by a corrected one: the corrected one counts", () => {
  const reply = '{"mood":"smug","text":"first try","thought":"x","}\n\nWait, I need to make sure that\'s valid JSON.\n\n{"mood":"smug","text":"second try","thought":"x"}\n';
  assert.equal(firstJson(reply).text, "second try");
  assert.throws(() => firstJson('{"text":"never closes'), /unfinished/);
});
