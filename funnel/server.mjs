#!/usr/bin/env node
// swear-jar leaderboard funnel — the Node deployment entrypoint.
//
// THE DEPLOYMENT: a plain node:http service on any Linux host with systemd +
// Caddy. It binds LOOPBACK ONLY (127.0.0.1); Caddy terminates TLS on the public
// host and reverse-proxies /api/* to it. Zero dependencies, Node stdlib only.
//
// This file owns the socket, not the rules. The routes, validation, rate
// limits, CORS, token compare and the one outbound Resend call all live in
// funnel/handler.mjs, which is written against the Fetch API (Request in,
// Response out). This module translates node:http <-> Fetch, assembles the
// handler's `env` (the row store from funnel/store.mjs, plus config), and
// determines the client IP the rate limits key on.
//
// Routes are the handler's (POST /api/submit, GET /api/confirm, GET
// /api/board.json, GET /api/export.csv) plus GET /api/health, a store-free
// liveness probe answered here for the deploy script.
//
// Config comes from the process environment (systemd EnvironmentFile — see
// funnel/README.md). Startup FAILS CLOSED naming any missing required variable;
// values are never printed, logged, or echoed in a response.

import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { handleRequest, CLIENT_IP_HEADER, MAX_BODY_BYTES } from "./handler.mjs";
import { createStore, SWEEP_INTERVAL_MS } from "./store.mjs";

// Loopback ONLY. Caddy is the only thing that may reach this process; nothing
// else on the network can, which is what makes the proxy header trustworthy.
export const BIND_HOST = "127.0.0.1";
export const DEFAULT_PORT = 8788;

// Missing any of these = refuse to start. (THANKS_URL / KNOWN_RELEASES /
// ALLOWED_ORIGIN are optional: the handler and resolveConfig default them.)
export const REQUIRED_ENV = ["MAIL_FROM", "PUBLIC_HOST", "RESEND_API_KEY", "ADMIN_TOKEN"];

const GENERIC_400 = { ok: false, error: "bad request" };
const GENERIC_500 = { ok: false, error: "server error" };

// Hop-by-hop + length headers must not be copied onto the Fetch Request (the
// Request recomputes length; the rest are connection-scoped). The client-IP
// headers are dropped DELIBERATELY: they are attacker-controlled, and this
// module re-sets the one the handler reads from the trusted proxy value below.
const DROP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "content-length",
  CLIENT_IP_HEADER,
  "x-real-ip",
  "x-forwarded-for",
]);

const TOO_BIG = Symbol("body-too-big");
const BAD_BODY = Symbol("body-error");

// ── config ───────────────────────────────────────────────────────────────────
// resolveConfig(env) -> { ok:true, env, port, dataDir, trustProxy } | { ok:false, missing }
// Pure: no I/O, no process.exit — so it is unit-testable and the caller decides
// how to fail. `missing` carries NAMES only, never values.
export function resolveConfig(source = process.env) {
  const read = (k) => String(source[k] ?? "").trim();
  const missing = REQUIRED_ENV.filter((k) => !read(k));
  if (missing.length) return { ok: false, missing };

  const publicHost = read("PUBLIC_HOST");
  // The pages and the API are SAME-ORIGIN in this deployment (the submit page
  // and /api/* are both served by Caddy on PUBLIC_HOST), so the sensible
  // default allowed origin is that same origin. A same-origin POST is not a
  // CORS request at all — the browser never checks the header — but sending the
  // exact origin keeps the answer correct if the page is ever hosted apart from
  // the API, and never widens the allow-list (it is one origin, never "*").
  const allowedOrigin = read("ALLOWED_ORIGIN") || `https://${publicHost}`;

  const env = {
    MAIL_FROM: read("MAIL_FROM"),
    PUBLIC_HOST: publicHost,
    ALLOWED_ORIGIN: allowedOrigin,
    RESEND_API_KEY: read("RESEND_API_KEY"),
    ADMIN_TOKEN: read("ADMIN_TOKEN"),
  };
  // Optional passthroughs — only set when present, so the handler's own defaults
  // (THANKS_URL -> https://PUBLIC_HOST/thanks) still apply.
  if (read("THANKS_URL")) env.THANKS_URL = read("THANKS_URL");
  if (read("KNOWN_RELEASES")) env.KNOWN_RELEASES = read("KNOWN_RELEASES");

  const portRaw = Number(read("PORT") || DEFAULT_PORT);
  const port = Number.isInteger(portRaw) && portRaw >= 0 && portRaw <= 65535 ? portRaw : DEFAULT_PORT;

  return {
    ok: true,
    env,
    port,
    dataDir: path.resolve(read("FUNNEL_DATA_DIR") || "./data"),
    // Caddy is the only client that can reach the loopback bind, so its
    // X-Forwarded-For is trustworthy by construction. TRUST_PROXY=0 turns that
    // off (direct exposure — not this deployment).
    trustProxy: read("TRUST_PROXY") !== "0",
  };
}

