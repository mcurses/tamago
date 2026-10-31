// The model is asked for only a JSON object, but now and then adds a sentence or a second object
// after it. This reads the first complete object and ignores the rest.

/** The first JSON object in `text`, parsed; throws if there is none. */
export function firstJson(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in the reply");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unfinished JSON object in the reply");
}
