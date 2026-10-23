// Tests for daemon/update.mjs: version compare, release parsing, and an install from a local tarball.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { newer, parseVersion, pickRelease, installRelease } from "../daemon/update.mjs";

test("versions compare numerically", () => {
  assert.deepEqual(parseVersion("v0.2.10"), [0, 2, 10]);
  assert.equal(parseVersion("b56801a"), null);
  assert.equal(newer("v0.2.9", "v0.2.10"), true);
  assert.equal(newer("v0.2.10", "v0.2.9"), false);
  assert.equal(newer("v1.0.0", "v1.0.0"), false);
  assert.equal(newer("b56801a", "v9.9.9"), false); // a git checkout never updates itself
});

test("a release needs its tarball asset", () => {
  const assets = [{ name: "tamago-v0.3.0.tar.gz", browser_download_url: "https://example.test/t.tgz" }];
  assert.deepEqual(pickRelease({ tag_name: "v0.3.0", assets, html_url: "https://example.test/r" }), {
    version: "v0.3.0", tarball: "https://example.test/t.tgz", notes: "https://example.test/r",
  });
  assert.equal(pickRelease({ tag_name: "v0.3.0", assets: [] }), null);
  assert.equal(pickRelease({ tag_name: "nightly", assets }), null);
});

function tarball(version, dir) {
  const src = path.join(dir, `tamago-${version}`);
  fs.mkdirSync(path.join(src, "daemon"), { recursive: true });
  fs.writeFileSync(path.join(src, "VERSION"), version + "\n");
  fs.writeFileSync(path.join(src, "daemon/tamago.mjs"), "// new\n");
  const out = path.join(dir, `tamago-${version}.tar.gz`);
  execFileSync("tar", ["-czf", out, "-C", dir, `tamago-${version}`]);
  return fs.readFileSync(out);
}

const serve = (bytes) => async () => ({ ok: true, arrayBuffer: async () => bytes });

test("installing swaps the new release in and keeps the old one", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tamago-update-"));
  const root = path.join(dir, "share/tamago");
  fs.mkdirSync(path.join(root, "daemon"), { recursive: true });
  fs.writeFileSync(path.join(root, "VERSION"), "v0.1.0\n");
  const bytes = tarball("v0.2.0", dir);
  await installRelease({ version: "v0.2.0", tarball: "x" }, root, { fetchImpl: serve(bytes) });
  assert.equal(fs.readFileSync(path.join(root, "VERSION"), "utf8").trim(), "v0.2.0");
  assert.equal(fs.readFileSync(path.join(root + ".previous", "VERSION"), "utf8").trim(), "v0.1.0");
  assert.equal(fs.existsSync(root + ".incoming"), false);
});

test("a tarball with the wrong version is refused and nothing is swapped", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tamago-update-"));
  const root = path.join(dir, "share/tamago");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "VERSION"), "v0.1.0\n");
  const bytes = tarball("v0.2.0", dir);
  await assert.rejects(installRelease({ version: "v0.3.0", tarball: "x" }, root, { fetchImpl: serve(bytes) }), /expected v0.3.0/);
  assert.equal(fs.readFileSync(path.join(root, "VERSION"), "utf8").trim(), "v0.1.0");
});
