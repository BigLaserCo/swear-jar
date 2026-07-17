// Tests for funnel/db.mjs — the funnel's database client.
//
// The subject is the REQUEST: given a call, does the client ask PostgREST for
// exactly the right thing (method, path, filters, Prefer headers, body), and
// does it read the answer correctly? So `fetch` is stubbed at the boundary and
// every request is captured. No network, no database, no clock.
//
// The two rules that must hold under concurrency get the most attention here,
// because both are enforced by the SHAPE of the request rather than by any
// JavaScript this file could test otherwise:
//   * an expired pending token is unusable even if nothing swept it
//   * a pending token is single-use, even on a replay

import test from "node:test";
import assert from "node:assert/strict";

import { createDb, DbError, PENDING_LIVE_FILTER, SWEEP_INTERVAL_MS } from "../funnel/db.mjs";

// Key-shaped, assembled from fragments so the repo's own secret scan stays green.
const FAKE_SERVICE_KEY = ["service", "_", "role", "_", "NOTAREALKEY000"].join("");
const DB_URL = "https://db.example.test";
const REST = `${DB_URL}/rest/v1/`;
const FIXED_NOW = Date.UTC(2026, 6, 10, 12, 0, 0);
const TOKEN = "8f14e45f-ea4f-4b9a-8f2e-1c9d3b7a6e50aabbccddeeff00112233445566";

const jsonRes = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
const emptyRes = (status = 204) => new Response(null, { status });

// A db whose fetch is captured. `respond` is a response, or a function of the
// call index -> response, so a test can script a sequence (e.g. a replay).
function makeDb(respond = emptyRes()) {
  const calls = [];
  const db = createDb({
    url: DB_URL,
    serviceKey: FAKE_SERVICE_KEY,
    now: () => FIXED_NOW,
    fetch: async (url, init = {}) => {
      calls.push({
        url: String(url),
        method: init.method,
        headers: init.headers || {},
        body: init.body === undefined ? undefined : JSON.parse(init.body),
        query: new URL(String(url)).search,
        path: new URL(String(url)).pathname,
      });
      return typeof respond === "function" ? respond(calls.length - 1) : respond;
    },
  });
  return { db, calls };
}

const pendingRow = (over = {}) => ({
  token: TOKEN,
  email: "jar.fan@example.org",
  handle: "Potty Mouth",
  stats: { total_coins: 4215, top_word: "f**k", app_version: "0.1.0", release_hash: "cd15e0b" },
  join_list: true,
  release_hash: "cd15e0b",
  app_version: "0.1.0",
  expires_at: "2026-07-12T12:00:00.000Z",
  ...over,
});

// ── every request is authenticated, and the key stays inside ─────────────────
test("every request carries the service role key, and nothing else ever sees it", async () => {
  const { db, calls } = makeDb(jsonRes([]));
  await db.listBoard();

  assert.equal(calls[0].headers.apikey, FAKE_SERVICE_KEY, "the gateway reads apikey");
  assert.equal(calls[0].headers.Authorization, `Bearer ${FAKE_SERVICE_KEY}`, "PostgREST reads the bearer role");
  // The key is closed over, never a property of the client, and never in a URL.
  assert.ok(!JSON.stringify(db).includes(FAKE_SERVICE_KEY), "the client object carries no key");
  assert.ok(!calls[0].url.includes(FAKE_SERVICE_KEY), "a key never rides in a URL");
});

