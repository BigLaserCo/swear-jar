// Tests for the leaderboard funnel: funnel/schema.mjs (field/caps validation)
// and funnel/handler.mjs pure helpers (everything testable without a socket).
// The headline test is the privacy boundary: publicView(row) must NEVER emit
// email / join_list / IP in any form.

import test from "node:test";
import assert from "node:assert/strict";

import {
  validate,
  validateWrapped,
  encodeWrappedParams,
  decodeWrappedParams,
  isUncensoredSwear,
  CAPS,
} from "../funnel/schema.mjs";
import {
  validateRequest,
  publicView,
  rateLimitKey,
  sanitizeHandle,
  isEmail,
  normalizeEmail,
  constantTimeEqual,
  verifiedFlag,
  MAX_BODY_BYTES,
  HANDLE_MAX,
} from "../funnel/handler.mjs";

// A fully valid stats payload (top_word censored, as the app submits it).
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

// ── schema: valid payloads ────────────────────────────────────────────────────
test("schema accepts a fully valid payload", () => {
  const r = validate(goodStats());
  assert.equal(r.ok, true);
  assert.equal(r.value.total_coins, 4215);
  assert.equal(r.value.top_word, "f**k");
  assert.equal(r.value.release_hash, "cd15e0b");
});

test("schema coerces numeric strings and drops unknown fields", () => {
  const r = validate(goodStats({ total_coins: "100", extra_field: "nope" }));
  assert.equal(r.ok, true);
  assert.equal(r.value.total_coins, 100);
  assert.ok(!("extra_field" in r.value), "unknown fields are dropped");
});

// ── schema: caps ─────────────────────────────────────────────────────────────
test("schema rejects every cap breach", () => {
  const breaches = [
    ["total_coins", CAPS.total_coins + 1],
    ["dollars", CAPS.dollars + 1],
    ["swears_per_day", CAPS.swears_per_day + 1],
    ["fbomb_pct", CAPS.fbomb_pct + 1],
    ["active_days", CAPS.active_days + 1],
  ];
  for (const [field, val] of breaches) {
    const r = validate(goodStats({ [field]: val }));
    assert.equal(r.ok, false, `${field} over cap must be rejected`);
    assert.ok(r.errors.some((e) => e.startsWith(field)), `error names ${field}`);
  }
});

test("schema rejects negatives, NaN, Infinity, and non-integer counts", () => {
  for (const bad of [-1, NaN, Infinity, "abc"]) {
    assert.equal(validate(goodStats({ total_coins: bad })).ok, false, `total_coins=${bad}`);
  }
  assert.equal(validate(goodStats({ total_coins: 3.5 })).ok, false, "non-integer coin count");
  assert.equal(validate(goodStats({ active_days: 1.5 })).ok, false, "non-integer active_days");
});

test("schema rejects non-object payloads", () => {
  for (const bad of [null, undefined, [], "x", 42]) {
    assert.equal(validate(bad).ok, false);
  }
});

// ── schema: enum + version + hash ────────────────────────────────────────────
test("schema drops agent type from the public payload", () => {
  const r = validate(goodStats({ agent: "claude" }));
  assert.equal(r.ok, true);
  assert.ok(!("agent" in r.value));
});

test("schema validates app_version and release_hash shapes", () => {
  assert.equal(validate(goodStats({ app_version: "not-a-version" })).ok, false);
  assert.equal(validate(goodStats({ app_version: "0.1.0-beta.1" })).ok, true);
  assert.equal(validate(goodStats({ release_hash: "xyz" })).ok, false);
  assert.equal(validate(goodStats({ release_hash: "g".repeat(40) })).ok, false, "non-hex");
  assert.equal(validate(goodStats({ release_hash: "A1B2C3D" })).ok, true, "hex, any case");
});

// ── schema: the censored-word gate ───────────────────────────────────────────
test("uncensored top_word is rejected; censored forms pass", () => {
  for (const raw of ["fuck", "shit", "FUCK", "fucking", "motherfucker", "damn", "asshole"]) {
    const r = validate(goodStats({ top_word: raw }));
    assert.equal(r.ok, false, `uncensored "${raw}" must be rejected`);
    assert.ok(r.errors.some((e) => e.startsWith("top_word")), "error names top_word");
  }
  for (const censored of ["f**k", "s**t", "f***ing", "d**n", "m**********r"]) {
    assert.equal(validate(goodStats({ top_word: censored })).ok, true, `censored "${censored}" passes`);
  }
  assert.equal(isUncensoredSwear("f**k"), false);
  assert.equal(isUncensoredSwear("fuuuck"), true, "elongations still caught");
});

