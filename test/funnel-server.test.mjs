// Tests for funnel/server.mjs — the Node deployment of the leaderboard funnel.
//
// Two halves:
//   1. the pure bits — config resolution (fails closed, never echoes a value)
//      and the client-IP rules (the rate limit must key on the address the
//      trusted proxy saw, never on anything a submitter can forge).
//   2. an end-to-end run of the REAL server on an ephemeral loopback port,
//      driving the real handler against an in-memory stand-in for the database.
//      The one outbound call (the mail API) is stubbed at the fetch boundary, so
//      no test ever touches the network or the real project — the only sockets
//      opened are to our own server.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  resolveConfig,
  normalizeIp,
  rightmostXff,
  clientIpFrom,
  createFunnelServer,
  REQUIRED_ENV,
  DEFAULT_PORT,
  BIND_HOST,
} from "../funnel/server.mjs";
import { CLIENT_IP_HEADER, MAX_BODY_BYTES } from "../funnel/handler.mjs";

// Key-shaped, assembled from fragments so the repo's own secret scan stays green.
const FAKE_KEY = ["re", "_", "test", "_", "NOTAREALKEY000"].join("");
const FAKE_ADMIN_TOKEN = ["test", "-", "admin", "-", "token"].join("");
const MAIL_ENDPOINT = "https://api.resend.com/emails";

function goodStats(overrides = {}) {
  return {
    total_coins: 4215,
    dollars: 1053.75,
    swears_per_day: 12.4,
    top_word: "f**k",
    fbomb_pct: 38,
    active_days: 340,
    app_version: "0.1.0",
    release_hash: "cd15e0b",
    ...overrides,
  };
}

