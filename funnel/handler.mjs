// swear-jar leaderboard funnel — the API: routing, validation, abuse limits.
//
// Submissions to the public leaderboard REQUIRE a validated email (double
// opt-in); an OPTIONAL "join the mailing list" checkbox is the funnel. This is
// SERVER code — it is not part of the shipped app, ships nothing to a user's
// machine, and lives outside src//bin/ on purpose (the repo CI gate enforces
// zero network in the app itself; a submission server is the one sanctioned
// network surface, and Resend is its one sanctioned outbound call).
//
// handleRequest(request, env) takes a Fetch Request and returns a Fetch
// Response. funnel/server.mjs listens on a socket and calls it; that split
// keeps every rule here, in one testable place, with no transport in the way.
//
// Routes:
//   POST /api/submit       validate + rate-limit + store PENDING + send ONE
//                          confirmation email via the Resend REST API
//   GET  /api/confirm      token (single-use) -> CONFIRMED, 302 to thanks page
//   GET  /api/board.json   public board — confirmed rows, public-safe fields ONLY
//   GET  /api/export.csv   admin-only (Bearer ADMIN_TOKEN) — mailing-list export
//
// `env` (assembled by funnel/server.mjs from the process environment):
//   DB              the database (funnel/db.mjs) — pending rows, confirmed
//                   entries, rate counters. NB: the database's service key is
//                   NOT here; it is closed over inside the client, so no route
//                   below can reach it.
//   MAIL_FROM       confirmation-mail from address
//   PUBLIC_HOST     host used in confirm links + thanks redirect
//   ALLOWED_ORIGIN  the ONE origin allowed to POST (the submit page's origin)
//   THANKS_URL      optional override for the post-confirm redirect
//   KNOWN_RELEASES  optional comma-separated release hashes -> verified flag
//   RESEND_API_KEY  server-side only; never exposed, never logged
//   ADMIN_TOKEN     gates /api/export.csv
//
// Posture: fail-closed (unexpected error -> generic 400/500, never a stack),
// JSON-only, strict CORS, hard 4KB body cap, per-IP + per-email rate limits,
// no email/PII in console output, no PII in board.json — ever.

import { validate as validateStats } from "./schema.mjs";

// ── limits ────────────────────────────────────────────────────────────────────
export const MAX_BODY_BYTES = 4096; // hard request-body cap
export const IP_LIMIT_PER_HOUR = 5; // POST /api/submit per IP
export const EMAIL_LIMIT_PER_DAY = 3; // POST /api/submit per email
export const PENDING_TTL_S = 48 * 60 * 60; // pending token lives 48h
export const HANDLE_MAX = 24;
export const BOARD_LIMIT = 100; // rows /api/board.json will publish

// The header this handler reads the client IP from. It is INTERNAL: funnel/
// server.mjs strips any inbound copy and re-sets it from the address the
// trusted proxy recorded, so a submitter can never choose their own
// rate-limit bucket. Both sides import this constant so they cannot drift.
export const CLIENT_IP_HEADER = "x-swearjar-client-ip";

// ── pure helpers (exported for tests — no server or socket needed) ───────────

// Display names: strip everything outside [a-zA-Z0-9_ -], collapse whitespace,
// cap length. HTML/injection chars simply cannot survive this alphabet.
export function sanitizeHandle(s) {
  const cleaned = String(s ?? "")
    .replace(/[^a-zA-Z0-9_ -]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, HANDLE_MAX)
    .trim();
  return cleaned || "anonymous";
}

// Pragmatic email shape check (one @, a dot in the domain, no spaces/CTLs).
export function isEmail(s) {
  if (typeof s !== "string") return false;
  const v = s.trim();
  if (v.length < 6 || v.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export function normalizeEmail(s) {
  return String(s ?? "").trim().toLowerCase();
}

// Rate-counter keys, bucketed so the TTL and the window agree.
export function rateLimitKey(kind, id, now = Date.now()) {
  if (kind === "ip") return `rl:ip:${id}:${Math.floor(now / 3_600_000)}`; // hour bucket
  return `rl:em:${id}:${Math.floor(now / 86_400_000)}`; // day bucket
}

// Constant-time-ish token compare: hash both sides, compare digests fully.
export async function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(String(a ?? ""))),
    crypto.subtle.digest("SHA-256", enc.encode(String(b ?? ""))),
  ]);
  const xa = new Uint8Array(da);
  const xb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ xb[i];
  return diff === 0;
}

