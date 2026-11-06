// The model is asked for only a JSON object, but now and then adds a sentence or a second object
// after it, or writes a broken object, says "wait, that's not valid JSON" and writes it again.
// This reads the first complete object that parses and ignores the rest.

/** The first JSON object in `text` that parses; throws if there is none. */
export function firstJson(text) {
  let start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in the reply");
  let problem = "unfinished JSON object in the reply";
  while (start >= 0) {
    const end = objectEnd(text, start);
    if (end >= 0) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch (err) {
        problem = `broken JSON object in the reply: ${err.message}`;
      }
    }
    start = text.indexOf("{", start + 1);
  }
  throw new Error(problem);
}

/** Where the object opening at `start` closes, or -1. */
function objectEnd(text, start) {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}
