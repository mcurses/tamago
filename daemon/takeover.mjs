// Under meum, the widget's own daemon is Tama. An older standalone daemon (node daemon/tamago.mjs,
// started by a cmux install) holding the port or the state would leave the widget without its
// daemon and run older character code, so meum's helper stops it and takes over.

import { execFileSync } from "node:child_process";

/** The command line of a running process, or null. */
export function commandOf(pid) {
  try {
    return execFileSync("/bin/ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/** A standalone Tamago daemon runs from source with node; meum's helper is a compiled binary. */
export const isStandalone = (command) => /\bdaemon\/tamago\.mjs\b/.test(command ?? "");

/** The pid listening on 127.0.0.1:<port>, or null. */
export function listenerOf(port) {
  try {
    const out = execFileSync("/usr/sbin/lsof", ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    return Number(out.trim().split("\n")[0]) || null;
  } catch {
    return null;
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Stops `pid` if it is a standalone Tamago daemon, and waits up to `waitMs` for it to exit.
 * Returns true when it was one and is gone.
 */
export async function stopStandalone(pid, { waitMs = 5000, log = () => {} } = {}) {
  if (!pid || pid === process.pid) return false;
  const command = commandOf(pid);
  if (!isStandalone(command)) return false;
  log(`stopping the standalone Tamago daemon ${pid} (${command}): meum's widget runs Tama now`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }
  for (let waited = 0; waited < waitMs && alive(pid); waited += 100) await new Promise((r) => setTimeout(r, 100));
  return !alive(pid);
}