export function verifiedFlag(releaseHash, knownList) {
  const known = String(knownList || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return known.includes(String(releaseHash || "").toLowerCase());
}

// Validate a parsed /api/submit body -> {ok, value|errors}. Pure.
export function validateRequest(body) {
  const errors = [];
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["body must be a JSON object"] };
  }
  if (!isEmail(body.email)) errors.push("email: invalid");
  const stats = validateStats(body.stats);
  if (!stats.ok) errors.push(...stats.errors);
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      email: normalizeEmail(body.email),
      join_list: body.join_list === true, // anything but literal true is false
      handle: sanitizeHandle(body.handle),
      stats: stats.value,
    },
  };
}

// THE privacy boundary. Everything /api/board.json emits goes through here.
// Public-safe fields ONLY: handle, the stats numbers, verified flag, submitted
// date. NEVER email, NEVER join_list, NEVER IP (or any hash of it).
//
// The rows fed to this come from the `board` view, which already exposes only
// publishable columns — email is structurally absent from it, so a leak would
// have to get past the database first. This is the SECOND allow-list, not the
// only one: it re-states the public field set in the code that serializes it, so
// the API's shape is pinned here even if the view is ever widened. Both layers
// are cheap; a public board that leaks an email once is not.
const publicNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export function publicView(row) {
  return {
    handle: String(row?.handle || "anonymous"),
    total_coins: publicNumber(row?.total_coins),
    dollars: publicNumber(row?.dollars),
    swears_per_day: publicNumber(row?.swears_per_day),
    top_word: String(row?.top_word || ""),
    fbomb_pct: publicNumber(row?.fbomb_pct),
    active_days: publicNumber(row?.active_days),
    app_version: String(row?.app_version || ""),
    verified: row?.verified === true,
    submitted: String(row?.submitted || "").slice(0, 10), // date only
  };
}

// ── response helpers ─────────────────────────────────────────────────────────
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

function json(env, status, obj, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(env),
      ...extra,
    },
  });
}

const GENERIC_400 = { ok: false, error: "bad request" };
const GENERIC_401 = { ok: false, error: "unauthorized" };
const GENERIC_404 = { ok: false, error: "not found" };
const GENERIC_429 = { ok: false, error: "rate limited — try again later" };
const GENERIC_500 = { ok: false, error: "server error" };

// ── rate limiting ────────────────────────────────────────────────────────────
// One round trip: the database bumps the counter and hands back the count AFTER
// this hit, so two concurrent submissions can never both read the same count and
// each think they are under the limit. Returns false when this hit is over.
// A database failure THROWS rather than returning false — which the entry point
// turns into a 500, so a broken counter refuses submissions rather than waving
// them through.
async function bumpCounter(env, key, limit, ttlSeconds) {
  const count = await env.DB.bumpRateLimit(key, ttlSeconds);
  return count <= limit;
}

