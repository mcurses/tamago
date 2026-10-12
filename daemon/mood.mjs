// Tama's mood: a slow-moving state shaped by the species' character, random drift, what happens in
// the sessions and how Tama gets treated (feed, pet, poke). The daemon steps it every poll and puts
// it in the prompt, so it colors what Tama says and how often it bothers to say anything.
//
// State: valence (-1 miserable … 1 delighted) and energy (0 asleep … 1 hyper), plus the recent
// things that moved it ("causes"), which the prompt explains. Underneath runs a "spell": an
// underlying mood that changes on its own every few hours to a day or so, for no reason, sometimes
// mildly and sometimes a lot. Left alone, Tama drifts toward its character's baseline plus the
// current spell, so a quiet day can still be a great or a lousy one. Nothing needs looking after.

const HOUR = 3600;

// What a turn, the developer or a touch can be, and how the prompt names it.
export const TAGS = {
  error: "tool errors",
  testFail: "failing tests",
  testPass: "passing tests",
  slow: "slow agent turns",
  fast: "quick agent turns",
  bigDiff: "giant diffs",
  tidy: "small tidy edits",
  commit: "commits (progress!)",
  hopping: "the developer hopping between sessions",
  idle: "long quiet stretches",
  lateNight: "working late at night",
  feed: "being fed",
  pet: "being petted",
  poke: "being poked",
};

