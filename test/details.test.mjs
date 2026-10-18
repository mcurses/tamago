// Tests for daemon/details.mjs: node --test test/details.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { parseDefaults, parseJsonc, resolveSettings, parseSidebarState, snapshotDetails, eventWorkspace, parseListening } from "../daemon/details.mjs";

const plist = (body) => `<?xml version="1.0"?><plist version="1.0"><dict>${body}</dict></plist>`;

test("defaults export values", () => {
  const v = parseDefaults(plist("<key>a</key><true/><key>b</key><false/><key>c</key><integer>4</integer><key>d</key><string>x</string><key>e</key><real>0.5</real>"));
  assert.deepEqual(v, { a: true, b: false, c: 4, d: "x", e: 0.5 });
});

test("cmux.json with comments, trailing commas and slashes in strings", () => {
  const v = parseJsonc(`{
    // a comment
    "url": "https://example.com/x", /* block */
    "sidebar": { "showPorts": false, },
  }`);
  assert.deepEqual(v, { url: "https://example.com/x", sidebar: { showPorts: false } });
});

test("settings: saved preferences win over cmux.json, which wins over cmux's defaults", () => {
  const s = resolveSettings(
    plist("<key>sidebarShowPorts</key><false/><key>sidebarNotificationMessageLineLimit</key><integer>3</integer>"),
    `{ "sidebar": { "showPorts": true, "showLog": false } }`,
  );
  assert.equal(s.showPorts, false);
  assert.equal(s.showLog, false);
  assert.equal(s.showProgress, true);
  assert.equal(s.notificationMessageLineLimit, 3);
  assert.equal(resolveSettings("", "not json").showPorts, true);
});

test("sidebar-state: statuses, progress, logs; Tama's label isn't progress", () => {
  const text = [
    "tab=X", "progress=0.40 Building", "status_count=2",
    "  claude_code=Needs input icon=bell.fill color=#4C8DFF", "  deploy=ok",
    "meta_block_count=0", "log_count=2", "  [warning] disk almost full", "  [success] done",
  ].join("\n");
  const d = parseSidebarState(text);
  assert.deepEqual(d.statuses, [
    { key: "claude_code", label: "Claude Code", value: "Needs input", icon: "bell.fill", color: "#4C8DFF" },
    { key: "deploy", label: "Deploy", value: "ok", icon: null, color: null },
  ]);
  assert.deepEqual(d.progress, { value: 0.4, label: "Building" });
  assert.deepEqual(d.logs, [{ level: "warning", text: "disk almost full" }, { level: "success", text: "done" }]);
  assert.equal(parseSidebarState("progress=0.00 tamago|1|idle|-|-|egg|Tama").progress, null);
  assert.equal(parseSidebarState("progress=none").progress, null);
});

test("snapshot details", () => {
  const d = snapshotDetails({
    current_directory: os.homedir() + "/code/x",
    git_branches: [{ branch: "main", dirty: true }],
    pull_request_urls: ["https://github.com/a/b/pull/12"],
    listening_ports: [3000],
    remote_display_target: "box", remote_connection_state: "connected",
  });
  assert.equal(d.path, "~/code/x");
  assert.equal(d.branch, "main");
  assert.equal(d.dirty, true);
  assert.deepEqual(d.prs, [{ url: "https://github.com/a/b/pull/12", label: "PR #12" }]);
  assert.deepEqual(d.ports, [3000]);
  assert.deepEqual(d.remote, { target: "box", state: "connected" });
  assert.equal(snapshotDetails({ git_branches: ["dev"] }).branch, "dev");
});

test("the workspace a sidebar event is about", () => {
  const id = "3973B9DD-BCB4-43CA-94A2-1E2105A936B8";
  assert.equal(eventWorkspace({ workspace_id: null, payload: { args: `x y --tab=${id}` } }), id);
  assert.equal(eventWorkspace({ payload: {} }), null);
});

test("listening ports from netstat", () => {
  const ports = parseListening([
    "Active Internet connections (including servers)",
    "Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)",
    "tcp4       0      0  127.0.0.1.47321        *.*                    LISTEN",
    "tcp6       0      0  ::1.5197               *.*                    LISTEN",
    "tcp46      0      0  *.55557                *.*                    LISTEN",
    "tcp4       0      0  192.168.1.5.50123      1.2.3.4.443            ESTABLISHED",
  ].join("\n"));
  assert.deepEqual([...ports].sort((a, b) => a - b), [5197, 47321, 55557]);
});