// ── the mail stub: the ONE outbound call, intercepted ────────────────────────
const mails = [];
const REAL_FETCH = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : String(input?.url ?? input);
  if (url.startsWith("https://api.resend.com/")) {
    mails.push({ url, headers: init?.headers || {}, body: JSON.parse(init?.body || "{}") });
    return new Response(JSON.stringify({ id: "stub-message-id" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return REAL_FETCH(input, init); // loopback only — our own ephemeral server
};
after(() => {
  globalThis.fetch = REAL_FETCH;
});

const FAKE_SERVICE_KEY = ["service", "_", "role", "_", "NOTAREALKEY000"].join("");

const BASE_ENV = {
  MAIL_FROM: "jar@example.org",
  PUBLIC_HOST: "swearjar.example",
  ALLOWED_ORIGIN: "https://swearjar.example",
  RESEND_API_KEY: FAKE_KEY,
  ADMIN_TOKEN: FAKE_ADMIN_TOKEN,
  KNOWN_RELEASES: "cd15e0b",
  SUPABASE_URL: "https://db.example.test",
  SUPABASE_SERVICE_KEY: FAKE_SERVICE_KEY,
};

// ── the database stand-in ────────────────────────────────────────────────────
// An in-memory implementation of funnel/db.mjs's surface, so these tests drive
// the REAL server and the REAL handler without a database (or a network). It
// mirrors the rules the real schema enforces, so the assertions below are about
// the funnel's behaviour rather than about this fake:
//   * takePending is one atomic take: expired or already-taken -> nothing.
//   * bumpRateLimit returns the count AFTER this hit.
//   * listBoard projects the `board` VIEW — email/join_list are structurally
//     absent from it, exactly as in funnel/schema.sql.
//   * an entry is keyed by email, and is hidden (never destroyed).
// The exact request shapes the real client sends are covered in funnel-db.test.mjs.

// The `board` view's projection, mirrored from funnel/schema.sql.
const boardProjection = (r) => ({
  handle: r.handle,
  total_coins: Number(r.stats?.total_coins ?? 0),
  dollars: Number(r.stats?.dollars ?? 0),
  swears_per_day: Number(r.stats?.swears_per_day ?? 0),
  fbomb_pct: Number(r.stats?.fbomb_pct ?? 0),
  active_days: Number(r.stats?.active_days ?? 0),
  top_word: r.stats?.top_word ?? "",
  app_version: r.app_version ?? "",
  verified: r.verified === true,
  submitted: String(r.confirmed_at ?? "").slice(0, 10),
});

function createMemoryDb({ now = () => Date.now() } = {}) {
  const pending = new Map();
  const entries = new Map();
  const limits = new Map();
  const live = () => [...entries.values()].filter((r) => r.deleted_at == null);

  return {
    entries, // exposed for assertions only
    async putPending({ token, email, handle, stats, join_list, release_hash, app_version, ttlSeconds }) {
      pending.set(token, {
        token, email, handle, stats,
        join_list: join_list === true,
        release_hash: release_hash ?? null,
        app_version: app_version ?? null,
        expires_at: now() + ttlSeconds * 1000,
      });
    },
    // DELETE … WHERE token = ? AND expires_at > now RETURNING *
    async takePending(token) {
      const row = pending.get(token);
      if (!row) return null; // unknown, or already consumed
      pending.delete(token); // single-use, whatever happens next
      return row.expires_at > now() ? row : null; // expiry enforced on read
    },
    async upsertEntry({ email, handle, stats, join_list, verified, release_hash, app_version }) {
      entries.set(email, {
        email, handle, stats,
        join_list: join_list === true,
        verified: verified === true,
        release_hash: release_hash ?? null,
        app_version: app_version ?? null,
        confirmed_at: new Date(now()).toISOString(),
        deleted_at: null, deleted_by: null, deletion_reason: null, // restores a hidden row
      });
    },
    async listBoard({ limit = 100 } = {}) {
      return live()
        .map(boardProjection)
        .sort((a, b) => b.total_coins - a.total_coins)
        .slice(0, limit);
    },
    async listEntriesForExport() {
      return live().map((r) => ({
        email: r.email, handle: r.handle, join_list: r.join_list, confirmed_at: r.confirmed_at, stats: r.stats,
      }));
    },
    async bumpRateLimit(key, ttlSeconds) {
      const cur = limits.get(key);
      if (!cur || cur.expires_at <= now()) {
        limits.set(key, { count: 1, expires_at: now() + ttlSeconds * 1000 });
        return 1;
      }
      cur.count += 1;
      return cur.count;
    },
    async sweep() {
      for (const [k, v] of pending) if (v.expires_at <= now()) pending.delete(k);
      for (const [k, v] of limits) if (v.expires_at <= now()) limits.delete(k);
    },
    async softDeleteEntry(email, actor, reason) {
      const row = entries.get(email);
      if (row && row.deleted_at == null) {
        row.deleted_at = new Date(now()).toISOString();
        row.deleted_by = actor;
        row.deletion_reason = reason;
      }
    },
  };
}

// Spin the real server up on an ephemeral port with a fresh in-memory database.
async function withServer(fn, { env = {}, trustProxy = true, now } = {}) {
  const db = createMemoryDb({ now });
  const server = createFunnelServer({ env: { ...BASE_ENV, ...env }, db, trustProxy });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  mails.length = 0;
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, db });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const submit = (base, { xff, body, headers = {} } = {}) =>
  fetch(base + "/api/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(xff ? { "X-Forwarded-For": xff } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const goodBody = (email, extra = {}) => ({
  email,
  join_list: false,
  handle: "Potty Mouth",
  stats: goodStats(),
  ...extra,
});

// ── config: fail closed ──────────────────────────────────────────────────────
test("resolveConfig refuses to start without every required variable, naming them", () => {
  const r = resolveConfig({});
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.sort(), [...REQUIRED_ENV].sort(), "every required variable is named");
  // The database credentials are required: without them there is nowhere to put
  // a submission, so starting would only fail later, on a real person's click.
  assert.ok(r.missing.includes("SUPABASE_URL") && r.missing.includes("SUPABASE_SERVICE_KEY"));

  const partial = resolveConfig({ ...BASE_ENV, RESEND_API_KEY: "", ADMIN_TOKEN: "   ", SUPABASE_SERVICE_KEY: "" });
  assert.equal(partial.ok, false);
  assert.deepEqual(
    partial.missing.sort(),
    ["ADMIN_TOKEN", "RESEND_API_KEY", "SUPABASE_SERVICE_KEY"],
    "blank counts as missing"
  );
  // The failure report is NAMES only — a value must never ride along.
  assert.ok(!JSON.stringify(partial).includes(FAKE_KEY));
  assert.ok(!JSON.stringify(partial).includes(FAKE_ADMIN_TOKEN));
  assert.ok(!JSON.stringify(partial).includes(FAKE_SERVICE_KEY), "never echoes the database key");
});