// ── client IP ────────────────────────────────────────────────────────────────
// Strip a port and unwrap an IPv4-mapped IPv6 address, so the rate-limit bucket
// keys on the host and not on an ephemeral port.
export function normalizeIp(raw) {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s); // [2001:db8::1]:443
  if (bracketed) s = bracketed[1];
  const v4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(s); // 1.2.3.4:5678
  if (v4WithPort) s = v4WithPort[1];
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(s); // ::ffff:1.2.3.4
  if (mapped) s = mapped[1];
  return s;
}

// X-Forwarded-For is `client, proxy1, proxy2…`: a hop that trusts the one in
// front of it APPENDS the address it received the connection from. Which entry
// is the real client therefore depends on the fronting proxy's configuration —
// and the LEFTMOST is never a safe answer, because it is simply whatever the
// original caller claimed. Trusting it is how per-IP rate limits get bypassed.
//
// Here there is exactly ONE trusted hop: only Caddy can reach the loopback bind.
// So the RIGHTMOST entry — the address Caddy itself recorded, the peer it truly
// saw — is the one entry a submitter cannot forge. It is also the correct answer
// under either Caddy posture: by default Caddy DISCARDS a client-sent
// X-Forwarded-For and sets a single real value (its own anti-spoofing), and if
// it is ever configured to trust a proxy in front of it, it preserves that chain
// and appends. Rightmost is Caddy's own value either way — so this does not
// depend on how the proxy is configured, which is the point.
export function rightmostXff(value) {
  const parts = String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? normalizeIp(parts[parts.length - 1]) : "";
}

// The client IP the handler rate-limits on. Falls back to the socket peer when
// the header is absent or proxy trust is off.
export function clientIpFrom(req, trustProxy = true) {
  if (trustProxy) {
    const header = req?.headers?.["x-forwarded-for"];
    const ip = rightmostXff(Array.isArray(header) ? header.join(",") : header);
    if (ip) return ip;
  }
  return normalizeIp(req?.socket?.remoteAddress) || "0.0.0.0";
}

// ── node:http -> Fetch ───────────────────────────────────────────────────────
// Read the body with a HARD cap, enforced on the bytes as they arrive — before
// any parsing, and without ever buffering more than the cap. An over-cap request
// stops being read the moment it crosses the line: we stop accumulating, leave
// the stream paused and answer 413 + `Connection: close`, so the response still
// reaches the client and the socket is torn down instead of drained.
export function readBodyCapped(req, limit = MAX_BODY_BYTES) {
  const method = String(req.method || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return Promise.resolve(null);

  // An honest oversize upload announces itself — reject it without reading.
  const declared = Number(req.headers?.["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > limit) return Promise.resolve(TOO_BIG);

  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    const done = (value) => {
      if (settled) return;
      settled = true;
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onError);
      resolve(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.pause(); // stop reading; the 413 below closes the connection
        done(TOO_BIG);
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => done(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0));
    const onError = () => done(BAD_BODY);

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onError);
  });
}