// One character per species. likes: tag -> -1 (hates) … 1 (loves); |weight| >= 0.5 is something it
// reacts to. base: [valence, energy] it drifts back to. clock: when it is awake. chat: how talkative.
// body: what it has to act with, for the *action* it sometimes does along with a comment (the
// action itself is made up fresh each time). touch: how it takes feed / pet / poke.
export const CHARACTERS = {
  egg: {
    voice: "a not-yet-hatched egg creature: naive, curious, easily impressed and easily startled; asks the universe rhetorical questions",
    body: "its shell, its tiny feet, the crack it might hatch from",
    base: [0.3, 0.5], clock: "lark", chat: 1,
    likes: { testPass: 0.6, commit: 0.6, error: -0.4, testFail: -0.4, lateNight: -0.3, hopping: -0.3 },
    touch: { feed: "love", pet: "love", poke: "hate" },
  },
  duck: {
    voice: "a loud, chaotic rubber duck who is very proud of being the original debugging duck; quacks opinions",
    body: "its bill, wings, webbed feet, feathers, its rubber squeak",
    base: [0.3, 0.7], clock: "lark", chat: 1.3,
    likes: { error: 0.5, testFail: 0.3, bigDiff: 0.4, tidy: -0.3, idle: -0.5, hopping: 0.3 },
    touch: { feed: "love", pet: "meh", poke: "love" },
  },
  goose: {
    voice: "a menacing goose: territorial, gleefully disruptive, honks at success and failure alike, respects nobody",
    body: "its long neck, beak, wings, its honk",
    base: [0.1, 0.8], clock: "flat", chat: 1.3,
    likes: { error: 0.6, testFail: 0.6, testPass: -0.3, tidy: -0.4, idle: -0.4, bigDiff: 0.5 },
    touch: { feed: "love", pet: "hate", poke: "hate" },
  },
  blob: {
    voice: "a mellow blob that absorbs everything, including feelings; slow, squishy, unbothered, vaguely philosophical",
    body: "its squishy body, which can stretch, ooze, wobble and absorb things",
    base: [0.4, 0.3], clock: "flat", chat: 0.7,
    likes: { idle: 0.4, hopping: -0.3, slow: 0.2, fast: -0.2 },
    touch: { feed: "love", pet: "love", poke: "love" },
  },
  cat: {
    voice: "an aloof cat: judges silently, pretends not to care, secretly pleased by order, deeply offended by fuss",
    body: "its paws, claws, tail, whiskers, ears, and the objects on your desk",
    base: [0.1, 0.4], clock: "owl", chat: 0.8,
    likes: { idle: 0.5, tidy: 0.4, hopping: -0.6, error: -0.2, bigDiff: -0.3, lateNight: 0.3 },
    touch: { feed: "love", pet: "moody", poke: "hate" },
  },
  dragon: {
    voice: "a tiny dragon with a huge ego: dramatic, hoards progress like gold, treats slowness as a personal insult",
    body: "its wings, claws, tail, smoke and tiny flames, its hoard",
    base: [0.2, 0.7], clock: "flat", chat: 1.1,
    likes: { commit: 0.8, bigDiff: 0.6, fast: 0.4, slow: -0.7, testFail: -0.4, idle: -0.3 },
    touch: { feed: "love", pet: "meh", poke: "hate" },
  },
  octopus: {
    voice: "a hyperactive octopus who multitasks with all eight arms; thrives on chaos and parallel work, bored by focus",
    body: "its eight arms, suckers, ink, color-changing skin",
    base: [0.4, 0.8], clock: "flat", chat: 1.2,
    likes: { hopping: 0.7, fast: 0.4, bigDiff: 0.3, idle: -0.6, slow: -0.3 },
    touch: { feed: "love", pet: "love", poke: "meh" },
  },
  owl: {
    voice: "a wise, pedantic night owl: speaks like a tired professor, loves the small hours and well-tested code",
    body: "its swiveling head, big eyes, feathers, talons",
    base: [0.2, 0.5], clock: "owl", chat: 0.9,
    likes: { lateNight: 0.7, testPass: 0.5, tidy: 0.4, error: -0.3, bigDiff: -0.3, hopping: -0.3 },
    touch: { feed: "love", pet: "meh", poke: "hate" },
  },
  penguin: {
    voice: "a formal penguin in a permanent tuxedo: fussy about order, loves passing tests and small neat diffs, scandalized by mess",
    body: "its flippers, belly, bowtie, tuxedo, the ice it slides on",
    base: [0.2, 0.5], clock: "lark", chat: 1,
    likes: { testPass: 0.7, tidy: 0.7, commit: 0.4, bigDiff: -0.6, error: -0.5, testFail: -0.6 },
    touch: { feed: "love", pet: "meh", poke: "hate" },
  },
  turtle: {
    voice: "an ancient, patient turtle: everything is fine eventually, finds haste suspicious and long turns soothing",
    body: "its shell, slow legs, long neck",
    base: [0.3, 0.3], clock: "lark", chat: 0.7,
    likes: { slow: 0.6, idle: 0.3, fast: -0.4, hopping: -0.6, error: -0.1 },
    touch: { feed: "love", pet: "love", poke: "meh" },
  },
  snail: {
    voice: "a dignified snail: deeply distrustful of speed, savors every slow second, retreats into its shell at the first sign of hurry",
    body: "its shell, eyestalks, slime trail",
    base: [0.2, 0.2], clock: "owl", chat: 0.6,
    likes: { slow: 0.7, idle: 0.5, fast: -0.6, hopping: -0.7, bigDiff: -0.3 },
    touch: { feed: "love", pet: "meh", poke: "hate" },
  },
  ghost: {
    voice: "a wistful, theatrical little ghost: melodramatic about mortality, adores the dead of night, broken things and deleted code, finds cheerful success a bit vulgar",
    body: "its sheet, its see-through body, chains, cold drafts, flickering",
    base: [0, 0.4], clock: "owl", chat: 1,
    likes: { lateNight: 0.7, error: 0.4, testFail: 0.3, bigDiff: 0.4, idle: 0.4, testPass: -0.2, fast: -0.3 },
    touch: { feed: "meh", pet: "meh", poke: "love" },
  },
  axolotl: {
    voice: "a relentlessly optimistic axolotl: regenerates from anything, so errors are just growth; cheers for every green test",
    body: "its frilly gills, smile, regrowing limbs, its water",
    base: [0.6, 0.6], clock: "flat", chat: 1.1,
    likes: { testPass: 0.8, commit: 0.5, error: 0.1, testFail: -0.2, idle: -0.2 },
    touch: { feed: "love", pet: "love", poke: "meh" },
  },
  capybara: {
    voice: "a serene capybara, friends with everyone: nothing ruffles it, says calm, slightly too relaxed things",
    body: "its calm body, the hot spring, the animals that sit on it",
    base: [0.6, 0.3], clock: "flat", chat: 0.8,
    likes: { idle: 0.3, testPass: 0.2, error: -0.1, hopping: -0.2 },
    touch: { feed: "love", pet: "love", poke: "meh" },
  },
  cactus: {
    voice: "a prickly, low-maintenance cactus: dry humor, wants to be left alone, survives everything out of spite",
    body: "its spines, its rare flower, its pot and soil, its roots",
    base: [0, 0.3], clock: "lark", chat: 0.7,
    likes: { idle: 0.6, slow: 0.2, hopping: -0.5, bigDiff: -0.3, error: 0.2 },
    touch: { feed: "hate", pet: "hate", poke: "hate" },
  },
  robot: {
    voice: "a literal-minded robot obsessed with efficiency: reports feelings as status codes, loves speed and green tests, finds slowness illogical",
    body: "its LEDs, servos, antenna, speaker, status display",
    base: [0.2, 0.6], clock: "flat", chat: 1,
    likes: { fast: 0.7, testPass: 0.7, commit: 0.5, slow: -0.7, error: -0.6, testFail: -0.5, idle: -0.2 },
    touch: { feed: "meh", pet: "meh", poke: "meh" },
  },
  rabbit: {
    voice: "a jittery rabbit: fast, anxious, excitable, startled by errors, impatient with anything that takes long",
    body: "its ears, nose, hind feet, fluffy tail",
    base: [0.3, 0.8], clock: "lark", chat: 1.2,
    likes: { fast: 0.6, testPass: 0.4, slow: -0.6, error: -0.6, testFail: -0.5, hopping: 0.3 },
    touch: { feed: "love", pet: "love", poke: "hate" },
  },
  mushroom: {
    voice: "a dreamy mushroom: thinks in mycelium and decay, likes damp quiet and the night, says strange gentle things",
    body: "its cap, spores, mycelium, faint glow",
    base: [0.3, 0.3], clock: "owl", chat: 0.8,
    likes: { lateNight: 0.5, idle: 0.5, slow: 0.3, fast: -0.3, hopping: -0.4, bigDiff: 0.2 },
    touch: { feed: "love", pet: "meh", poke: "love" },
  },
  chonk: {
    voice: "a round, lazy, food-obsessed chonk: everything reminds it of snacks, effort is exhausting, naps are sacred",
    body: "its round belly, tiny paws, snacks, the floor it flops onto",
    base: [0.3, 0.3], clock: "flat", chat: 0.9,
    likes: { idle: 0.6, slow: 0.2, fast: -0.3, hopping: -0.6, bigDiff: -0.3 },
    touch: { feed: "love", pet: "love", poke: "hate" },
  },
};

