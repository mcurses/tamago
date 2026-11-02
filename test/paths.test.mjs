// Tests for daemon/paths.mjs: where Tama's state lives.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stateDir, meumDataDir, MEUM_WIDGET_ID } from "../daemon/paths.mjs";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "tamago-paths-"));
const legacy = path.join(home, ".local/state/tamago");
const meum = path.join(home, ".local/state/meum/widgets", MEUM_WIDGET_ID);

test("without meum state, the cmux location", () => {
  assert.equal(stateDir({}, home), legacy);
});

test("TAMAGO_STATE_DIR wins over everything", () => {
  assert.equal(stateDir({ TAMAGO_STATE_DIR: "/x", MEUM_WIDGET_DATA: "/y" }, home), "/x");
});

test("as meum's helper: MEUM_WIDGET_DATA", () => {
  assert.equal(stateDir({ MEUM_WIDGET_DATA: "/y", MEUM_WIDGET_ID }, home), "/y");
  assert.equal(stateDir({ MEUM_WIDGET_DATA: "/y" }, home), "/y");
});

test("another widget's data folder is not Tama's", () => {
  assert.equal(stateDir({ MEUM_WIDGET_DATA: "/y", MEUM_WIDGET_ID: "io.example.other" }, home), legacy);
});

test("once the state moved to meum (a token there), meum's folder", () => {
  fs.mkdirSync(meum, { recursive: true });
  assert.equal(stateDir({}, home), legacy); // an empty folder (meum creates it) doesn't count
  fs.writeFileSync(path.join(meum, "token"), "t\n");
  assert.equal(stateDir({}, home), meum);
});

test("MEUM_STATE_DIR moves meum's folder", () => {
  assert.equal(meumDataDir({ MEUM_STATE_DIR: "/m" }, home), path.join("/m/widgets", MEUM_WIDGET_ID));
});