test("top_word is required and length-capped", () => {
  assert.equal(validate(goodStats({ top_word: "" })).ok, false);
  assert.equal(validate(goodStats({ top_word: "x".repeat(CAPS.top_word_len + 1) })).ok, false);
});

// ── milestone-3: the wrapped payload schema + wire codec ──────────────────────
// The hosted-page contract: the base submit fields PLUS the report aggregates,
// all schema-capped. `families` keys must already be censored.
function goodWrapped(overrides = {}) {
  return {
    ...goodStats(),
    families: { "f__k": 120, "s__t": 88, "d__n": 40 },
    by_hour: new Array(24).fill(1),
    by_dow: new Array(7).fill(2),
    user_vs_machine: [300, 40],
    odds: 31,
    streak_days: 12,
    ...overrides,
  };
}

test("validateWrapped accepts a full payload and drops unknown fields", () => {
  const r = validateWrapped(goodWrapped({ project: "leak-me", cwd: "/home/dev", by_day: [1, 2, 3] }));
  assert.equal(r.ok, true, r.errors?.join("; "));
  assert.equal(r.value.odds, 31);
  assert.equal(r.value.by_hour.length, 24);
  assert.deepEqual(r.value.user_vs_machine, [300, 40]);
  assert.ok(!("project" in r.value) && !("cwd" in r.value) && !("by_day" in r.value), "unknowns dropped");
});

test("validateWrapped rejects a wrong-length or non-integer distribution", () => {
  assert.equal(validateWrapped(goodWrapped({ by_hour: new Array(23).fill(0) })).ok, false);
  assert.equal(validateWrapped(goodWrapped({ by_dow: new Array(7).fill(1.5) })).ok, false);
  assert.equal(validateWrapped(goodWrapped({ user_vs_machine: [1] })).ok, false);
  assert.equal(validateWrapped(goodWrapped({ user_vs_machine: [-1, 2] })).ok, false);
});

test("validateWrapped rejects an uncensored family key and an over-12 family map", () => {
  assert.equal(validateWrapped(goodWrapped({ families: { fuck: 3 } })).ok, false, "raw key rejected");
  assert.equal(validateWrapped(goodWrapped({ families: { shit: 3 } })).ok, false);
  const thirteen = {};
  for (let i = 0; i < 13; i++) thirteen[`w${i}_z`] = i + 1;
  assert.equal(validateWrapped(goodWrapped({ families: thirteen })).ok, false, ">12 families rejected");
});

test("validateWrapped caps odds and streak_days", () => {
  assert.equal(validateWrapped(goodWrapped({ odds: CAPS.odds + 1 })).ok, false);
  assert.equal(validateWrapped(goodWrapped({ odds: 12.5 })).ok, false, "odds is an integer %");
  assert.equal(validateWrapped(goodWrapped({ streak_days: CAPS.streak_days + 1 })).ok, false);
  assert.equal(validateWrapped(goodWrapped({ streak_days: -1 })).ok, false);
});

test("validateWrapped fails when the base submit fields fail", () => {
  const r = validateWrapped(goodWrapped({ top_word: "fuck" }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.startsWith("top_word")));
});

test("encodeWrappedParams -> decodeWrappedParams -> validateWrapped round-trips", () => {
  const value = validateWrapped(goodWrapped()).value;
  const round = validateWrapped(decodeWrappedParams(encodeWrappedParams(value)));
  assert.equal(round.ok, true, round.errors?.join("; "));
  assert.deepEqual(round.value, value);
});

test("the wire format is compact and uses no percent-encoding for a normal payload", () => {
  const q = encodeWrappedParams(validateWrapped(goodWrapped()).value);
  assert.ok(!q.includes("%"), `expected no percent-encoding, got: ${q}`);
  assert.ok(q.length < 1100, `wire query is ${q.length} chars (budget ~1.1KB)`);
});

// ── worker: email checks ─────────────────────────────────────────────────────
test("isEmail accepts real shapes, rejects junk", () => {
  for (const good of ["a@b.co", "jar.fan+tag@example.org", "X@SUB.DOMAIN.NET"]) {
    assert.equal(isEmail(good), true, good);
  }
  for (const bad of ["", "nope", "a@b", "a b@c.com", "a@b.", "@x.com", "a@@b.com", 42, null]) {
    assert.equal(isEmail(bad), false, String(bad));
  }
});