test("resolveConfig refuses a malformed database URL, naming it and nothing else", () => {
  // A typo here would otherwise start fine and fail on a submitter's first click.
  for (const bad of ["not-a-url", "db.example.test", "ftp://db.example.test", "://x"]) {
    const r = resolveConfig({ ...BASE_ENV, SUPABASE_URL: bad });
    assert.equal(r.ok, false, `${bad} must not start the service`);
    assert.deepEqual(r.missing, ["SUPABASE_URL"], "the NAME is the whole message");
    assert.ok(!JSON.stringify(r).includes(bad), "not even a bad value is echoed");
  }
  assert.equal(resolveConfig({ ...BASE_ENV, SUPABASE_URL: "https://db.example.test" }).ok, true);
});

test("resolveConfig hands the database credentials to the client, NOT to the handler's env", () => {
  const r = resolveConfig(BASE_ENV);
  assert.equal(r.ok, true);
  assert.deepEqual(r.db, { url: "https://db.example.test", serviceKey: FAKE_SERVICE_KEY });
  // The service-role key bypasses RLS, so no route may be able to reach it: it
  // goes to createDb and is closed over there, never into the handler's env.
  assert.ok(!("SUPABASE_SERVICE_KEY" in r.env), "the key is not in the handler's env");
  assert.ok(!JSON.stringify(r.env).includes(FAKE_SERVICE_KEY), "and not under any other name");
});

test("resolveConfig defaults ALLOWED_ORIGIN to the page's own origin (same-origin deploy)", () => {
  const r = resolveConfig({ ...BASE_ENV, ALLOWED_ORIGIN: "" });
  assert.equal(r.ok, true);
  assert.equal(r.env.ALLOWED_ORIGIN, "https://swearjar.example");
  assert.notEqual(r.env.ALLOWED_ORIGIN, "*", "never a wildcard");
});

test("resolveConfig defaults the port and proxy trust", () => {
  const r = resolveConfig(BASE_ENV);
  assert.equal(r.port, DEFAULT_PORT, "8788 — what the Caddy vhost proxies to");
  assert.equal(BIND_HOST, "127.0.0.1", "loopback only: Caddy is the only client");
  assert.equal(r.trustProxy, true);
  assert.equal(resolveConfig({ ...BASE_ENV, PORT: "9001" }).port, 9001);
  assert.equal(resolveConfig({ ...BASE_ENV, PORT: "not-a-port" }).port, DEFAULT_PORT);
  assert.equal(resolveConfig({ ...BASE_ENV, TRUST_PROXY: "0" }).trustProxy, false);
});

test("resolveConfig passes the optional vars through only when set", () => {
  const bare = resolveConfig({ ...BASE_ENV, KNOWN_RELEASES: "" });
  assert.ok(!("THANKS_URL" in bare.env), "unset = absent, so the handler's default applies");
  assert.ok(!("KNOWN_RELEASES" in bare.env));

  const full = resolveConfig({ ...BASE_ENV, THANKS_URL: "https://x.example/ta" });
  assert.equal(full.env.THANKS_URL, "https://x.example/ta");
  assert.equal(full.env.KNOWN_RELEASES, "cd15e0b");
});

// ── the client IP ────────────────────────────────────────────────────────────
test("rightmostXff takes the proxy-appended entry, never the spoofable leftmost", () => {
  // Each hop APPENDS the peer it saw, so the last entry is the one the trusted
  // proxy added — the only one a client cannot forge.
  assert.equal(rightmostXff("203.0.113.9"), "203.0.113.9");
  assert.equal(rightmostXff("1.1.1.1, 203.0.113.9"), "203.0.113.9", "spoofed leftmost ignored");
  assert.equal(rightmostXff("evil, 10.0.0.1 , 203.0.113.9"), "203.0.113.9");
  assert.equal(rightmostXff(""), "");
  assert.equal(rightmostXff(undefined), "");
});

