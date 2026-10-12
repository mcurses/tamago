// Everything the stock cmux sidebar shows per workspace, for the compiled sidebar: agent status
// pills, progress, log lines, ports, pull requests, SSH, paths. cmux's extension API only covers
// part of it, so the daemon collects it and passes it on through daemon/server.mjs.
//
// Also reads cmux's own sidebar settings (Settings → Sidebar, or "sidebar" in cmux.json), so the
// switches there apply to the Tamago sidebar too.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ---------- settings ----------

// name -> [UserDefaults key, default]. cmux.json uses the name itself under "sidebar".
const SETTINGS = {
  hideAllDetails: ["sidebarHideAllDetails", false],
  showWorkspaceDescription: ["sidebarShowWorkspaceDescription", true],
  showNotificationMessage: ["sidebarShowNotificationMessage", true],
  notificationMessageLineLimit: ["sidebarNotificationMessageLineLimit", 12],
  showBranchDirectory: ["sidebarShowBranchDirectory", true],
  showGitBranch: ["sidebarShowGitBranch", true],
  showGitBranchIcon: ["sidebarShowGitBranchIcon", true],
  stackBranchDirectory: ["sidebarBranchDirectoryStacked", false],
  pathLastSegmentOnly: ["sidebarPathLastSegmentOnly", false],
  showPullRequests: ["sidebarShowPullRequest", true],
  makePullRequestsClickable: ["sidebarMakePullRequestsClickable", true],
  openPullRequestLinksInCmuxBrowser: ["browserOpenSidebarPullRequestLinksInCmuxBrowser", true],
  showPorts: ["sidebarShowPorts", true],
  openPortLinksInCmuxBrowser: ["browserOpenSidebarPortLinksInCmuxBrowser", true],
  showSSH: ["sidebarShowSSH", true],
  showLog: ["sidebarShowLog", true],
  showProgress: ["sidebarShowProgress", true],
  showStatusPills: ["sidebarShowStatusPills", true],
  showAgentActivity: ["sidebarShowAgentActivity", true],
};

const CMUX_JSON = path.join(os.homedir(), ".config/cmux/cmux.json");

/** Values of our keys from `defaults export` XML: booleans, integers, reals, strings. */
export function parseDefaults(xml) {
  const out = {};
  const re = /<key>([^<]+)<\/key>\s*(?:<(true|false)\/>|<(integer|real|string)>([^<]*)<\/\3>)/g;
  for (const m of xml.matchAll(re)) {
    if (m[2]) out[m[1]] = m[2] === "true";
    else if (m[3] === "string") out[m[1]] = m[4];
    else out[m[1]] = Number(m[4]);
  }
  return out;
}

/** cmux.json allows comments and trailing commas. */
export function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/**
 * The sidebar settings: what Settings saved (UserDefaults) wins, then cmux.json, then cmux's
 * defaults. `defaultsXml` is `defaults export com.cmuxterm.app -`.
 */
export function resolveSettings(defaultsXml, cmuxJsonText) {
  const saved = parseDefaults(defaultsXml ?? "");
  let file = {};
  try {
    file = parseJsonc(cmuxJsonText ?? "{}").sidebar ?? {};
  } catch {}
  const out = {};
  for (const [name, [key, fallback]] of Object.entries(SETTINGS)) {
    const v = saved[key] ?? file[name] ?? fallback;
    out[name] = typeof fallback === "boolean" ? Boolean(v) : Number(v) || fallback;
  }
  return out;
}

export function readCmuxJson() {
  try {
    return fs.readFileSync(CMUX_JSON, "utf8");
  } catch {
    return null;
  }
}

// ---------- per-workspace details ----------

/**
 * `cmux sidebar-state` for one workspace -> { statuses, progress, logs }. Tama's own label on the
 * progress line ("tamago|…") isn't progress, so it is left out.
 */
export function parseSidebarState(text) {
  const statuses = [];
  const logs = [];
  let progress = null;
  let section = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("  ")) {
      section = line.split("=")[0];
      if (section === "progress") {
        const m = line.match(/^progress=([\d.]+)(?: (.*))?$/);
        if (m && !(m[2] ?? "").startsWith("tamago|")) progress = { value: Number(m[1]), label: m[2] ?? "" };
      }
      continue;
    }
    const body = line.trim();
    if (section === "status_count") {
      // "claude_code=Needs input icon=bell.fill color=#4C8DFF"
      const m = body.match(/^([^=]+)=(.*?)(?: icon=(\S+))?(?: color=(#[0-9A-Fa-f]{6,8}))?$/);
      if (m) statuses.push({ key: m[1], label: prettyKey(m[1]), value: m[2], icon: m[3] ?? null, color: m[4] ?? null });
    } else if (section === "log_count") {
      const m = body.match(/^\[(\w+)\] (.*)$/);
      logs.push(m ? { level: m[1], text: m[2] } : { level: "info", text: body });
    }
  }
  return { statuses, progress, logs: logs.slice(-3) };
}

const KNOWN_KEYS = { claude_code: "Claude Code", codex: "Codex", opencode: "OpenCode", gemini: "Gemini" };
const prettyKey = (k) => KNOWN_KEYS[k] ?? k.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** "~/code/x" instead of "/Users/me/code/x". */
export const tildify = (p) => (p && p.startsWith(os.homedir()) ? "~" + p.slice(os.homedir().length) : p);

/** The parts of a snapshot workspace the compiled sidebar shows. */
export function snapshotDetails(w) {
  const branches = (w.git_branches ?? []).map((b) => (typeof b === "string" ? { branch: b } : b)).filter((b) => b?.branch);
  const prs = (w.pull_request_urls ?? []).map((url) => {
    const n = String(url).match(/\/(?:pull|merge_requests|pulls)\/(\d+)/)?.[1];
    return { url: String(url), label: n ? `PR #${n}` : "PR" };
  });
  const remote = w.remote_display_target
    ? { target: w.remote_display_target, state: w.remote_connection_state ?? null }
    : null;
  return {
    path: tildify(w.current_directory ?? w.root_path ?? null),
    branch: branches[0]?.branch ?? null,
    dirty: Boolean(branches[0]?.dirty ?? branches[0]?.is_dirty),
    prs,
    ports: (w.listening_ports ?? []).map(Number).filter(Boolean),
    notification: w.latest_notification_text ?? null,
    remote,
  };
}

/** The workspace id a sidebar event is about: its args carry "--tab=<id>". */
export function eventWorkspace(ev) {
  return ev.workspace_id ?? String(ev.payload?.args ?? "").match(/--tab=([0-9A-Fa-f-]{36})/)?.[1] ?? null;
}
