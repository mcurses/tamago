// Tests for daemon/mood.mjs: node --test test/mood.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARACTERS, characterOf, initialMood, stepMood, feel, touch, moodName, clockFactor, describeMood, describeTastes } from "../daemon/mood.mjs";
import fs from "node:fs";

const H = 3600_000;
const still = { rand: () => 1 - 1e-12, hour: 15 }; // u≈1 → noise ≈ 0

test("every species has a character, and the egg is the fallback", () => {
  const species = Object.keys(JSON.parse(fs.readFileSync(new URL("../sidebar/species.json", import.meta.url))).species);
  for (const s of ["egg", ...species]) assert.ok(CHARACTERS[s], `missing character for ${s}`);
  assert.equal(characterOf("nonsense"), CHARACTERS.egg);
});

test("the mood drifts back to the character's baseline", () => {
  const char = CHARACTERS.capybara;
  const start = { ...initialMood(char, 0), valence: -1, energy: 1 };
  const later = stepMood(start, char, 6 * H, still);
  assert.ok(Math.abs(later.valence - char.base[0]) < 0.1, `valence ${later.valence}`);
  assert.ok(later.energy < 0.5, `energy ${later.energy}`);
});

test("pets get hungry, hunger makes them grumpier, ghosts never get hungry", () => {
  const chonk = CHARACTERS.chonk;
  const hungry = stepMood(initialMood(chonk, 0), chonk, 8 * H, still);
  assert.ok(hungry.fullness < 0.25);
  assert.ok(stepMood(hungry, chonk, 14 * H, still).valence < chonk.base[0] - 0.2);
  const ghost = CHARACTERS.ghost;
  assert.equal(stepMood(initialMood(ghost, 0), ghost, 12 * H, still).fullness, 0.7);
});

test("loved things wear off when repeated, hated things add up", () => {
  const robot = CHARACTERS.robot;
  let s = { ...initialMood(robot, 0), valence: 0 };
  const gains = [];
  for (let i = 0; i < 3; i++) {
    const before = s.valence;
    s = feel(s, robot, ["testPass"], "ws", i * 1000).state;
    gains.push(s.valence - before);
  }
  assert.ok(gains[0] > gains[1] && gains[1] > gains[2], `gains ${gains}`);
  s = { ...initialMood(robot, 0), valence: 0.9 };
  const losses = [];
  for (let i = 0; i < 3; i++) {
    const before = s.valence;
    s = feel(s, robot, ["slow"], "ws", i * 1000).state;
    losses.push(before - s.valence);
  }
  assert.ok(losses[0] < losses[1] && losses[1] < losses[2], `losses ${losses}`);
});

test("feel ignores tags the character doesn't care about and reports what it felt", () => {
  const { felt } = feel(initialMood(CHARACTERS.robot, 0), CHARACTERS.robot, ["lateNight", "fast"], "ws", 0);
  assert.deepEqual(felt, [{ tag: "fast", weight: 0.7 }]);
});

test("touch: species taste, moody cats, stuffed pets, spam", () => {
  const goose = CHARACTERS.goose;
  assert.equal(touch(initialMood(goose, 0), goose, "pet", 0).reaction, "hate");
  assert.equal(touch(initialMood(goose, 0), goose, "feed", 0).reaction, "love");

  const cat = CHARACTERS.cat;
  assert.equal(touch({ ...initialMood(cat, 0), valence: 0.6 }, cat, "pet", 0).reaction, "love");
  assert.equal(touch({ ...initialMood(cat, 0), valence: -0.2 }, cat, "pet", 0).reaction, "hate");

  const chonk = CHARACTERS.chonk;
  const stuffed = touch({ ...initialMood(chonk, 0), fullness: 0.95 }, chonk, "feed", 0);
  assert.equal(stuffed.reaction, "hate");
  assert.equal(stuffed.state.fullness, 0.95);
  assert.ok(touch({ ...initialMood(chonk, 0), fullness: 0.3 }, chonk, "feed", 0).state.fullness > 0.6);

  const blob = CHARACTERS.blob;
  let s = initialMood(blob, 0);
  const reactions = [];
  for (let i = 0; i < 5; i++) {
    const r = touch(s, blob, "poke", i * 1000);
    s = r.state;
    reactions.push(r.reaction);
  }
  assert.deepEqual(reactions, ["love", "love", "love", "meh", "meh"]);
});

test("mood names", () => {
  assert.equal(moodName({ valence: 0.9, energy: 0.9 }).name, "ecstatic");
  assert.equal(moodName({ valence: 0.9, energy: 0.1 }).name, "sleepy");
  assert.equal(moodName({ valence: -0.3, energy: 0.5 }).name, "grumpy");
  assert.equal(moodName({ valence: -0.8, energy: 0.8 }).name, "furious");
  assert.equal(moodName({ valence: 0, energy: 0.4 }).name, "meh");
});

test("larks are awake in the morning, owls at night", () => {
  assert.ok(clockFactor("lark", 9) > clockFactor("lark", 23));
  assert.ok(clockFactor("owl", 23) > clockFactor("owl", 9));
  assert.ok(clockFactor("flat", 3) > 0.6);
});

test("prompt text names the mood, its causes and the tastes", () => {
  const owl = CHARACTERS.owl;
  const s = feel(initialMood(owl, 0), owl, ["testPass"], "rev1", 0).state;
  const text = describeMood(s, owl, 5 * 60_000);
  assert.match(text, /Your mood right now: \w+/);
  assert.match(text, /passing tests in "rev1" \(5 min ago, you loved it\)/);
  assert.match(describeTastes(owl), /You enjoy working late at night/);
  assert.match(describeTastes(CHARACTERS.cat), /being petted: depends on your mood/);
});