// ── pending: written with an expiry ──────────────────────────────────────────
test("putPending inserts an unconfirmed row that expires ttlSeconds from now", async () => {
  const { db, calls } = makeDb(emptyRes(201));
  await db.putPending({
    token: TOKEN,
    email: "jar.fan@example.org",
    handle: "Potty Mouth",
    stats: { total_coins: 4215, top_word: "f**k" },
    join_list: true,
    release_hash: "cd15e0b",
    app_version: "0.1.0",
    ttlSeconds: 48 * 60 * 60,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${REST}pending`);
  assert.equal(calls[0].headers.Prefer, "return=minimal", "no need to read the row back");
  assert.equal(calls[0].body.token, TOKEN);
  assert.equal(calls[0].body.email, "jar.fan@example.org");
  assert.equal(calls[0].body.join_list, true);
  assert.deepEqual(calls[0].body.stats, { total_coins: 4215, top_word: "f**k" });
  assert.equal(
    calls[0].body.expires_at,
    new Date(FIXED_NOW + 48 * 3600 * 1000).toISOString(),
    "expiry is written as an absolute instant, 48h out"
  );
});

test("putPending stores join_list as literal true only (no truthy coercion)", async () => {
  for (const notOptedIn of [undefined, null, false, "true", 1, "yes"]) {
    const { db, calls } = makeDb(emptyRes(201));
    await db.putPending({ token: TOKEN, email: "a@b.co", handle: "x", stats: {}, join_list: notOptedIn, ttlSeconds: 60 });
    assert.equal(calls[0].body.join_list, false, `join_list=${String(notOptedIn)} must NOT opt in`);
  }
});

// ── THE atomic redemption: expiry-on-read + single-use ───────────────────────
test("takePending redeems and consumes in ONE statement, with expiry in the filter", async () => {
  const { db, calls } = makeDb(jsonRes([pendingRow()]));
  const row = await db.takePending(TOKEN);

  assert.equal(calls.length, 1, "one round trip — no read-then-delete window");
  assert.equal(calls[0].method, "DELETE", "the read IS the delete: single-use cannot be raced");
  assert.equal(calls[0].path, "/rest/v1/pending");
  assert.equal(calls[0].headers.Prefer, "return=representation", "the deleted row comes back");

  // The exact query, pinned: the expiry predicate must be part of the DELETE.
  // An `includes` check would pass for `gt.now()` too — this asserts the bare
  // `now` form the datetime parser actually contracts to.
  assert.equal(calls[0].query, `?token=eq.${TOKEN}&expires_at=gt.now`);
  assert.equal(PENDING_LIVE_FILTER, "expires_at=gt.now");
  assert.ok(!calls[0].query.includes("now()"), "not a function call — PostgREST never evaluates one");

  assert.equal(row.email, "jar.fan@example.org", "the row is handed back");
  assert.equal(row.join_list, true);
});

test("takePending returns nothing for an EXPIRED token — even if nothing swept it", async () => {
  // The database matched zero rows because expires_at was not > now. The client
  // never sees the row, so an expired token cannot be confirmed regardless of
  // whether sweep_expired() has ever run.
  const { db, calls } = makeDb(jsonRes([]));
  assert.equal(await db.takePending(TOKEN), null);
  assert.ok(calls[0].query.includes("expires_at=gt.now"), "expiry is enforced on read, in the statement");
});

test("takePending is single-use: a replayed token gets nothing the second time", async () => {
  // First call deletes the row and returns it; the replay matches nothing.
  const { db } = makeDb((i) => (i === 0 ? jsonRes([pendingRow()]) : jsonRes([])));
  assert.ok(await db.takePending(TOKEN), "first redemption works");
  assert.equal(await db.takePending(TOKEN), null, "the replay is refused by the database");
});

test("takePending tolerates a 204 and an odd token safely", async () => {
  const { db } = makeDb(emptyRes(204));
  assert.equal(await db.takePending(TOKEN), null);

  const { db: db2, calls } = makeDb(jsonRes([]));
  await db2.takePending("a&b=c evil");
  assert.ok(!calls[0].query.includes("a&b=c evil"), "a token is encoded, never injected into the query");
  assert.ok(calls[0].query.includes("token=eq.a%26b%3Dc%20evil"));
});

// ── entries: one row per human, restored on re-confirm ───────────────────────
test("upsertEntry merges on the email primary key rather than duplicating", async () => {
  const { db, calls } = makeDb(emptyRes(201));
  await db.upsertEntry({
    email: "jar.fan@example.org",
    handle: "Potty Mouth",
    stats: { total_coins: 999 },
    join_list: true,
    verified: true,
    release_hash: "cd15e0b",
    app_version: "0.1.0",
  });

  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${REST}entries`);
  assert.equal(
    calls[0].headers.Prefer,
    "resolution=merge-duplicates,return=minimal",
    "INSERT … ON CONFLICT (email) DO UPDATE — never a second row for the same person"
  );
  assert.equal(calls[0].body.email, "jar.fan@example.org");
  assert.equal(calls[0].body.verified, true);
  assert.equal(calls[0].body.confirmed_at, new Date(FIXED_NOW).toISOString());
  assert.equal(calls[0].body.updated_at, new Date(FIXED_NOW).toISOString());
});

test("upsertEntry restores a hidden row: re-confirming clears the whole soft-delete trio", async () => {
  // Someone asked to be listed again. The trio is ONE fact — hidden, by whom,
  // why — so it clears together; a live board row must never claim it is hidden.
  const { db, calls } = makeDb(emptyRes(201));
  await db.upsertEntry({ email: "back@example.org", handle: "x", stats: {}, join_list: false, verified: false });

  assert.equal(calls[0].body.deleted_at, null, "un-hidden");
  assert.equal(calls[0].body.deleted_by, null, "no stale actor left on a live row");
  assert.equal(calls[0].body.deletion_reason, null, "no stale reason left on a live row");
  // Sent explicitly — merge-duplicates only overwrites the columns in the body,
  // so omitting these would silently leave a restored row marked deleted.
  for (const k of ["deleted_at", "deleted_by", "deletion_reason"]) {
    assert.ok(k in calls[0].body, `${k} must be in the payload to be cleared on conflict`);
  }
});

// ── the board: the database owns the allow-list ──────────────────────────────
test("listBoard reads the board VIEW, in board order, capped", async () => {
  const { db, calls } = makeDb(jsonRes([{ handle: "a", total_coins: 10 }]));
  const rows = await db.listBoard({ limit: 100 });

  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/rest/v1/board", "the view — NOT the entries table");
  assert.ok(!calls[0].path.includes("entries"), "email is not even reachable from here");
  assert.equal(calls[0].query, "?select=*&order=total_coins.desc&limit=100");
  assert.deepEqual(rows, [{ handle: "a", total_coins: 10 }]);
});

test("listBoard survives an empty board and a non-array answer", async () => {
  const { db } = makeDb(jsonRes([]));
  assert.deepEqual(await db.listBoard(), []);
  const { db: db2 } = makeDb(emptyRes(204));
  assert.deepEqual(await db2.listBoard(), []);
});

// ── the admin export: the one place an email is read ─────────────────────────
test("listEntriesForExport reads LIVE rows only, including the email", async () => {
  const { db, calls } = makeDb(jsonRes([{ email: "a@b.co", handle: "x", join_list: true, stats: {} }]));
  const rows = await db.listEntriesForExport();

  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].path, "/rest/v1/entries");
  assert.ok(calls[0].query.includes("deleted_at=is.null"), "a hidden row is not in the export");
  assert.ok(calls[0].query.includes("email"), "the admin path is the one that reads an email");
  assert.equal(rows[0].email, "a@b.co");
});