test("normalizeIp strips ports and unwraps IPv4-mapped IPv6", () => {
  assert.equal(normalizeIp("203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeIp("203.0.113.9:51234"), "203.0.113.9", "port is not part of the bucket");
  assert.equal(normalizeIp("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(normalizeIp("[2001:db8::1]:443"), "2001:db8::1");
  assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1", "a bare v6 is left alone");
  assert.equal(normalizeIp(undefined), "");
});

test("clientIpFrom prefers the trusted proxy header and falls back to the socket peer", () => {
  const req = (headers, remoteAddress = "::ffff:127.0.0.1") => ({ headers, socket: { remoteAddress } });
  assert.equal(clientIpFrom(req({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" })), "203.0.113.9");
  assert.equal(clientIpFrom(req({})), "127.0.0.1", "no header -> the peer we can see");
  // Trust off (direct exposure): the header is ignored outright.
  assert.equal(clientIpFrom(req({ "x-forwarded-for": "203.0.113.9" }), false), "127.0.0.1");
  assert.equal(clientIpFrom({ headers: {}, socket: {} }), "0.0.0.0", "never undefined");
});

// ── end-to-end: the real server ──────────────────────────────────────────────
test("the server runs the whole submit -> confirm -> board flow, mail stubbed", async () => {
  await withServer(async ({ base }) => {
    const res = await submit(base, { xff: "203.0.113.9", body: goodBody("Jar.Fan@Example.org", { join_list: true }) });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, message: "check your email" });

    // Exactly ONE mail, to the submitter, authorized with the server-side key.
    assert.equal(mails.length, 1, "one confirmation mail, no more");
    assert.equal(mails[0].url, MAIL_ENDPOINT);
    assert.deepEqual(mails[0].body.to, ["jar.fan@example.org"], "normalized address");
    assert.equal(mails[0].headers.Authorization, `Bearer ${FAKE_KEY}`);

    // Nothing is on the board yet — publication waits for the click.
    const before = await (await fetch(base + "/api/board.json")).json();
    assert.deepEqual(before.board, [], "double opt-in: unconfirmed is unpublished");

    // Redeem the single-use token from the intercepted mail.
    const token = /token=([0-9a-f-]+)/i.exec(mails[0].body.text)[1];
    const confirm = await fetch(`${base}/api/confirm?token=${token}`, { redirect: "manual" });
    assert.equal(confirm.status, 302);
    assert.equal(confirm.headers.get("location"), "https://swearjar.example/thanks");

    const board = await fetch(base + "/api/board.json");
    assert.equal(board.headers.get("cache-control"), "public, max-age=300");
    const body = await board.json();
    assert.equal(body.board.length, 1);
    assert.equal(body.board[0].handle, "Potty Mouth");
    assert.equal(body.board[0].total_coins, 4215);
    assert.equal(body.board[0].verified, true, "release_hash is in KNOWN_RELEASES");
    // THE privacy boundary, proven through the real transport.
    const raw = JSON.stringify(body);
    assert.ok(!raw.includes("jar.fan@example.org"), "the email never reaches the board");
    assert.ok(!raw.includes("join_list"));

    // The token is single-use: a replayed click is a generic 400.
    const replay = await fetch(`${base}/api/confirm?token=${token}`, { redirect: "manual" });
    assert.equal(replay.status, 400);
    assert.equal(mails.length, 1, "confirming never sends more mail");
  });
});

test("a re-submit updates the same person's row instead of duplicating it", async () => {
  await withServer(async ({ base }) => {
    for (const coins of [100, 999]) {
      await submit(base, {
        xff: "203.0.113.11",
        body: { ...goodBody("dup@example.org"), stats: goodStats({ total_coins: coins }) },
      });
      const token = /token=([0-9a-f-]+)/i.exec(mails.at(-1).body.text)[1];
      await fetch(`${base}/api/confirm?token=${token}`, { redirect: "manual" });
    }
    const { board } = await (await fetch(base + "/api/board.json")).json();
    assert.equal(board.length, 1, "one row per verified human");
    assert.equal(board[0].total_coins, 999, "the newer numbers win");
  });
});

test("an EXPIRED confirmation link cannot be redeemed, sweep or no sweep", async () => {
  // The 48h expiry is enforced when the token is redeemed — the pending row is
  // matched only while expires_at is still in the future — so a stale link is
  // dead the moment it expires, whether or not anything has swept it.
  let clock = Date.UTC(2026, 6, 10, 12, 0, 0);
  await withServer(
    async ({ base }) => {
      await submit(base, { xff: "203.0.113.40", body: goodBody("slow@example.org") });
      const token = /token=([0-9a-f-]+)/i.exec(mails[0].body.text)[1];

      clock += 48 * 3600 * 1000 + 1000; // the link is now one second stale
      const late = await fetch(`${base}/api/confirm?token=${token}`, { redirect: "manual" });
      assert.equal(late.status, 400, "an expired token is refused");
      assert.deepEqual(await late.json(), { ok: false, error: "bad request" }, "generic — no hint that it expired");

      const { board } = await (await fetch(base + "/api/board.json")).json();
      assert.deepEqual(board, [], "and nothing was published");
    },
    { now: () => clock }
  );
});

test("a confirmation link still works right up to its expiry", async () => {
  // The other side of the boundary: the redemption window is the full 48h.
  let clock = Date.UTC(2026, 6, 10, 12, 0, 0);
  await withServer(
    async ({ base }) => {
      await submit(base, { xff: "203.0.113.41", body: goodBody("justintime@example.org") });
      const token = /token=([0-9a-f-]+)/i.exec(mails[0].body.text)[1];

      clock += 48 * 3600 * 1000 - 1000; // one second to spare
      const ok = await fetch(`${base}/api/confirm?token=${token}`, { redirect: "manual" });
      assert.equal(ok.status, 302);
      const { board } = await (await fetch(base + "/api/board.json")).json();
      assert.equal(board.length, 1, "published");
    },
    { now: () => clock }
  );
});

test("a hidden entry leaves the board, and re-confirming puts the person back", async () => {
  await withServer(async ({ base, db }) => {
    const confirmOnce = async (ip) => {
      await submit(base, { xff: ip, body: goodBody("back@example.org") });
      const token = /token=([0-9a-f-]+)/i.exec(mails.at(-1).body.text)[1];
      await fetch(`${base}/api/confirm?token=${token}`, { redirect: "manual" });
    };
    await confirmOnce("203.0.113.42");
    assert.equal((await (await fetch(base + "/api/board.json")).json()).board.length, 1);

    // Hiding is the ONLY supported removal: the row stays, marked with who/why.
    await db.softDeleteEntry("back@example.org", "operator", "requested removal");
    assert.deepEqual(
      (await (await fetch(base + "/api/board.json")).json()).board,
      [],
      "a hidden row is off the public board"
    );
    assert.ok(db.entries.get("back@example.org"), "but the customer row itself is never destroyed");

    // Submitting again is a person choosing to be listed again — it restores them.
    await confirmOnce("203.0.113.43");
    const { board } = await (await fetch(base + "/api/board.json")).json();
    assert.equal(board.length, 1, "re-confirming un-hides the row");
    const row = db.entries.get("back@example.org");
    assert.equal(row.deleted_at, null);
    assert.equal(row.deleted_by, null, "no stale actor on a live row");
    assert.equal(row.deletion_reason, null, "no stale reason on a live row");
  });
});

test("a database failure is a generic 500 that says nothing, and never mails", async () => {
  // Fail closed: a broken database must not leak its errors, and must not let a
  // submission through un-counted.
  await withServer(async ({ base, db }) => {
    db.bumpRateLimit = async () => {
      throw new Error(`connect ECONNREFUSED https://db.example.test key ${FAKE_SERVICE_KEY}`);
    };
    const res = await submit(base, { xff: "203.0.113.44", body: goodBody("boom@example.org") });
    assert.equal(res.status, 500);
    const dump = (await res.text()) + JSON.stringify([...res.headers]);
    assert.deepEqual(JSON.parse(dump.split("[")[0] || "{}"), { ok: false, error: "server error" }, "generic body");
    assert.ok(!dump.includes(FAKE_SERVICE_KEY), "no key");
    assert.ok(!dump.includes("ECONNREFUSED"), "no stack, no internal state");
    assert.equal(mails.length, 0, "a submission that could not be rate-limited is never mailed");
  });
});

test("invalid submissions are rejected generically and never send mail", async () => {
  await withServer(async ({ base }) => {
    const bad = await submit(base, { xff: "203.0.113.12", body: goodBody("not-an-email") });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "invalid submission");

    const uncensored = await submit(base, {
      xff: "203.0.113.13",
      body: { ...goodBody("a@b.co"), stats: goodStats({ top_word: "fuck" }) },
    });
    assert.equal(uncensored.status, 400);
    assert.ok(
      (await uncensored.json()).details.some((d) => d.startsWith("top_word")),
      "the censored-word rule is enforced server-side"
    );

    const overCap = await submit(base, {
      xff: "203.0.113.14",
      body: { ...goodBody("a@b.co"), stats: goodStats({ total_coins: 999_999_999 }) },
    });
    assert.equal(overCap.status, 400);

    const malformed = await submit(base, { xff: "203.0.113.15", body: "{not json" });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { ok: false, error: "bad request" }, "no stack, no state");

    assert.equal(mails.length, 0, "a rejected submission never mails");
  });
});

test("an oversized body is refused (413) before it is parsed", async () => {
  await withServer(async ({ base }) => {
    // Declared oversize: content-length alone is enough to refuse it.
    const padded = JSON.stringify({ ...goodBody("a@b.co"), pad: "x".repeat(MAX_BODY_BYTES) });
    assert.ok(padded.length > MAX_BODY_BYTES);
    const res = await submit(base, { xff: "203.0.113.16", body: padded });
    assert.equal(res.status, 413);
    assert.equal(mails.length, 0);
  });
});

test("the body cap is enforced on arriving bytes, not just the declared length", async () => {
  await withServer(async ({ base }) => {
    // A chunked body carries NO content-length, so only the streaming cap can
    // stop it. Sent in one shot so the client is done writing before the refusal.
    const port = Number(new URL(base).port);
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, method: "POST", path: "/api/submit", headers: { "Content-Type": "application/json" } },
        (r) => {
          let data = "";
          r.on("data", (d) => (data += d));
          r.on("end", () => resolve({ status: r.statusCode, body: data }));
        }
      );
      req.on("error", reject);
      req.write("x".repeat(MAX_BODY_BYTES * 2)); // no content-length -> chunked
      req.end();
    });
    assert.equal(res.status, 413, "the cap trips on the bytes themselves");
    assert.equal(mails.length, 0);
  });
});

