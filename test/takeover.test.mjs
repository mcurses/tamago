// Tests for meum's helper taking over from a standalone install: daemon/takeover.mjs and the pet
// adoption in daemon/paths.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { adoptStandalonePet } from "../daemon/paths.mjs";
import { isStandalone, stopStandalone, commandOf } from "../daemon/takeover.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tamago-takeover-"));

test("adoptStandalonePet: copies the pet once, never the token, and leaves an existing pet alone", () => {
  const from = tmp();
  const dest = tmp();
  for (const f of ["pet.json", "memories.json", "history.jsonl", "token", "tamago.pid"]) fs.writeFileSync(path.join(from, f), f);
  assert.deepEqual(adoptStandalonePet(dest, from).sort(), ["history.jsonl", "memories.json", "pet.json"]);
  assert.ok(!fs.existsSync(path.join(dest, "token")));
  assert.ok(fs.existsSync(path.join(from, "pet.json")), "the standalone folder stays as it was");
  fs.writeFileSync(path.join(from, "notebook.json"), "{}");
  assert.deepEqual(adoptStandalonePet(dest, from), [], "meum's folder has a pet now");
  assert.deepEqual(adoptStandalonePet(tmp(), tmp()), [], "nothing to adopt");
});

test("isStandalone: a node daemon from source is standalone, meum's compiled helper is not", () => {
  assert.equal(isStandalone("/opt/homebrew/bin/node /Users/x/.tamago/daemon/tamago.mjs"), true);
  assert.equal(isStandalone("/Users/x/.local/share/meum/widgets/TamagoMeum.meumwidget/bin/tamago-daemon"), false);
  assert.equal(isStandalone(null), false);
});

test("stopStandalone: stops a standalone daemon, leaves any other process running", async () => {
  const dir = tmp();
  const fake = path.join(dir, "daemon");
  fs.mkdirSync(fake);
  fs.writeFileSync(path.join(fake, "tamago.mjs"), "setInterval(() => {}, 1000);");
  const standalone = spawn(process.execPath, [path.join(fake, "tamago.mjs")], { stdio: "ignore" });
  const other = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 200));
  try {
    assert.equal(await stopStandalone(other.pid), false);
    assert.ok(commandOf(other.pid), "the other process still runs");
    assert.equal(await stopStandalone(standalone.pid), true);
    assert.equal(commandOf(standalone.pid), null);
  } finally {
    other.kill();
    standalone.kill();
  }
});