// ── rate limits: the database counts, not us ─────────────────────────────────
test("bumpRateLimit calls the atomic function and returns the count AFTER this hit", async () => {
  const { db, calls } = makeDb(jsonRes(3));
  const count = await db.bumpRateLimit("rl:ip:203.0.113.9:1", 3600);

  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${REST}rpc/bump_rate_limit`, "the SQL function — no read-modify-write in JS");
  assert.deepEqual(calls[0].body, { p_key: "rl:ip:203.0.113.9:1", p_ttl_seconds: 3600 });
  assert.equal(count, 3, "the post-hit count is what the caller compares to the limit");
});

test("bumpRateLimit FAILS CLOSED when the answer is not a number", async () => {
  // A broken counter must never read as 0 (which would be "under the limit").
  for (const bad of [jsonRes(null), jsonRes("nope"), emptyRes(204)]) {
    const { db } = makeDb(bad);
    await assert.rejects(() => db.bumpRateLimit("k", 60), DbError, "a non-numeric count throws");
  }
});

// ── housekeeping + the only supported removal ────────────────────────────────
test("sweep calls sweep_expired and tolerates a void 204", async () => {
  const { db, calls } = makeDb(emptyRes(204));
  await db.sweep();
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, `${REST}rpc/sweep_expired`);
  assert.ok(SWEEP_INTERVAL_MS > 0);
});

test("softDeleteEntry calls the function that hides a row and records who/when/why", async () => {
  const { db, calls } = makeDb(emptyRes(204));
  await db.softDeleteEntry("bye@example.org", "operator", "requested removal");
  assert.equal(calls[0].url, `${REST}rpc/soft_delete_entry`, "never a DELETE — the trigger refuses those");
  assert.deepEqual(calls[0].body, {
    p_email: "bye@example.org",
    p_actor: "operator",
    p_reason: "requested removal",
  });
});

// ── errors say nothing ───────────────────────────────────────────────────────
test("a non-2xx throws WITHOUT leaking the key, the row, the email, or the URL", async () => {
  // PostgREST echoes offending values in its error bodies, and the URL can carry
  // a live confirmation token. Neither may reach an error message.
  const leaky = new Response(
    JSON.stringify({
      code: "23505",
      message: `duplicate key value violates unique constraint — email jar.fan@example.org`,
      details: `key ${FAKE_SERVICE_KEY}`,
    }),
    { status: 409 }
  );
  const { db } = makeDb(leaky);

  await assert.rejects(
    () => db.upsertEntry({ email: "jar.fan@example.org", handle: "x", stats: {} }),
    (err) => {
      const dump = `${err.message} ${err.stack} ${JSON.stringify(err)}`;
      assert.ok(err instanceof DbError);
      assert.equal(err.status, 409);
      assert.ok(!dump.includes(FAKE_SERVICE_KEY), "no key");
      assert.ok(!dump.includes("jar.fan@example.org"), "no email");
      assert.ok(!dump.includes("duplicate key"), "no response body");
      assert.ok(!dump.includes(DB_URL), "no URL");
      assert.equal(err.message, "database entries.upsert failed (HTTP 409)", "an op label and a status, nothing else");
      return true;
    }
  );
});

test("a transport failure throws without a cause chain or a URL", async () => {
  const db = createDb({
    url: DB_URL,
    serviceKey: FAKE_SERVICE_KEY,
    fetch: async () => {
      throw new Error(`connect ECONNREFUSED ${DB_URL} with key ${FAKE_SERVICE_KEY}`);
    },
  });
  await assert.rejects(
    () => db.takePending(TOKEN),
    (err) => {
      const dump = `${err.message} ${JSON.stringify(err)}`;
      assert.ok(!dump.includes(FAKE_SERVICE_KEY) && !dump.includes(DB_URL) && !dump.includes(TOKEN));
      assert.equal(err.message, "database pending.take failed (no response)");
      return true;
    }
  );
});

test("a malformed body is a failure, not a silent empty answer", async () => {
  const { db } = makeDb(new Response("<html>gateway error</html>", { status: 200 }));
  await assert.rejects(() => db.listBoard(), DbError, "garbage must never read as an empty board");
});
