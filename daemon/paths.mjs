// Where Tama's state lives (mood, memories, diary, likes, settings, token, …).
//
// - TAMAGO_STATE_DIR wins (test instances, development copies).
// - Run by meum as the Tamago widget's helper: meum's data folder for the widget, MEUM_WIDGET_DATA.
// - Otherwise meum's data folder for Tamago once Tama's state has moved there (it holds a token),
//   so the CLI (--say, --mood, …) and scripts/ensure-running.sh find the same Tama as the helper.
// - Otherwise ~/.local/state/tamago, as with cmux.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MEUM_WIDGET_ID = "io.github.mcurses.tamago";

/** meum's data folder for the Tamago widget, as meum names it (`<meum state dir>/widgets/<id>/`). */
export function meumDataDir(env = process.env, home = os.homedir()) {
  return path.join(env.MEUM_STATE_DIR || path.join(home, ".local/state/meum"), "widgets", MEUM_WIDGET_ID);
}

export function stateDir(env = process.env, home = os.homedir()) {
  if (env.TAMAGO_STATE_DIR) return env.TAMAGO_STATE_DIR;
  if (env.MEUM_WIDGET_DATA && (!env.MEUM_WIDGET_ID || env.MEUM_WIDGET_ID === MEUM_WIDGET_ID)) return env.MEUM_WIDGET_DATA;
  const meum = meumDataDir(env, home);
  if (fs.existsSync(path.join(meum, "token"))) return meum;
  return path.join(home, ".local/state/tamago");
}

/** Where a standalone (cmux) install keeps its Tama. */
export function standaloneDir(home = os.homedir()) {
  return path.join(home, ".local/state/tamago");
}

// What makes up a Tama: who it is, what it remembers and said, and its settings. Not the token,
// pid, log or update check, which belong to the install, not the pet.
export const PET_FILES = ["pet.json", "species.json", "mood.json", "memories.json", "notebook.json", "history.jsonl", "liked.jsonl", "settings.json"];

/**
 * Brings a standalone install's Tama into meum's data folder, once: only while meum's folder has no
 * pet of its own yet. Copies, so the standalone folder stays as it was. Returns the files copied.
 */
export function adoptStandalonePet(dest, from = standaloneDir()) {
  if (path.resolve(dest) === path.resolve(from)) return [];
  const hasPet = (dir) => ["pet.json", "species.json"].some((f) => fs.existsSync(path.join(dir, f)));
  if (hasPet(dest) || !hasPet(from)) return [];
  fs.mkdirSync(dest, { recursive: true });
  const copied = [];
  for (const f of PET_FILES) {
    const src = path.join(from, f);
    if (!fs.existsSync(src) || fs.existsSync(path.join(dest, f))) continue;
    fs.copyFileSync(src, path.join(dest, f));
    copied.push(f);
  }
  return copied;
}
