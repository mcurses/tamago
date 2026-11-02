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
