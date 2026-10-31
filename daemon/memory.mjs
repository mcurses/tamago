// Tama's long-term memory, loosely after how brains do it (Kurzgesagt, "How Are Memories Stored
// Inside Your Brain?"):
//
// - Encoding: most moments leave a weak trace. Novel ones (unlike anything remembered) and
//   emotional ones (the mood moved) leave a strong one, and so does the moment that won Tama's
//   attention, the one it remarked on. The same thing again soon after strengthens the existing
//   memory instead of making a new one (repetition).
// - Forgetting: every memory fades unless it's brought back; most moments of a day are gone in a
//   day or two.
// - Sleep: when the developer is away for a long stretch, Tama sleeps and replays the day. The weak
//   moments go, the rest are merged into a few gists that last weeks (consolidation; the daemon
//   asks the model to do the merging, consolidated() takes its answer).
// - Recall: a cue (the workspace, what happened, words of the prompt) brings back the memories
//   that share it. Each recall strengthens a memory and colors it with the mood Tama is in now
//   (reconsolidation), so memories drift: vivid isn't the same as accurate.
//
// A memory: { at, gist, about, cues: [word], feeling: -1..1, strength: 0..1 at `seen`, seen,
// recalls, slept, liked? }. Pure functions; the daemon keeps them in memories.json.

const DAY = 24 * 3600_000;
const FADE_DAYS = 1; // a moment's strength halves in about 0.7 days
const SLEPT_FADE_DAYS = 14; // a consolidated memory's in about 10
const FORGOTTEN = 0.05;
const KEEP = 150;
const MERGE_SIMILAR = 0.5; // cue overlap at which a fresh moment counts as the same thing again
const SLEEP_KEEPS = 0.3; // unconsolidated moments weaker than this don't survive the night

const STOP = new Set("this that with from have what when where which there their then than into your about just like some will would could should been were they them these those also only make made does done after before while again more most other over such very here want need back please okay".split(" "));

/** Words to recognize a moment by: lowercase, 4+ letters, no common filler, at most 16. */
export function cuesOf(...texts) {
  const words = (texts.join(" ").toLowerCase().match(/[\p{L}\d][\p{L}\d_.-]*/gu) ?? []).map((w) => w.replace(/[.-]+$/, ""));
  return [...new Set(words.filter((w) => w.length >= 4 && !STOP.has(w)))].slice(0, 16);
}

/** Cue overlap, 0 … 1 (Jaccard). */
export function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  const shared = a.filter((w) => B.has(w)).length;
  return shared / (a.length + b.length - shared);
}

/** How strong a memory is now, after fading since it was last seen. */
export function strengthNow(m, now) {
  const tau = (m.slept ? SLEPT_FADE_DAYS : FADE_DAYS) * DAY;
  return m.strength * Math.exp(-Math.max(0, now - m.seen) / tau);
}

/** Drops what has faded away, and the weakest beyond KEEP. */
export function forget(memories, now) {
  return memories
    .filter((m) => strengthNow(m, now) >= FORGOTTEN)
    .sort((a, b) => strengthNow(b, now) - strengthNow(a, now))
    .slice(0, KEEP)
    .sort((a, b) => a.at - b.at);
}

/**
 * A moment Tama lived through. `emotion` (0 … 1) is how much it moved the mood, `feeling` (-1 … 1)
 * which way, `attended` whether Tama remarked on it. Returns the new memory list.
 */
export function encode(memories, { gist, about = "", cues, feeling = 0, emotion = 0, attended = false }, now) {
  const fresh = forget(memories, now);
  const same = fresh.filter((m) => !m.slept && now - m.at < DAY).map((m) => [m, similarity(cues, m.cues)]).sort((a, b) => b[1] - a[1])[0];
  if (same && same[1] >= MERGE_SIMILAR) {
    // The same thing again: the memory gets stronger, and the newest version of it wins.
    const [m] = same;
    const s = strengthNow(m, now);
    const merged = { ...m, gist, strength: round2(Math.min(1, s + 0.15 * (1 - s) + 0.2 * emotion + (attended ? 0.2 : 0))), seen: now, feeling: (m.feeling + feeling) / 2 };
    return fresh.map((x) => (x === m ? merged : x));
  }
  const novelty = 1 - Math.max(0, ...fresh.map((m) => similarity(cues, m.cues)));
  const strength = Math.min(1, 0.1 + 0.4 * Math.min(1, emotion) + 0.25 * novelty + (attended ? 0.2 : 0));
  return [...fresh, { at: now, gist, about, cues, feeling: round2(feeling), strength: round2(strength), seen: now, recalls: 0, slept: false }];
}

