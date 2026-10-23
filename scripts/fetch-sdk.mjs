#!/usr/bin/env node
// Downloads cmux's CmuxExtensionKit sources (GPL-3.0-or-later, not vendored in this repo) at the
// commit matching the cmux build the extension targets, into build/cmux-sdk/.
//
//   node scripts/fetch-sdk.mjs [commit]

import fs from "node:fs";
import path from "node:path";

// cmux 0.64.22 (102) was built from this commit (`cmux version` prints the short hash).
const COMMIT = process.argv[2] ?? "ddd4a01bc5d8ebac19643930f5fd7d40e85f1534";
const REPO = "manaflow-ai/cmux";
const PREFIX = "Packages/macOS/CmuxExtensionKit/Sources/CmuxExtensionKit/";
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "build/cmux-sdk");
const stamp = path.join(out, "COMMIT");

if (fs.existsSync(stamp) && fs.readFileSync(stamp, "utf8").trim() === COMMIT) {
  console.log(`CmuxExtensionKit ${COMMIT.slice(0, 9)} already in build/cmux-sdk`);
  process.exit(0);
}

const get = async (url, as) => {
  const headers = { "User-Agent": "tamago-build" };
  // CI runners share IPs, so unauthenticated API calls run into GitHub's rate limit there.
  if (process.env.GITHUB_TOKEN && url.startsWith("https://api.github.com/")) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === "json" ? res.json() : res.text();
};

const tree = await get(`https://api.github.com/repos/${REPO}/git/trees/${COMMIT}?recursive=1`, "json");
const files = tree.tree.filter((t) => t.type === "blob" && t.path.startsWith(PREFIX) && t.path.endsWith(".swift"));
if (!files.length) throw new Error(`no CmuxExtensionKit sources at ${COMMIT}`);
fs.rmSync(out, { recursive: true, force: true });
for (const f of files) {
  const dest = path.join(out, "Sources", f.path.slice(PREFIX.length));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, await get(`https://raw.githubusercontent.com/${REPO}/${COMMIT}/${f.path}`));
}
fs.writeFileSync(path.join(out, "LICENSE"), await get(`https://raw.githubusercontent.com/${REPO}/${COMMIT}/LICENSE`));
fs.writeFileSync(stamp, COMMIT + "\n");
console.log(`fetched ${files.length} CmuxExtensionKit sources at ${COMMIT.slice(0, 9)}`);
