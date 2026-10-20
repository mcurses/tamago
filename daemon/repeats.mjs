// Catches Tama repeating itself. Haiku sees its diary and, once a phrase is in there, tends to
// echo it in every comment ("the rev1 preview is still gone, the Jira lamp hums on" six times in a
// row). A new line is too close when it shares a run of four words with a recent one, or when most
// of its word pairs already appeared lately.

const words = (text) => String(text).toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);
const grams = (w, n) => w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(" "));

/** The recent line `text` is too close to, or null. */
export function repeats(text, recent) {
  const w = words(text);
  const pairs = grams(w, 2);
  const fours = grams(w, 4);
  const seen = new Set();
  for (const old of recent) {
    const ow = words(old);
    const oldFours = new Set(grams(ow, 4));
    if (fours.some((g) => oldFours.has(g))) return old;
    for (const g of grams(ow, 2)) seen.add(g);
  }
  if (pairs.length >= 4 && pairs.filter((g) => seen.has(g)).length / pairs.length > 0.4) return recent.at(-1) ?? null;
  return null;
}