/**
 * A moment the developer singled out (a +1 on a remark): kept as told, as strong as memories get,
 * and never merged away in sleep, so it lasts weeks with all its context.
 */
export function cherish(memories, { at, gist, about = "", cues, feeling = 0.8 }, now) {
  return forget([...memories, { at, gist, about, cues, feeling: round2(feeling), strength: 1, seen: now, recalls: 0, slept: true, liked: true }], now);
}

/**
 * What a cue brings back: up to `n` memories that share enough of it, older than an hour (newer
 * ones are still in the diary). Recalling strengthens them and pulls their feeling toward `valence`,
 * the mood now. Returns { memories, recalled }.
 */
export function recall(memories, cues, now, { n = 2, valence = 0, minAgeMs = 3600_000 } = {}) {
  const scored = memories
    .filter((m) => now - m.at >= minAgeMs)
    .map((m) => ({ m, score: similarity(cues, m.cues) * strengthNow(m, now) }))
    .filter((x) => x.score > 0.02)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
  return reconsolidate(memories, scored.map((x) => x.m), now, valence);
}

/** The strongest memories regardless of cue, for when the developer asks what's on Tama's mind. */
export function strongest(memories, now, { n = 3, valence = 0, minAgeMs = 3600_000 } = {}) {
  const picked = memories.filter((m) => now - m.at >= minAgeMs).sort((a, b) => strengthNow(b, now) - strengthNow(a, now)).slice(0, n);
  return reconsolidate(memories, picked, now, valence);
}

function reconsolidate(memories, picked, now, valence) {
  const updated = new Map(picked.map((m) => {
    const s = strengthNow(m, now);
    return [m, { ...m, strength: round2(Math.min(1, s + 0.2 * (1 - s))), seen: now, recalls: m.recalls + 1, feeling: round2(0.8 * m.feeling + 0.2 * valence) }];
  }));
  return { memories: memories.map((m) => updated.get(m) ?? m), recalled: picked.map((m) => updated.get(m)) };
}

/** The memories part of the prompt. */
export function describeMemories(recalled, now) {
  if (!recalled.length) return "";
  const when = (at) => {
    const d = Math.round((now - at) / DAY);
    return d < 1 ? "earlier today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : `${Math.round(d / 7)} weeks ago`;
  };
  const felt = (f) => (f >= 0.4 ? "it felt great" : f > 0.1 ? "it felt good" : f <= -0.4 ? "it felt awful" : f < -0.1 ? "it felt bad" : "it left you cold");
  return `This brings back memories (yours, so maybe a little off):\n${recalled.map((m) => `- ${when(m.at)}: ${m.gist} (${felt(m.feeling)})`).join("\n")}\nA callback to one is welcome when it really fits this moment; never force it.`;
}

/** Before sleep: the day's moments worth replaying, and how many fade for good. */
export function toReplay(memories, now) {
  const day = memories.filter((m) => !m.slept);
  return { replay: day.filter((m) => strengthNow(m, now) >= SLEEP_KEEPS), dropped: day.filter((m) => strengthNow(m, now) < SLEEP_KEEPS).length };
}

/**
 * After sleep: the day's moments are replaced by the gists the replay made of them ({ gist, about,
 * feeling, from: [indexes into replay] }), each as strong as its strongest source plus a bit. With
 * no usable gists, the replayed moments themselves are kept, consolidated as they are.
 */
export function consolidated(memories, replay, gists, now) {
  const kept = memories.filter((m) => m.slept);
  const made = (gists ?? []).flatMap((g) => {
    const from = (g.from ?? []).map((i) => replay[i]).filter(Boolean);
    if (!from.length || !g.gist) return [];
    const s = Math.max(...from.map((m) => strengthNow(m, now)));
    return [{
      at: Math.min(...from.map((m) => m.at)),
      gist: String(g.gist).slice(0, 200),
      about: String(g.about ?? from[0].about ?? ""),
      cues: [...new Set(from.flatMap((m) => m.cues))].slice(0, 24),
      feeling: round2(Math.max(-1, Math.min(1, Number(g.feeling) || 0))),
      strength: round2(Math.min(1, s + 0.2 * (1 - s))),
      seen: now,
      recalls: Math.max(...from.map((m) => m.recalls)),
      slept: true,
    }];
  });
  const day = made.length ? made : replay.map((m) => ({ ...m, slept: true, seen: now, strength: round2(strengthNow(m, now)) }));
  return forget([...kept, ...day], now);
}

const round2 = (x) => Math.round(x * 100) / 100;
