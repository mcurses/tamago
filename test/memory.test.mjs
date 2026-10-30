// Tests for Tama's long-term memory (daemon/memory.mjs): node --test test/memory.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { cuesOf, similarity, strengthNow, forget, encode, recall, strongest, describeMemories, toReplay, consolidated } from "../daemon/memory.mjs";

const H = 3600_000;
const D = 24 * H;
const moment = (gist, extra = {}) => ({ gist, about: "rev1", cues: cuesOf(gist), ...extra });

test("cues are the telling words", () => {
  assert.deepEqual(cuesOf("Fix the parser for empty input", "parser.js"), ["parser", "empty", "input", "parser.js"]);
  assert.equal(similarity(["a1b2", "parser"], ["parser", "c3d4"]), 1 / 3);
  assert.equal(similarity([], ["x"]), 0);
});

test("novel and emotional moments are remembered more strongly", () => {
  let mem = encode([], moment("commits in rev1 while fixing the queue"), 0);
  const routine = encode(mem, moment("tests passed in roadmap seed cards", { emotion: 0 }), H).at(-1);
  const moving = encode(mem, moment("tests failed in billing invoices export", { emotion: 0.8, feeling: -0.6 }), H).at(-1);
  const attended = encode(mem, moment("giant diffs in landing page hero", { attended: true }), H).at(-1);
  assert.ok(moving.strength > routine.strength, `${moving.strength} > ${routine.strength}`);
  assert.ok(attended.strength > routine.strength);
  // Familiar beats novel: the same words again are less novel than new ones.
  const familiar = encode(mem, moment("commits in rev1 on the release notes"), H).at(-1);
  const novel = encode(mem, moment("deploy pipeline broke on staging servers"), H).at(-1);
  assert.ok(novel.strength > familiar.strength);
});

test("the same thing again strengthens the memory instead of adding one", () => {
  let mem = encode([], moment("tool errors in rev1 fixing queue lanes"), 0);
  const before = mem[0].strength;
  mem = encode(mem, moment("tool errors in rev1 fixing queue lanes again"), 10 * 60_000);
  assert.equal(mem.length, 1);
  assert.ok(mem[0].strength > before);
  assert.match(mem[0].gist, /again/);
});

test("memories fade and are forgotten; consolidated ones last much longer", () => {
  const m = { at: 0, gist: "x", cues: ["x"], feeling: 0, strength: 0.5, seen: 0, recalls: 0, slept: false };
  assert.ok(strengthNow(m, D) < 0.2);
  assert.equal(forget([m], 3 * D).length, 0);
  const slept = { ...m, slept: true };
  assert.ok(strengthNow(slept, 7 * D) > 0.3);
  assert.equal(forget([slept], 7 * D).length, 1);
});

test("a cue brings memories back, strengthens them and colors them with the mood now", () => {
  let mem = encode([], moment("failing tests in rev1 queue lanes", { feeling: 0.5, emotion: 0.5 }), 0);
  mem = encode(mem, moment("commits in roadmap seed cards"), 0);
  const { memories, recalled } = recall(mem, cuesOf("rev1 queue lanes again"), 2 * H, { valence: -1 });
  assert.equal(recalled.length, 1);
  assert.match(recalled[0].gist, /queue/);
  assert.equal(recalled[0].recalls, 1);
  assert.ok(recalled[0].feeling < 0.5); // recalled while grumpy, it feels a little worse now
  assert.ok(strengthNow(recalled[0], 2 * H) > strengthNow(mem[0], 2 * H));
  assert.equal(memories.length, 2);
  // Moments from the last hour are still in the diary, not recalled from memory.
  assert.equal(recall(mem, cuesOf("rev1 queue lanes"), 30 * 60_000).recalled.length, 0);
  assert.equal(strongest(mem, 2 * H).recalled.length, 2);
});

test("the prompt says when, what and how it felt", () => {
  const text = describeMemories([{ at: 0, gist: "the queue lanes finally went green", feeling: 0.6 }], 2 * D);
  assert.match(text, /2 days ago: the queue lanes finally went green \(it felt great\)/);
  assert.equal(describeMemories([], 0), "");
});

test("sleep drops weak moments and keeps the day as a few long-term gists", () => {
  let mem = [];
  mem = encode(mem, moment("tests failed in billing invoices export", { emotion: 1, feeling: -0.8 }), 0);
  mem = encode(mem, moment("the billing fix landed and the suite went green", { emotion: 1, feeling: 0.8, attended: true }), H);
  mem = encode(mem, { gist: "a routine turn", about: "x", cues: ["routine"], emotion: 0 }, 2 * H);
  mem[2] = { ...mem[2], strength: 0.1 };
  const { replay, dropped } = toReplay(mem, 3 * H);
  assert.equal(dropped, 1);
  assert.equal(replay.length, 2);
  const after = consolidated(mem, replay, [{ gist: "Billing's export broke and then got fixed; I cheered.", about: "billing", feeling: 0.5, from: [0, 1] }], 3 * H);
  assert.equal(after.length, 1);
  assert.equal(after[0].slept, true);
  assert.equal(after[0].at, 0);
  assert.ok(after[0].cues.includes("billing"));
  // Without usable gists (the model failed), the replayed moments are kept as they are.
  const fallback = consolidated(mem, replay, null, 3 * H);
  assert.equal(fallback.length, 2);
  assert.ok(fallback.every((m) => m.slept));
});