test("normalizeEmail lowercases and trims", () => {
  assert.equal(normalizeEmail("  Jar.Fan@Example.ORG "), "jar.fan@example.org");
});

// ── worker: handle sanitization (injection surface) ──────────────────────────
test("sanitizeHandle strips HTML/injection chars and caps length", () => {
  assert.equal(sanitizeHandle("<script>alert(1)</script>"), "scriptalert1script");
  assert.equal(sanitizeHandle('"; DROP TABLE users; --'), "DROP TABLE users --");
  assert.equal(sanitizeHandle("nice_name-42"), "nice_name-42");
  assert.equal(sanitizeHandle("a".repeat(100)).length <= HANDLE_MAX, true);
  assert.equal(sanitizeHandle(" ‮<>&'`$(){}"), "anonymous", "all-junk -> fallback");
  assert.equal(sanitizeHandle(""), "anonymous");
  assert.equal(sanitizeHandle(null), "anonymous");
  // nothing outside the allowed alphabet survives
  assert.match(sanitizeHandle("é🙂<b>bold</b> name"), /^[a-zA-Z0-9_ -]+$/);
});

// ── worker: request validation + body cap ────────────────────────────────────
test("validateRequest accepts a good submission", () => {
  const r = validateRequest({
    email: "Jar.Fan@Example.org",
    join_list: true,
    handle: "Potty Mouth",
    stats: goodStats(),
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.email, "jar.fan@example.org");
  assert.equal(r.value.join_list, true);
  assert.equal(r.value.handle, "Potty Mouth");
});

test("validateRequest rejects bad email / bad stats / non-object bodies", () => {
  assert.equal(validateRequest({ email: "nope", stats: goodStats() }).ok, false);
  assert.equal(validateRequest({ email: "a@b.co", stats: { total_coins: -1 } }).ok, false);
  assert.equal(validateRequest(null).ok, false);
  assert.equal(validateRequest([]).ok, false);
  assert.equal(validateRequest("x").ok, false);
});

test("join_list is strictly boolean-true opt-in (no truthy coercion)", () => {
  for (const notOptedIn of [undefined, null, false, "true", 1, "yes"]) {
    const r = validateRequest({ email: "a@b.co", join_list: notOptedIn, stats: goodStats() });
    assert.equal(r.ok, true);
    assert.equal(r.value.join_list, false, `join_list=${String(notOptedIn)} must NOT opt in`);
  }
});

test("an oversized body would exceed MAX_BODY_BYTES (cap is sane)", () => {
  // The worker rejects bodies > MAX_BODY_BYTES before parsing. A normal
  // submission is far under it; a padded one is over it.
  const normal = JSON.stringify({ email: "a@b.co", join_list: false, handle: "x", stats: goodStats() });
  assert.ok(normal.length < MAX_BODY_BYTES, "a real submission fits comfortably");
  const padded = JSON.stringify({ email: "a@b.co", stats: goodStats(), pad: "x".repeat(MAX_BODY_BYTES) });
  assert.ok(padded.length > MAX_BODY_BYTES, "a padded body trips the cap");
});

// ── worker: rate-limit keys ──────────────────────────────────────────────────
test("rateLimitKey buckets by hour (ip) and day (email), deterministically", () => {
  const t = Date.UTC(2026, 6, 10, 12, 30, 0);
  assert.equal(rateLimitKey("ip", "1.2.3.4", t), rateLimitKey("ip", "1.2.3.4", t + 60_000));
  assert.notEqual(rateLimitKey("ip", "1.2.3.4", t), rateLimitKey("ip", "1.2.3.4", t + 3_600_000));
  assert.equal(rateLimitKey("email", "a@b.co", t), rateLimitKey("email", "a@b.co", t + 3_600_000));
  assert.notEqual(rateLimitKey("email", "a@b.co", t), rateLimitKey("email", "a@b.co", t + 86_400_000));
  assert.notEqual(rateLimitKey("ip", "1.2.3.4", t), rateLimitKey("ip", "5.6.7.8", t));
});

// ── worker: admin token compare ──────────────────────────────────────────────
test("constantTimeEqual compares correctly", async () => {
  assert.equal(await constantTimeEqual("secret-token", "secret-token"), true);
  assert.equal(await constantTimeEqual("secret-token", "secret-tokeN"), false);
  assert.equal(await constantTimeEqual("", ""), true);
  assert.equal(await constantTimeEqual("a", "ab"), false);
});

// ── worker: verified flag ────────────────────────────────────────────────────
test("verifiedFlag matches the known-releases allow-list, case-insensitively", () => {
  assert.equal(verifiedFlag("cd15e0b", "cd15e0b,a1b2c3d"), true);
  assert.equal(verifiedFlag("CD15E0B", " cd15e0b , a1b2c3d "), true);
  assert.equal(verifiedFlag("deadbee", "cd15e0b"), false);
  assert.equal(verifiedFlag("cd15e0b", ""), false);
  assert.equal(verifiedFlag("cd15e0b", undefined), false);
});

// ── THE PRIVACY-CRITICAL TEST ────────────────────────────────────────────────
// publicView reads rows from the `board` view, which already excludes email by
// construction (funnel/schema.sql). This tests the SECOND wall: even handed a
// row carrying forbidden fields — a widened view, a wrong query, a future
// refactor pointing this at the entries table — publicView must emit the public
// field set and nothing else.
test("publicView NEVER contains email, join_list, or IP — in keys or values", () => {
  const fullRow = {
    // the board view's real columns
    handle: "Potty Mouth",
    total_coins: 4215,
    dollars: 1053.75,
    swears_per_day: 12.4,
    top_word: "f**k",
    fbomb_pct: 38,
    active_days: 340,
    app_version: "0.1.0",
    verified: true,
    submitted: "2026-07-10",
    // fields that must never survive, whatever hands them over
    email: "leak.me@example.org",
    join_list: true,
    ip: "203.0.113.7",
    ip_hash: "abc123iphash",
    stats: goodStats(),
    deleted_by: "operator",
    deletion_reason: "requested removal",
  };
  const pub = publicView(fullRow);

  // 1. Forbidden KEYS are absent.
  for (const forbidden of ["email", "join_list", "ip", "ip_hash", "deleted_by", "deletion_reason"]) {
    assert.ok(!(forbidden in pub), `public row must not carry key "${forbidden}"`);
  }

  // 2. Forbidden VALUES are absent from the serialized row (catches renamed keys).
  const s = JSON.stringify(pub);
  assert.ok(!s.includes("leak.me@example.org"), "email value must not leak");
  assert.ok(!s.includes("203.0.113.7"), "IP value must not leak");
  assert.ok(!s.includes("abc123iphash"), "IP hash must not leak");
  assert.ok(!s.includes("join_list"), "join_list must not leak");
  assert.ok(!s.includes("operator") && !s.includes("requested removal"), "soft-delete bookkeeping must not leak");

  // 3. Exactly the public-safe field set, nothing else.
  assert.deepEqual(
    Object.keys(pub).sort(),
    [
      "active_days",
      "app_version",
      "dollars",
      "fbomb_pct",
      "handle",
      "submitted",
      "swears_per_day",
      "top_word",
      "total_coins",
      "verified",
    ],
    "public field set is exactly the allow-list"
  );

  // 4. The public fields are correct.
  assert.equal(pub.handle, "Potty Mouth");
  assert.equal(pub.total_coins, 4215);
  assert.equal(pub.dollars, 1053.75);
  assert.equal(pub.verified, true);
  assert.equal(pub.submitted, "2026-07-10", "date only, no timestamp precision");
});

test("publicView truncates a full timestamp to a date, whatever it is handed", () => {
  // The view hands back a date already; this holds the promise anyway.
  assert.equal(publicView({ submitted: "2026-07-10T12:34:56.789Z" }).submitted, "2026-07-10");
});

test("publicView coerces the numbers it publishes and is safe on malformed/empty rows", () => {
  for (const row of [null, undefined, {}, { stats: null }, { total_coins: null }, { total_coins: "not-a-number" }]) {
    const pub = publicView(row);
    assert.equal(pub.handle, "anonymous");
    assert.equal(pub.total_coins, 0, "a missing/garbage number publishes as 0, never NaN or null");
    assert.equal(pub.verified, false, "verified is opt-in: only a literal true");
    assert.ok(!("email" in pub) && !("join_list" in pub) && !("ip" in pub));
    assert.ok(!JSON.stringify(pub).includes("null"), "no nulls on the public board");
  }
  // A numeric string from the wire is published as a number.
  assert.equal(publicView({ total_coins: "4215" }).total_coins, 4215);
  assert.equal(publicView({ verified: "true" }).verified, false, "no truthy coercion on verified");
});