// ── abuse posture, through the real transport ────────────────────────────────
test("the per-IP rate limit keys on the proxy-appended address, not a spoofed one", async () => {
  await withServer(async ({ base }) => {
    // 5/hour per IP. The spoofed leftmost changes every time; the real
    // (rightmost) address does not — so the bucket must still fill.
    for (let i = 0; i < 5; i++) {
      const r = await submit(base, { xff: `10.0.0.${i}, 198.51.100.7`, body: goodBody(`fan${i}@example.org`) });
      assert.equal(r.status, 200, `submission ${i + 1} of 5 is allowed`);
    }
    const sixth = await submit(base, { xff: "10.0.0.99, 198.51.100.7", body: goodBody("fan9@example.org") });
    assert.equal(sixth.status, 429, "the 6th from the same real client is limited");
    assert.equal((await sixth.json()).error, "rate limited — try again later");

    // A different real client is unaffected.
    const other = await submit(base, { xff: "10.0.0.0, 198.51.100.8", body: goodBody("other@example.org") });
    assert.equal(other.status, 200);
    assert.equal(mails.length, 6, "only the allowed submissions mailed");
  });
});

test("a client cannot buy a fresh rate-limit bucket with its own client-IP header", async () => {
  await withServer(async ({ base }) => {
    // The handler reads the internal client-IP header; the server DROPS any
    // inbound copy and re-sets it from the trusted proxy value. So a client
    // sending it — in any casing — must change nothing.
    const spoof = (i) => ({ [CLIENT_IP_HEADER.toUpperCase()]: `1.2.3.${i}`, "X-Real-IP": `4.5.6.${i}` });
    for (let i = 0; i < 5; i++) {
      const r = await submit(base, {
        xff: "198.51.100.20",
        headers: spoof(i),
        body: goodBody(`spoof${i}@example.org`),
      });
      assert.equal(r.status, 200);
    }
    const sixth = await submit(base, {
      xff: "198.51.100.20",
      headers: spoof(99),
      body: goodBody("spoof9@example.org"),
    });
    assert.equal(sixth.status, 429, "the forged header cannot reset the bucket");
  });
});

