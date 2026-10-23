// Updates for installs from a GitHub release (scripts/install.sh puts them in ~/.local/share/tamago,
// with a VERSION file). A git checkout has no VERSION file and updates with git pull instead.
//
// The check asks GitHub for the latest release at most once a day. Installing downloads its
// tarball, unpacks it next to the current install, swaps the two folders and hands over to the
// new scripts/install.sh, which waits for this daemon to exit and starts the new one.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const run = promisify(execFile);

export const REPO = "mcurses/tamago";
export const LATEST_URL = process.env.TAMAGO_UPDATE_URL ?? `https://api.github.com/repos/${REPO}/releases/latest`;

/** "v0.2.10" -> [0, 2, 10]; null for anything that isn't a release version. */
export function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? "").trim());
  return m ? m.slice(1).map(Number) : null;
}

/** True when release `b` is newer than `a`. */
export function newer(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return y[i] > x[i];
  return false;
}

/** The version and tarball URL of a GitHub "latest release" reply, or null if it has no tarball. */
export function pickRelease(release) {
  const version = release?.tag_name;
  const asset = release?.assets?.find((a) => a.name === `tamago-${version}.tar.gz`);
  if (!parseVersion(version) || !asset) return null;
  return { version, tarball: asset.browser_download_url, notes: release.html_url ?? null };
}

export async function latestRelease({ url = LATEST_URL, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "tamago-update" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`update check: ${res.status} from ${url}`);
  return pickRelease(await res.json());
}

/**
 * Downloads and unpacks `release` beside `root`, then swaps it in; the previous install stays in
 * `<root>.previous` until the next update. Returns the new root (same path as `root`).
 */
export async function installRelease(release, root, { fetchImpl = fetch } = {}) {
  const parent = path.dirname(root);
  const incoming = `${root}.incoming`;
  const previous = `${root}.previous`;
  fs.rmSync(incoming, { recursive: true, force: true });
  fs.mkdirSync(incoming, { recursive: true });
  const res = await fetchImpl(release.tarball, { headers: { "User-Agent": "tamago-update" }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download: ${res.status} from ${release.tarball}`);
  const archive = path.join(parent, `tamago-${release.version}.tar.gz`);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  try {
    await run("tar", ["-xzf", archive, "-C", incoming, "--strip-components", "1"]);
  } finally {
    fs.rmSync(archive, { force: true });
  }
  const got = fs.readFileSync(path.join(incoming, "VERSION"), "utf8").trim();
  if (got !== release.version) throw new Error(`download is ${got}, expected ${release.version}`);
  if (!fs.existsSync(path.join(incoming, "daemon/tamago.mjs"))) throw new Error("download has no daemon");
  fs.rmSync(previous, { recursive: true, force: true });
  fs.renameSync(root, previous);
  fs.renameSync(incoming, root);
  return root;
}
