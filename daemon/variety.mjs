// Keeps Tama's remarks from settling into one shape. Over two weeks the egg's lines collapsed into
// "a count, then a twist back onto its own shell, then !" without ever repeating a phrase, so the
// repeat check (repeats.mjs) never fired. Three things help, after how game dialogue systems and
// humor-generation papers do it (docs/research/2026-11-06-keeping-remarks-fresh.md):
//
// - An angle per remark, picked here and weighted against what was used lately, so the model is
//   handed a way in ("deadpan, aimed at the agent") instead of choosing its favorite every time.
//   The model may drop it when the moment holds something better.
// - Shape budgets: a few cheap features of a line (opens with a count, turns into a joke about its
//   own body, ends on "!", asks a question) are counted over the last lines. Over budget, the next
//   line is asked to do otherwise. A budget, not a ban: the egg jokes are its catchphrase, and a
//   catchphrase works at one line in eight, not every other line.
// - The diary as subjects: what was already remarked on today, as subjects, rather than the lines
//   themselves, which the model would copy (see diarySubjects in tamago.mjs).

export const ANGLES = [
  "understatement: play the big thing small",
  "mock-formal: a tiny official report, verdict or minutes",
  "backhanded compliment: praise with the sting in the tail",
  "deadpan: what the agent claimed, next to what actually happened, no comment",
  "a confident guess about what this is really for, from what you can see",
  "wondering aloud about something you don't understand yet",
  "connecting this to another day: where it started, what changed since",
  "a pattern in how the developer works, caught in the act",
  "rule of three: two straight, the third turns",
  "taking the credit, or false modesty",
  "plain delight, no joke",
  "an analogy from your own species' world, wrong in a telling way",
  "a callback to something from your notebook or memories",
];

export const TARGETS = [
  ["the developer", 1],
  ["the agent", 1],
  ["the code", 1],
  ["the plan", 0.7],
  ["another session", 0.4],
  ["yourself", 0.4],
];

const weighted = (items, rand) => {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rand() * total;
  for (const [item, w] of items) if ((r -= w) <= 0) return item;
  return items.at(-1)[0];
};

/** An angle and a target, weighted away from those used in `recent` ([{ angle, target }]). */
export function pickAngle(recent = [], rand = Math.random) {
  const used = (key, v) => recent.filter((r) => r?.[key] === v).length;
  const angle = weighted(ANGLES.map((a) => [a, 1 / (1 + used("angle", a)) ** 2]), rand);
  const target = weighted(TARGETS.map(([t, w]) => [t, w / (1 + used("target", t)) ** 2]), rand);
  return { angle, target };
}

export const describeAngle = ({ angle, target }) =>
  `A way in for this one: ${angle}; aimed at ${target}. If the moment holds something better (a thread of yours paying off, a guess confirmed or broken, something you've never seen), that wins.`;

// ---------- shapes ----------

const NUMBER = /^\W*(\d|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|both|all)\b/i;
const STOP = new Set("its tiny might from with that the own long big small little and all which when whole every".split(" "));

/** Words that mean the pet's own body: its species, its body parts, and for the egg its egghood. */
export function selfWords(species, body = "") {
  const words = new Set([species, species + "s"]);
  for (const w of String(body).toLowerCase().match(/[a-z]+/g) ?? []) if (w.length >= 4 && !STOP.has(w)) words.add(w);
  if (species === "egg") for (const w of ["shell", "hatch", "yolk", "crack", "nest", "chick", "carton", "omelet", "scrambled"]) words.add(w);
  return [...words];
}

/** The features of a line: { number, self, bang, question }, each true or false. */
export function shapeOf(text, self) {
  const t = String(text).trim();
  const selfRe = self.length ? new RegExp(`\\b(${self.map((w) => w.replace(/[^a-z]/gi, "")).filter(Boolean).join("|")})\\w*`, "i") : /$^/;
  return { number: NUMBER.test(t), self: selfRe.test(t), bang: /!["')\]]*$/.test(t), question: /\?["')\]]*$/.test(t) };
}

const BUDGET = 0.2; // share of recent lines a feature may take before the next line is steered away
const ENOUGH = 8; // fewer recent lines than this: no budgets yet

/** The features over budget in `shapes` (recent lines, oldest first), e.g. ["self", "bang"]. */
export function overused(shapes, budget = BUDGET) {
  if (shapes.length < ENOUGH) return [];
  return ["self", "bang", "number", "question"].filter((f) => shapes.filter((s) => s[f]).length / shapes.length > budget);
}

const STEER = {
  self: ["Lately a lot of your lines turned into a joke about your own body; this one stays on the work.", "turned into a joke about your own body"],
  bang: ["Lately most of your lines ended on an exclamation mark; this one ends on a full stop.", "ended on an exclamation mark"],
  number: ["Lately many of your lines opened with a count; this one opens another way.", "opened with a count"],
  question: ["Lately many of your lines ended on a question; this one doesn't ask.", "ended on a question"],
};

/** The instruction for the next line, or "" when nothing is over budget. */
export const describeOverused = (over) => over.map((f) => STEER[f][0]).join(" ");

/** The problem with a line that still has an over-budget feature, or "" when it's fine. */
export function shapeProblem(text, self, over) {
  const s = shapeOf(text, self);
  const hit = over.filter((f) => s[f]);
  return hit.length ? `That one ${hit.map((f) => STEER[f][1]).join(" and ")} again: "${text}". Keep the point, change the shape.` : "";
}