test("the per-email rate limit holds across different IPs", async () => {
  await withServer(async ({ base }) => {
    for (let i = 0; i < 3; i++) {
      const r = await submit(base, { xff: `198.51.100.${100 + i}`, body: goodBody("same@example.org") });
      assert.equal(r.status, 200, `submission ${i + 1} of 3 for this email`);
    }
    const fourth = await submit(base, { xff: "198.51.100.200", body: goodBody("same@example.org") });
    assert.equal(fourth.status, 429, "3/day per email, whatever IP it comes from");
  });
});

// ── admin + routing ──────────────────────────────────────────────────────────
test("export.csv is token-gated and carries the list data only for the admin", async () => {
  await withServer(async ({ base }) => {
    for (const headers of [{}, { Authorization: "Bearer wrong-token" }, { Authorization: "not-a-bearer" }]) {
      const res = await fetch(base + "/api/export.csv", { headers });
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { ok: false, error: "unauthorized" }, "generic — no hint");
    }
    const ok = await fetch(base + "/api/export.csv", { headers: { Authorization: `Bearer ${FAKE_ADMIN_TOKEN}` } });
    assert.equal(ok.status, 200);
    assert.match(ok.headers.get("content-type"), /text\/csv/);
    assert.match(await ok.text(), /^email,handle,join_list,confirmed_at,total_coins,app_version/);
  });
});

