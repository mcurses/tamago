// Tests for daemon/notebook.mjs: node --test test/notebook.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyNotebook, jot, pageFor, notesAbout, describePage, reflected, listPages, SELF, DEVELOPER } from "../daemon/notebook.mjs";

const DAY = 24 * 3600_000;
const now = Date.parse("2026-11-06T12:00:00Z");

test("a jotted thought is kept, trimmed, and empty ones are not", () => {
  let nb = jot(emptyNotebook(), { at: now, about: "vinea", text: "  I think vinea is   a board Max reads on his phone. " });
  assert.equal(nb.notes.length, 1);
  assert.equal(nb.notes[0].text, "I think vinea is a board Max reads on his phone.");
  nb = jot(nb, { at: now, about: "vinea", text: "   " });
  assert.equal(nb.notes.length, 1);
});

test("pages are found by title, case-insensitively, or by an alias", () => {
  const nb = { ...emptyNotebook(), pages: { Axos: { text: "a hub", since: now - 10 * DAY, at: now - DAY } } };
  assert.equal(pageFor(nb, "axos").title, "Axos");
  assert.equal(pageFor(nb, "AXOS hub", ["axos"]).title, "Axos");
  assert.equal(pageFor(nb, "vinea"), null);
});

test("describePage names the page's age and the latest thoughts about it", () => {
  let nb = { ...emptyNotebook(), pages: { vinea: { text: "A board for Max's phone, I think.", since: now - 9 * DAY, at: now - DAY } } };
  for (let i = 0; i < 5; i++) nb = jot(nb, { at: now - (5 - i) * 3600_000, about: "vinea", text: `thought ${i}` });
  nb = jot(nb, { at: now, about: "meum", text: "not about vinea" });
  const text = describePage(nb, "vinea", [], now);
  assert.match(text, /first written 9 days ago, last changed yesterday/);
  assert.match(text, /A board for Max's phone/);
  assert.match(text, /thought 2[\s\S]*thought 3[\s\S]*thought 4/);
  assert.doesNotMatch(text, /thought 1|not about vinea/);
  assert.equal(notesAbout(nb, "vinea").length, 3);
  assert.equal(describePage(nb, "nothing", [], now), "");
});

test("a reflection rewrites the pages, keeping since and an unchanged at; the notes are consumed", () => {
  let nb = { reflectedAt: 0, pages: { vinea: { text: "old", since: now - 9 * DAY, at: now - 2 * DAY }, same: { text: "same", since: now - 3 * DAY, at: now - 3 * DAY } }, notes: [{ at: now - 3600_000, about: "vinea", text: "x" }] };
  nb = reflected(nb, { Vinea: "new text", same: "same", [SELF]: "I'm an egg that watches.", [DEVELOPER]: "Max, who builds many things at once." }, now);
  assert.equal(nb.reflectedAt, now);
  assert.equal(nb.notes.length, 0);
  assert.deepEqual(nb.pages.vinea, { text: "new text", since: now - 9 * DAY, at: now });
  assert.deepEqual(nb.pages.same, { text: "same", since: now - 3 * DAY, at: now - 3 * DAY });
  assert.equal(nb.pages[SELF].since, now);
  assert.equal(Object.keys(nb.pages).length, 4);
  assert.deepEqual(listPages(nb, now).map((p) => p.title).slice(0, 2), [SELF, DEVELOPER]);
});

test("a reflection that produced nothing usable leaves the pages alone", () => {
  const nb = { reflectedAt: 0, pages: { vinea: { text: "old", since: 1, at: 2 } }, notes: [] };
  assert.deepEqual(reflected(nb, null, now).pages, nb.pages);
  assert.deepEqual(reflected(nb, { vinea: "" }, now).pages, nb.pages);
  assert.equal(reflected(nb, null, now).reflectedAt, now);
});

test("too many pages: the longest-unchanged project pages go, me and the developer stay", () => {
  const out = { [SELF]: "me", [DEVELOPER]: "dev" };
  for (let i = 0; i < 30; i++) out[`p${i}`] = `page ${i}`;
  const nb = reflected(emptyNotebook(), out, now);
  assert.equal(Object.keys(nb.pages).length, 24);
  assert.ok(nb.pages[SELF] && nb.pages[DEVELOPER]);
});

test("a page written as an object or a list still becomes text", () => {
  const nb = reflected(emptyNotebook(), { me: { text: "an egg" }, vinea: ["a board", "for the phone"], meum: { what: "a terminal", guess: "for Max" } }, now);
  assert.equal(nb.pages.me.text, "an egg");
  assert.equal(nb.pages.vinea.text, "a board for the phone");
  assert.equal(nb.pages.meum.text, "a terminal for Max");
});
