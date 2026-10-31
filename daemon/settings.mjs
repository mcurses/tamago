// Tamago's own settings, for what cmux's Settings don't cover. Picked from Tama's right-click menu
// or with `--set key=value`, stored in ~/.local/state/tamago/settings.json. A setting never picked
// falls back to its environment variable, then to the default.

export const TALK_LEVELS = ["chatty", "normal", "quiet", "muted"];
export const MODELS = ["haiku", "sonnet", "opus"];

// Multipliers on the base tunables (TAMAGO_CHANCE, TAMAGO_COOLDOWN_S, …). "muted" makes no
// unprompted remarks at all; feeding, petting and poking still get a reply.
const TALK = {
  chatty: { chance: 2, cooldown: 0.4, idle: 2, switch: 2.5 },
  normal: { chance: 1, cooldown: 1, idle: 1, switch: 1 },
  quiet: { chance: 0.35, cooldown: 4, idle: 0, switch: 0 },
  muted: { chance: 0, cooldown: Infinity, idle: 0, switch: 0 },
};

export const talkProfile = (level) => TALK[level] ?? TALK.normal;

/** Defaults, with the environment's say for the ones that had a variable before the menu existed. */
export const defaults = (env = process.env) => ({
  claudeDots: true,
  talk: TALK_LEVELS.includes(env.TAMAGO_TALK) ? env.TAMAGO_TALK : "normal",
  model: env.TAMAGO_MODEL || "sonnet",
  language: env.TAMAGO_LANG || "English",
  checkUpdates: env.TAMAGO_NO_UPDATE_CHECK !== "1",
});

/** The stored value for `key` from menu or command-line input, or an Error explaining why not. */
export function parseSetting(key, value) {
  const v = String(value).trim();
  switch (key) {
    case "claudeDots":
    case "checkUpdates":
      if (!["true", "false"].includes(v)) return new Error(`${key} is true or false`);
      return v === "true";
    case "talk":
      return TALK_LEVELS.includes(v) ? v : new Error(`talk is one of ${TALK_LEVELS.join(", ")}`);
    case "model":
      // Anything `claude --model` takes works; the menu offers the three aliases.
      return /^[\w.\-\[\]]{2,60}$/.test(v) ? v : new Error("model is an alias like haiku, sonnet, opus or a full model id");
    case "language":
      return /^[\p{L} ()\-]{2,40}$/u.test(v) ? v : new Error("language is a name like German or Português");
    default:
      return new Error(`unknown setting ${key}; known: ${Object.keys(defaults({})).join(", ")}`);
  }
}
