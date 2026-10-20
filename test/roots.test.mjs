// Tests for projectRoots in daemon/transcript.mjs: node --test test/roots.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectRoots } from "../daemon/transcript.mjs";

test("every account's config dir counts, other dot dirs don't", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "roots-"));
  for (const d of [".claude/projects", ".claude-work/projects", ".claude-wa1/projects", ".claude-empty", ".config/projects"]) {
    fs.mkdirSync(path.join(home, d), { recursive: true });
  }
  fs.writeFileSync(path.join(home, ".claude.json"), "{}");
  assert.deepEqual(projectRoots(home).map((p) => path.relative(home, p)).sort(), [".claude-wa1/projects", ".claude-work/projects", ".claude/projects"]);
});
