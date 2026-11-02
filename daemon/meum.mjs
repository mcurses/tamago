// meum as Tama's host: the workspaces and agent events come from meum's control socket (API meum.v1,
// through its `meum` CLI) instead of cmux. The daemon keeps working with cmux's snapshot shape, so
// this file maps meum's workspace tree onto it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The meum CLI: TAMAGO_MEUM, the installed app's, or a checkout's build next to this repo. */
export function meumCli(env = process.env) {
  return [
    env.TAMAGO_MEUM,
    "/Applications/meum.app/Contents/Resources/bin/meum",
    path.join(os.homedir(), "Applications/meum.app/Contents/Resources/bin/meum"),
  ].find((p) => p && fs.existsSync(p)) ?? null;
}

/** Every tab in a workspace's layout (cards hold tabs, splits hold cards or splits). */
function tabsOf(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node.tabs)) out.push(...node.tabs);
  for (const child of [node.first, node.second, ...(Array.isArray(node.children) ? node.children : [])]) tabsOf(child, out);
  return out;
}

/** tab id -> workspace id, from `meum tree`. */
export function tabOwners(tree) {
  const owners = new Map();
  for (const w of tree?.workspaces ?? []) for (const t of tabsOf(w.root)) owners.set(t.id, w.id);
  return owners;
}

/**
 * `meum tree` as the snapshot the daemon knows from cmux: { workspaces: [{ id, title, selected,
 * current_directory, root_path, panel_directories, git_branches, unread_count,
 * latest_submitted_message, latest_submitted_at }] }. `prompts` holds the last prompt per workspace,
 * learned from agent hook events (meum's tree doesn't carry it).
 */
export function snapshotFromTree(tree, prompts = new Map()) {
  return {
    host: "meum",
    workspaces: (tree?.workspaces ?? []).map((w) => {
      const tabs = tabsOf(w.root);
      const last = prompts.get(w.id);
      return {
        id: w.id,
        title: w.name ?? "",
        selected: w.id === tree.selectedWorkspaceID || w.selected === true,
        pinned: Boolean(w.pinned),
        current_directory: w.cwd ?? null,
        root_path: w.cwd ?? null,
        panel_directories: [...new Set([...(w.cwds ?? []), ...tabs.map((t) => t.cwd).filter(Boolean)])],
        git_branches: w.branch ? [{ branch: w.branch }] : [],
        unread_count: w.agents?.anyUnread ? 1 : 0,
        custom_color: w.color ?? null,
        latest_submitted_message: last?.prompt ?? null,
        latest_submitted_at: last?.at ?? null,
      };
    }),
  };
}

/**
 * What an `agent.hook` event from meum means for Tama: the workspace, the session's transcript
 * and, for a submitted prompt, the prompt. Null for anything else.
 */
export function hookEvent(ev, owners) {
  if (ev?.type !== "agent.hook") return null;
  const d = ev.data ?? {};
  const p = d.payload ?? {};
  const wsId = owners.get(d.tab);
  if (!wsId) return null;
  return {
    wsId,
    name: p.hook_event_name ?? null,
    sessionId: p.session_id ?? null,
    transcript: typeof p.transcript_path === "string" ? p.transcript_path : null,
    cwd: p.cwd ?? null,
    prompt: p.hook_event_name === "UserPromptSubmit" && typeof p.prompt === "string" ? p.prompt : null,
  };
}
