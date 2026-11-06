// Tama's notebook: what it thinks is going on, as opposed to what it feels (mood.mjs) and what
// happened (memory.mjs). A page per project it has formed an impression of, one about the
// developer, one about itself; all written by Tama, in its own words, so they can be wrong and
// get revised. During the day Tama jots thoughts (a guess, a wonder, a hunch); when it sleeps it
// reads the day's thoughts and memories over the pages and rewrites them. Nothing in here decides
// what Tama should think; the code only keeps the pages and the dates.
//
// { reflectedAt, pages: { [title]: { text, since, at } }, notes: [{ at, about, text }] }
// `since`: when the page was first written; `at`: when its text last changed. Pure functions; the
// daemon keeps the notebook in notebook.json.

const DAY = 24 * 3600_000;
const MAX_NOTES = 200;
const MAX_PAGES = 24;
const PAGE_CHARS = 600;
export const SELF = "me";
export const DEVELOPER = "the developer";

export const emptyNotebook = () => ({ reflectedAt: 0, pages: {}, notes: [] });

/** A thought jotted during the day. */
export function jot(nb, { at, about, text }) {
  const note = { at, about: String(about ?? ""), text: String(text).replace(/\s+/g, " ").trim().slice(0, 240) };
  if (!note.text) return nb;
  return { ...nb, notes: [...nb.notes, note].slice(-MAX_NOTES) };
}

/** The page titled like `title` (case-insensitive), or any of `aliases`. */
export function pageFor(nb, title, aliases = []) {
  const wanted = [title, ...aliases].filter(Boolean).map((t) => String(t).toLowerCase());
  const hit = Object.keys(nb.pages).find((k) => wanted.includes(k.toLowerCase()));
  return hit ? { title: hit, ...nb.pages[hit] } : null;
}

/** The last `n` thoughts about a subject (same matching as pageFor). */
export function notesAbout(nb, title, aliases = [], n = 3) {
  const wanted = [title, ...aliases].filter(Boolean).map((t) => String(t).toLowerCase());
  return nb.notes.filter((x) => wanted.includes(x.about.toLowerCase())).slice(-n);
}

export function whenWas(at, now) {
  const d = Math.floor((now - at) / DAY);
  return d < 1 ? "today" : d === 1 ? "yesterday" : d < 14 ? `${d} days ago` : `${Math.round(d / 7)} weeks ago`;
}

/** The part of the prompt about one subject: its page and the thoughts jotted about it lately. */
export function describePage(nb, title, aliases, now) {
  const page = pageFor(nb, title, aliases);
  const notes = notesAbout(nb, title, aliases);
  if (!page && !notes.length) return "";
  const parts = [];
  if (page) parts.push(`From your notebook, about "${page.title}" (first written ${whenWas(page.since, now)}, last changed ${whenWas(page.at, now)}):\n${page.text}`);
  if (notes.length) {
    const t = (at) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    parts.push(`Thoughts you jotted about it lately:\n${notes.map((x) => `- ${whenWas(x.at, now)} ${t(x.at)}: ${x.text}`).join("\n")}`);
  }
  return parts.join("\n");
}

/** All pages, for the reflection prompt and for `tamago notebook`. */
export function listPages(nb, now) {
  const order = (k) => (k === SELF ? 0 : k === DEVELOPER ? 1 : 2);
  return Object.entries(nb.pages)
    .sort((a, b) => order(a[0]) - order(b[0]) || b[1].at - a[1].at)
    .map(([title, p]) => ({ title, ...p, sinceText: whenWas(p.since, now), atText: whenWas(p.at, now) }));
}

/**
 * After a reflection: the pages the model wrote replace the old ones. A page that keeps its title
 * keeps `since`; one whose text didn't change keeps `at`. The day's notes are consumed. Without
 * usable pages, the notebook stays as it was (reflectedAt still moves on).
 */
/** A page as the model wrote it: a string, or an object with the text under some key, or a list. */
function pageText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(pageText).filter(Boolean).join(" ");
  if (typeof v === "object") {
    for (const k of ["text", "page", "notes", "content", "body"]) if (typeof v[k] === "string") return v[k];
    return Object.values(v).map(pageText).filter(Boolean).join(" ");
  }
  return String(v);
}

export function reflected(nb, pagesOut, now) {
  if (!pagesOut || typeof pagesOut !== "object" || Array.isArray(pagesOut)) return { ...nb, reflectedAt: now };
  const pages = {};
  for (const [rawTitle, rawText] of Object.entries(pagesOut)) {
    const title = String(rawTitle).trim().slice(0, 60);
    const text = pageText(rawText).replace(/\s+/g, " ").trim().slice(0, PAGE_CHARS);
    if (!title || !text) continue;
    const old = pageFor(nb, title);
    pages[old?.title ?? title] = { text, since: old?.since ?? now, at: old && old.text === text ? old.at : now };
  }
  if (!Object.keys(pages).length) return { ...nb, reflectedAt: now };
  // Too many: the oldest-changed project pages go, never "me" or "the developer".
  const keep = Object.entries(pages).sort((a, b) => (a[0] === SELF || a[0] === DEVELOPER ? -1 : 0) - (b[0] === SELF || b[0] === DEVELOPER ? -1 : 0) || b[1].at - a[1].at).slice(0, MAX_PAGES);
  return { reflectedAt: now, pages: Object.fromEntries(keep), notes: nb.notes.filter((x) => x.at > now) };
}
