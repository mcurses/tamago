// The meum widget carries the species art as Swift source (extension/Meum/SpeciesArt.swift);
// it must match sidebar/species.json, or the widget draws other sprites than the daemon names.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("SpeciesArt.swift is species.json (run scripts/gen-species-swift.sh)", () => {
  const swift = fs.readFileSync(new URL("../extension/Meum/SpeciesArt.swift", import.meta.url), "utf8");
  const json = fs.readFileSync(new URL("../sidebar/species.json", import.meta.url), "utf8");
  const inner = swift.split('##"""\n')[1].split('\n"""##')[0];
  assert.equal(inner, json.replace(/\n$/, ""));
  assert.ok(Object.keys(JSON.parse(inner).species).length > 10);
});
