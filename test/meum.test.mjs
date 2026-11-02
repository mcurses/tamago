import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotFromTree, tabOwners, hookEvent } from "../daemon/meum.mjs";

// Shaped like `meum --json tree` (meum.v1): a workspace's root is a card or a split of two nodes.
const tree = {
  version: "meum.v1",
  selectedWorkspaceID: "W2",
  workspaces: [
    { id: "W1", name: "fun", cwd: "/code/fun", cwds: ["/code/fun"], branch: "main", pinned: true, color: "#FF0000",
      agents: { anyUnread: true }, root: { type: "card", id: "C1", tabs: [{ id: "T1", cwd: "/code/fun" }] } },
    { id: "W2", name: "rev1", cwd: "/code/rev1", cwds: ["/code/rev1"], branch: null, agents: {},
      root: { type: "split", id: "S1", first: { type: "card", id: "C2", tabs: [{ id: "T2", cwd: "/code/rev1" }] },
              second: { type: "split", id: "S2", first: { type: "card", id: "C3", tabs: [{ id: "T3", cwd: "/code/rev1/docs" }] },
                        second: { type: "card", id: "C4", tabs: [{ id: "T4", cwd: null }] } } } },
  ],
};

test("tabs in nested splits belong to their workspace", () => {
  const owners = tabOwners(tree);
  assert.deepEqual([...owners], [["T1", "W1"], ["T2", "W2"], ["T3", "W2"], ["T4", "W2"]]);
});

test("meum's tree reads as the snapshot the daemon knows from cmux", () => {
  const prompts = new Map([["W2", { prompt: "fix the tests", at: 42 }]]);
  const snap = snapshotFromTree(tree, prompts);
  assert.equal(snap.host, "meum");
  const [fun, rev1] = snap.workspaces;
  assert.equal(fun.title, "fun");
  assert.equal(fun.selected, false);
  assert.equal(rev1.selected, true);
  assert.deepEqual(fun.git_branches, [{ branch: "main" }]);
  assert.deepEqual(rev1.git_branches, []);
  assert.equal(fun.unread_count, 1);
  assert.equal(rev1.unread_count, 0);
  assert.deepEqual(rev1.panel_directories, ["/code/rev1", "/code/rev1/docs"]);
  assert.equal(rev1.latest_submitted_message, "fix the tests");
  assert.equal(rev1.latest_submitted_at, 42);
  assert.equal(fun.latest_submitted_message, null);
});

test("agent hook events name the workspace, transcript and prompt", () => {
  const owners = tabOwners(tree);
  const ev = { seq: 9, type: "agent.hook", data: { tab: "T3", configDir: null,
    payload: { hook_event_name: "UserPromptSubmit", session_id: "abc", transcript_path: "/t/abc.jsonl", cwd: "/code/rev1", prompt: "go" } } };
  assert.deepEqual(hookEvent(ev, owners), { wsId: "W2", name: "UserPromptSubmit", sessionId: "abc", transcript: "/t/abc.jsonl", cwd: "/code/rev1", prompt: "go" });
  const stop = { type: "agent.hook", data: { tab: "T1", payload: { hook_event_name: "Stop", session_id: "x", prompt: "ignored" } } };
  assert.equal(hookEvent(stop, owners).prompt, null);
  assert.equal(hookEvent({ type: "agent.hook", data: { tab: "nope", payload: {} } }, owners), null);
  assert.equal(hookEvent({ type: "workspace.selected", data: {} }, owners), null);
});
