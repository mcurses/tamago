// Local HTTP endpoint for the compiled sidebar (extension/). The extension runs in the macOS App
// Sandbox, so it can neither read Tama's state files nor reach the cmux socket; it talks to this
// server on 127.0.0.1 instead. Requests must carry the token baked into the extension at build time.
//
//   GET  /state   -> { pet, bubble, workspaces: { <id>: { color, description } } }
//   POST /action  { type, ... } -> { ok: true } | { ok: false, error }

import http from "node:http";
import crypto from "node:crypto";

const MAX_BODY = 16 * 1024;

export function startServer({ port, token, getState, act, log }) {
  const expected = Buffer.from(token);
  const authorized = (req) => {
    const got = Buffer.from(String(req.headers["x-tamago-token"] ?? ""));
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  };
  const reply = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    if (!authorized(req)) return reply(res, 403, { ok: false, error: "bad token" });
    if (req.method === "GET" && req.url === "/state") return reply(res, 200, getState());
    if (req.method !== "POST" || req.url !== "/action") return reply(res, 404, { ok: false, error: "not found" });
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy();
    });
    req.on("end", async () => {
      try {
        await act(JSON.parse(body));
        reply(res, 200, { ok: true });
      } catch (err) {
        log("sidebar action failed:", err.message?.split("\n")[0]);
        reply(res, 400, { ok: false, error: String(err.message ?? err).split("\n")[0] });
      }
    });
  });
  server.on("error", (err) => log("sidebar server failed:", err.message));
  server.listen(port, "127.0.0.1", () => log(`sidebar server on 127.0.0.1:${port}`));
  return server;
}