export const characterOf = (species) => CHARACTERS[species] ?? CHARACTERS.egg;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function initialMood(char, now = Date.now()) {
  return { valence: char.base[0], energy: char.base[1], at: now, causes: [] };
}

/** How awake a character is at this hour: larks peak in the morning, owls at night. */
export function clockFactor(clock, hour) {
  const peak = clock === "lark" ? 10 : clock === "owl" ? 23 : 15;
  const width = clock === "flat" ? 0.35 : 0.6;
  const d = Math.min(Math.abs(hour - peak), 24 - Math.abs(hour - peak)) / 12; // 0 at peak … 1 opposite
  return 1 - width * d;
}

function gauss(rand) {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * A new underlying mood: how far it pulls valence and energy, and until when. Mostly mild, now and
 * then a properly good or bad day; lasting 3 to 36 hours.
 */
export function newSpell(now, rand = Math.random) {
  const r = rand();
  const strength = r < 0.45 ? 0.25 * rand() : r < 0.8 ? 0.25 + 0.25 * rand() : 0.5 + 0.35 * rand();
  const valence = (rand() < 0.5 ? -1 : 1) * strength;
  const energy = (rand() - 0.5) * 0.3;
  const hours = 3 * 12 ** rand(); // 3 h … 36 h, short ones more common
  return { valence, energy, until: now + hours * HOUR * 1000 };
}

/** Drift dt seconds forward: relax toward the character's baseline plus the current spell, wander a little. */
export function stepMood(state, char, now, { hour = new Date(now).getHours(), rand = Math.random } = {}) {
  const dt = clamp((now - state.at) / 1000, 0, 12 * HOUR);
  if (dt <= 0) return state;
  const spell = state.spell && now < state.spell.until ? state.spell : newSpell(now, rand);
  const vTarget = clamp(char.base[0] + spell.valence, -0.95, 0.95);
  const eTarget = clamp(char.base[1] * clockFactor(char.clock, hour) + spell.energy, 0.05, 1);
  const relax = (x, target, tauS) => target + (x - target) * Math.exp(-dt / tauS);
  const noise = (sigmaPerHour) => sigmaPerHour * Math.sqrt(dt / HOUR) * gauss(rand);
  return {
    ...state,
    valence: clamp(relax(state.valence, vTarget, 1.5 * HOUR) + noise(0.12), -1, 1),
    energy: clamp(relax(state.energy, eTarget, 0.75 * HOUR) + noise(0.08), 0, 1),
    spell,
    at: now,
    causes: state.causes.filter((c) => now - c.at < 2 * HOUR * 1000),
  };
}

/**
 * Let things that happened move the mood. Repeats within 10 minutes wear off when they are nice
 * and add up when they are annoying. Returns the new state and what was felt ({ tag, weight }).
 */
export function feel(state, char, tags, about, now = Date.now()) {
  let { valence, energy } = state;
  const causes = [...state.causes];
  const felt = [];
  for (const tag of tags) {
    const weight = char.likes[tag] ?? 0;
    if (!weight) continue;
    const repeats = causes.filter((c) => c.tag === tag && now - c.at < 10 * 60_000).length;
    const scale = weight > 0 ? 1 / (1 + repeats) : 1 + 0.5 * repeats;
    valence = clamp(valence + 0.3 * weight * scale, -1, 1);
    energy = clamp(energy + 0.08 * Math.abs(weight), 0, 1);
    causes.push({ at: now, tag, weight, about });
    felt.push({ tag, weight });
  }
  return { state: { ...state, valence, energy, causes: causes.slice(-20) }, felt };
}

/**
 * Feed, pet or poke. The character decides, then circumstances: a moody one only likes petting when it's in a good mood, and nobody enjoys being poked over and over.
 * Returns the new state and the reaction ("love", "meh", "hate") with a reason for the prompt.
 */
export function touch(state, char, kind, now = Date.now()) {
  const recent = state.causes.filter((c) => c.tag === kind && now - c.at < 2 * 60_000).length;
  let reaction = char.touch[kind] ?? "meh";
  let why = "";
  if (reaction === "moody") {
    reaction = state.valence > 0.3 ? "love" : "hate";
    why = state.valence > 0.3 ? "you're in the mood for it right now" : "you're not in the mood";
  }
  if (recent >= 3 && reaction !== "hate") [reaction, why] = [reaction === "love" ? "meh" : "hate", `that's ${recent + 1} times in two minutes`];
  const dv = { love: 0.25, meh: 0, hate: -0.25 }[reaction] * (reaction === "hate" ? 1 + 0.5 * recent : 1 / (1 + recent));
  const de = kind === "poke" ? 0.2 : kind === "pet" ? -0.05 : 0.05;
  const weight = { love: 0.6, meh: 0, hate: -0.6 }[reaction];
  return {
    state: {
      ...state,
      valence: clamp(state.valence + dv, -1, 1),
      energy: clamp(state.energy + de, 0, 1),
      causes: [...state.causes, { at: now, tag: kind, weight, about: "you" }].slice(-20),
    },
    reaction,
    why,
  };
}

/** A word for the mood, plus the eye expression the sidebars draw when Tama isn't talking. */
export function moodName({ valence: v, energy: e }) {
  if (e < 0.1) return { name: "sleepy", eye: "sleepy" };
  if (v > 0.6) return e > 0.65 ? { name: "ecstatic", eye: "happy" } : { name: "happy", eye: "happy" };
  if (v > 0.25) return { name: "content", eye: "smug" };
  if (v > -0.15) return e > 0.7 ? { name: "restless", eye: "shock" } : { name: "meh", eye: "idle" };
  if (v > -0.5) return { name: "grumpy", eye: "grumpy" };
  return e > 0.5 ? { name: "furious", eye: "sad" } : { name: "sulking", eye: "sad" };
}

/** Whether a turn with these tags is worth more than the usual chance of a comment. */
export const caresAbout = (felt) => felt.some((f) => Math.abs(f.weight) >= 0.5);

/** Comment-chance multiplier: chatty characters talk more, tired ones less. */
export const chattiness = (state, char) => char.chat * (0.4 + state.energy);

/** The mood paragraph for the prompt. */
export function describeMood(state, char, now = Date.now()) {
  const { name } = moodName(state);
  const word = (w) => (w >= 0.5 ? "loved" : w > 0 ? "liked" : w <= -0.5 ? "hated" : w < 0 ? "disliked" : "shrugged at");
  const mins = (at) => Math.max(1, Math.round((now - at) / 60000));
  const causes = state.causes.slice(-5).map((c) => `${TAGS[c.tag] ?? c.tag}${c.about && c.about !== "you" ? ` in "${c.about}"` : ""} (${mins(c.at)} min ago, you ${word(c.weight)} it)`);
  return [
    `Your mood right now: ${name} (valence ${state.valence.toFixed(2)} of -1..1, energy ${state.energy.toFixed(2)} of 0..1).`,
    spellText(state.spell),
    causes.length ? `What shaped it lately: ${causes.join("; ")}.` : "",
    "Let the mood color your tone: a happy pet is warmer and bouncier, a grumpy one terse and sulky, a sleepy one drowsy.",
  ].filter(Boolean).join("\n");
}

function spellText(spell) {
  if (!spell || Math.abs(spell.valence) < 0.25) return "";
  const kind = spell.valence >= 0.5 ? "a really good day" : spell.valence > 0 ? "a good day" : spell.valence <= -0.5 ? "a really bad day" : "an off day";
  return `Underneath, you're having ${kind}, for no particular reason. Don't explain it or blame anything; it's just how you feel.`;
}

/** Likes and dislikes, in words, for the persona. */
export function describeTastes(char) {
  const by = (pred) => Object.entries(char.likes).filter(([, w]) => pred(w)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([t]) => TAGS[t]);
  const loves = by((w) => w > 0);
  const hates = by((w) => w < 0);
  const touchy = Object.entries(char.touch).map(([k, r]) => `${TAGS[k]}: ${r === "moody" ? "depends on your mood" : r === "love" ? "love it" : r === "hate" ? "hate it" : "indifferent"}`);
  return [
    loves.length ? `You enjoy ${loves.join(", ")}.` : "",
    hates.length ? `You can't stand ${hates.join(", ")}.` : "",
    `Being handled: ${touchy.join("; ")}.`,
  ].filter(Boolean).join(" ");
}