test("health is a database-free liveness probe, and unknown routes 404", async () => {
  await withServer(async ({ base }) => {
    const health = await fetch(base + "/api/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "swear-jar-funnel" });

    for (const p of ["/api/nope", "/", "/api/submit"]) {
      assert.equal((await fetch(base + p)).status, 404, `GET ${p} is not a route`);
    }
  });
});

test("CORS answers the preflight with the one allowed origin, never a wildcard", async () => {
  await withServer(async ({ base }) => {
    const pre = await fetch(base + "/api/submit", { method: "OPTIONS" });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "https://swearjar.example");
    assert.equal(pre.headers.get("vary"), "Origin");

    // Same-origin config (the real deployment) still answers correctly.
    const board = await fetch(base + "/api/board.json");
    assert.equal(board.headers.get("access-control-allow-origin"), "https://swearjar.example");
    assert.equal(board.headers.get("x-content-type-options"), "nosniff");
  });
});

test("no secret ever appears in a response body or header", async () => {
  await withServer(async ({ base }) => {
    await submit(base, { xff: "203.0.113.30", body: goodBody("leak@example.org") });
    const token = /token=([0-9a-f-]+)/i.exec(mails[0].body.text)[1];
    await fetch(`${base}/api/confirm?token=${token}`, { redirect: "manual" });

    for (const p of ["/api/health", "/api/board.json", "/api/export.csv", "/api/nope"]) {
      const res = await fetch(base + p);
      const dump = (await res.text()) + JSON.stringify([...res.headers]);
      assert.ok(!dump.includes(FAKE_KEY), `${p} must not leak the mail key`);
      assert.ok(!dump.includes(FAKE_ADMIN_TOKEN), `${p} must not leak the admin token`);
      assert.ok(!dump.includes(FAKE_SERVICE_KEY), `${p} must not leak the database service key`);
      assert.ok(!dump.includes(token), `${p} must not leak a confirmation token`);
    }
  });
});
