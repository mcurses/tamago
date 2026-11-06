// Tests for daemon/variety.mjs: node --test test/variety.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { ANGLES, pickAngle, selfWords, shapeOf, overused, describeOverused, shapeProblem } from "../daemon/variety.mjs";

const egg = selfWords("egg", "its shell, its tiny feet, the crack it might hatch from");

test("self words: the species, its body parts, no filler", () => {
  assert.ok(egg.includes("shell") && egg.includes("feet") && egg.includes("hatch") && egg.includes("egg"));
  assert.ok(!egg.includes("tiny") && !egg.includes("might") && !egg.includes("from"));
  const duck = selfWords("duck", "its bill, wings, webbed feet, feathers, its rubber squeak");
  assert.ok(duck.includes("feathers") && duck.includes("squeak") && duck.includes("ducks"));
});

test("shapeOf sees the egg's template", () => {
  const s = shapeOf("Seventeen commits, and stray replies now spoil after 30 days. My fear of mail forever got a best-before date, like any good egg!", egg);
  assert.deepEqual(s, { number: true, self: true, bang: true, question: false });
  const plain = shapeOf("The classifier refused persistence, so the agent persisted a memory about being refused.", egg);
  assert.deepEqual(plain, { number: false, self: false, bang: false, question: false });
  assert.ok(shapeOf("Hatched code, unhatched answer.", egg).self);
  assert.ok(shapeOf("Can rounding grade my hatching too?", egg).question);
  assert.ok(shapeOf("4 of 5, and the hook quit.", egg).number);
});

test("budgets only kick in with enough lines, and only for the features over budget", () => {
  const line = (self, bang) => ({ number: false, self, bang, question: false });
  assert.deepEqual(overused([line(true, true), line(true, true)]), []);
  const shapes = [...Array(10)].map((_, i) => line(i < 5, i < 1));
  assert.deepEqual(overused(shapes), ["self"]);
  assert.match(describeOverused(["self", "bang"]), /own body.*exclamation mark/);
  assert.equal(describeOverused([]), "");
});

test("shapeProblem names what the new line still does", () => {
  assert.match(shapeProblem("Still an egg, me!", egg, ["self", "bang"]), /own body and ended on an exclamation mark/);
  assert.equal(shapeProblem("A plain line.", egg, ["self", "bang"]), "");
  assert.equal(shapeProblem("Still an egg.", egg, ["bang"]), "");
});

test("pickAngle leans away from what was used lately", () => {
  const recent = [...Array(6)].map(() => ({ angle: ANGLES[0], target: "yourself" }));
  let first = 0;
  let self = 0;
  for (let i = 0; i < 400; i++) {
    const p = pickAngle(recent);
    if (p.angle === ANGLES[0]) first++;
    if (p.target === "yourself") self++;
  }
  assert.ok(first < 15, `angle 0 picked ${first} of 400`);
  assert.ok(self < 15, `yourself picked ${self} of 400`);
  const fresh = pickAngle([], () => 0);
  assert.equal(fresh.angle, ANGLES[0]);
});