// ── the one sanctioned outbound call: Resend REST API ────────────────────────
// (Hosted email service; the key is a server-side secret. Nothing else in this
// service — or anywhere in the repo — makes an outbound request.)
async function sendConfirmEmail(env, email, token) {
  const confirmUrl = `https://${env.PUBLIC_HOST}/api/confirm?token=${encodeURIComponent(token)}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [email],
      subject: "Confirm your swear-jar leaderboard entry",
      text:
        "You (or someone with your email) submitted a score to the swear-jar " +
        "public leaderboard.\n\n" +
        `Confirm it here: ${confirmUrl}\n\n` +
        "The link expires in 48 hours. If this wasn't you, ignore this email " +
        "and nothing will be published.",
    }),
  });
  return res.ok;
}

// ── route handlers ───────────────────────────────────────────────────────────
async function handleSubmit(request, env) {
  // Hard body cap — check the header AND the actual bytes read.
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) return json(env, 413, GENERIC_400);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json(env, 413, GENERIC_400);

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(env, 400, GENERIC_400);
  }

  const v = validateRequest(body);
  if (!v.ok) return json(env, 400, { ok: false, error: "invalid submission", details: v.errors });

  // Rate limits: per-IP (5/hour) then per-email (3/day). Fail closed.
  const ip = request.headers.get(CLIENT_IP_HEADER) || "0.0.0.0";
  if (!(await bumpCounter(env, rateLimitKey("ip", ip), IP_LIMIT_PER_HOUR, 3600))) {
    return json(env, 429, GENERIC_429);
  }
  if (!(await bumpCounter(env, rateLimitKey("email", v.value.email), EMAIL_LIMIT_PER_DAY, 86400))) {
    return json(env, 429, GENERIC_429);
  }

  // Crypto-random single-use token: UUID + extra random suffix.
  const rand = new Uint8Array(16);
  crypto.getRandomValues(rand);
  const suffix = [...rand].map((b) => b.toString(16).padStart(2, "0")).join("");
  const token = `${crypto.randomUUID()}${suffix}`;

  await env.DB.putPending({
    token,
    email: v.value.email,
    handle: v.value.handle,
    stats: v.value.stats,
    join_list: v.value.join_list,
    release_hash: v.value.stats.release_hash,
    app_version: v.value.stats.app_version,
    ttlSeconds: PENDING_TTL_S,
  });

  const sent = await sendConfirmEmail(env, v.value.email, token);
  if (!sent) return json(env, 500, GENERIC_500);

  // Never echo internal state (no token, no email, no row).
  return json(env, 200, { ok: true, message: "check your email" });
}

async function handleConfirm(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  const thanksUrl = env.THANKS_URL || `https://${env.PUBLIC_HOST}/thanks`;

  // Token shape gate before touching the database.
  if (!/^[0-9a-f-]{36,100}$/i.test(token)) {
    return json(env, 400, GENERIC_400);
  }

  // Single-use AND unexpired, in one atomic statement: the row is returned only
  // if it was still live, and the same statement consumes it. A raced or
  // replayed second click takes nothing and falls into the generic 400 below,
  // so there is no window in which a token could be redeemed twice.
  const pending = await env.DB.takePending(token);
  if (!pending) return json(env, 400, GENERIC_400); // expired/unknown/replayed

  // Keyed by normalized email: a re-submit UPDATES the same person's entry —
  // one row per verified human, never duplicates.
  await env.DB.upsertEntry({
    email: pending.email,
    handle: pending.handle,
    stats: pending.stats,
    join_list: pending.join_list === true,
    verified: verifiedFlag(pending.stats?.release_hash, env.KNOWN_RELEASES),
    release_hash: pending.release_hash ?? pending.stats?.release_hash,
    app_version: pending.app_version ?? pending.stats?.app_version,
  });

  return new Response(null, { status: 302, headers: { Location: thanksUrl } });
}

async function handleBoard(request, env) {
  // Live rows, publishable columns, board order — all decided by the database
  // (the `board` view). publicView is still the ONLY door to the public.
  const rows = await env.DB.listBoard({ limit: BOARD_LIMIT });
  return json(env, 200, { ok: true, board: rows.map(publicView) }, {
    "Cache-Control": "public, max-age=300",
  });
}

async function handleExport(request, env) {
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m || !env.ADMIN_TOKEN || !(await constantTimeEqual(m[1], env.ADMIN_TOKEN))) {
    return json(env, 401, GENERIC_401);
  }

  const csv = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = ["email,handle,join_list,confirmed_at,total_coins,app_version"];
  for (const r of await env.DB.listEntriesForExport()) {
    lines.push(
      [
        csv(r.email),
        csv(r.handle),
        r.join_list === true ? "true" : "false",
        csv(r.confirmed_at),
        Number(r.stats?.total_coins) || 0,
        csv(r.stats?.app_version),
      ].join(",")
    );
  }

  return new Response(lines.join("\n") + "\n", {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=swear-jar-confirmed.csv",
      "Cache-Control": "no-store",
    },
  });
}

// ── the entry point ──────────────────────────────────────────────────────────
// Request in, Response out. Every route above is reachable only through here.
export async function handleRequest(request, env) {
  try {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }
    if (request.method === "POST" && path === "/api/submit") {
      return await handleSubmit(request, env);
    }
    if (request.method === "GET" && path === "/api/confirm") {
      return await handleConfirm(request, env);
    }
    if (request.method === "GET" && path === "/api/board.json") {
      return await handleBoard(request, env);
    }
    if (request.method === "GET" && path === "/api/export.csv") {
      return await handleExport(request, env);
    }
    return json(env, 404, GENERIC_404);
  } catch {
    // Fail closed: generic body, no stack, no state. (No console logging of
    // request contents anywhere — emails/IPs never reach the logs.)
    return json(env, 500, GENERIC_500);
  }
}