function toFetchRequest(req, url, body, clientIp) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers || {})) {
    const key = String(name).toLowerCase();
    if (DROP_HEADERS.has(key) || value == null) continue;
    try {
      headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    } catch {
      /* an unparseable header is simply not forwarded */
    }
  }
  // The handler reads the client IP from this internal header, and only this
  // module sets it — from the trusted proxy value. Any inbound copy was dropped
  // above, so a client cannot spoof its own rate-limit bucket.
  headers.set(CLIENT_IP_HEADER, clientIp);

  const init = { method: req.method, headers };
  if (body && body.length) init.body = body;
  return new Request(url, init);
}

async function writeFetchResponse(res, response) {
  const headers = {};
  for (const [name, value] of response.headers) headers[name] = value;
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(body);
}

// JSON replies this module answers itself (health / 413 / 500). Mirrors the
// handler's headers so every response on this service looks the same to a client.
function writeJson(res, status, env, obj, extra = {}) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": body.length,
    "Access-Control-Allow-Origin": env?.ALLOWED_ORIGIN || "",
    Vary: "Origin",
    ...extra,
  });
  res.end(body);
}

async function handleNodeRequest(req, res, env, trustProxy) {
  // Absolute URL for the handler's `new URL(request.url)`. Only the path and
  // query are read downstream; the authority is irrelevant to routing.
  const url = new URL(req.url || "/", `http://${BIND_HOST}`);

  // Liveness: no store, no mail, no secrets — just "the process is up".
  if (req.method === "GET" && url.pathname === "/api/health") {
    return writeJson(res, 200, env, { ok: true, service: "swear-jar-funnel" }, {
      "Cache-Control": "no-store",
    });
  }

  const body = await readBodyCapped(req);
  if (body === TOO_BIG) {
    return writeJson(res, 413, env, GENERIC_400, { Connection: "close" });
  }
  if (body === BAD_BODY) return writeJson(res, 400, env, GENERIC_400);

  const response = await handleRequest(toFetchRequest(req, url, body, clientIpFrom(req, trustProxy)), env);
  await writeFetchResponse(res, response);
}

// createFunnelServer({ env, store, trustProxy }) -> http.Server (not listening).
// Exported so tests can drive the real server on an ephemeral port.
export function createFunnelServer({ env, store, trustProxy = true }) {
  const handlerEnv = { ...env, STORE: store }; // the handler reads rows via env.STORE
  return http.createServer((req, res) => {
    handleNodeRequest(req, res, handlerEnv, trustProxy).catch(() => {
      // Fail closed, exactly like the handler: generic body, no stack, no state,
      // and nothing about the request in the logs.
      if (res.headersSent) res.end();
      else writeJson(res, 500, handlerEnv, GENERIC_500);
    });
  });
}

// ── startup ──────────────────────────────────────────────────────────────────
export function startFromEnv(source = process.env, { log = console, exit = process.exit } = {}) {
  const cfg = resolveConfig(source);
  if (!cfg.ok) {
    // Names only — a missing-variable message must never echo a value.
    log.error(
      `swear-jar funnel: refusing to start — missing required environment variable(s): ${cfg.missing.join(", ")}`
    );
    log.error("Set them in the service EnvironmentFile (see funnel/README.md). Values are never printed.");
    return exit(1);
  }

  const store = createStore(cfg.dataDir);
  const server = createFunnelServer({ env: cfg.env, store, trustProxy: cfg.trustProxy });

  // Reclaim expired pending rows periodically. unref'd: it must never be the
  // reason the process stays alive.
  const sweeper = setInterval(() => {
    Promise.resolve(store.sweep()).catch(() => {});
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  const shutdown = () => {
    clearInterval(sweeper);
    server.close(() => exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  server.listen(cfg.port, BIND_HOST, () => {
    log.log(`swear-jar funnel listening on http://${BIND_HOST}:${cfg.port} — data dir ${cfg.dataDir}`);
  });
  return server;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  startFromEnv();
}
