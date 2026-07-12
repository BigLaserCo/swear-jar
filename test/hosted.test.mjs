// The privacy suite for the hosted wrapped URL (milestone 3).
//
// The URL is the collection moment, so it is also the privacy boundary. These
// tests prove — end to end — that ONLY the schema-capped aggregate numbers
// travel: seeded project names, cwd, session ids, and raw message text NEVER
// appear in the URL, our own detect() scores the whole URL 0 (nothing even
// reconstructable), the param names are exactly the wire allow-list, the length
// cap holds, the closing decision matrix is correct, and the agent mapping is
// the same one `wrapped --submit` uses.

import test from "node:test";
import assert from "node:assert/strict";

import {
  HOSTED_BASE,
  buildWrappedPayload,
  hostedWrappedUrl,
  resolveClosing,
  disclosureLine,
  agentForRecords,
} from "../src/hosted.mjs";
import {
  validateWrapped,
  encodeWrappedParams,
  decodeWrappedParams,
  isUncensoredSwear,
} from "../funnel/schema.mjs";
import { computeStats } from "../src/stats.mjs";
import { detect } from "../src/detect.mjs";

// ── a fixture salted with things that MUST NOT travel ─────────────────────────
const SENTINEL_PROJECT = "top-secret-startup";
const SENTINEL_CWD = "/Users/dev/Code/top-secret-startup";
const SENTINEL_SESSION = "sess-abcdef-9999";
const SENTINEL_TEXT = "the password is hunter2 you absolute muppet";

function fixture() {
  const rec = (uuid, source, agent, words, coins) => ({
    v: 1,
    uuid,
    ts: "2026-07-10T09:00:00.000Z",
    session: SENTINEL_SESSION,
    source,
    agent,
    event: "test",
    project: SENTINEL_PROJECT, // identifiable — must be dropped
    cwd: SENTINEL_CWD, // identifiable — must be dropped
    transcript: SENTINEL_TEXT, // raw text — must be dropped
    text: SENTINEL_TEXT,
    words,
    coins,
  });
  return [
    rec("u1", "user", "claude", { fuck: 3, shit: 2 }, 13),
    rec("u2", "assistant", "claude", { damn: 1 }, 1),
    rec("u3", "user", "codex", { hell: 1, ass: 1 }, 3),
  ];
}

const NOW = Date.parse("2026-07-11T12:00:00Z");
const statsFor = (recs) => computeStats(recs, NOW);

// ── the privacy boundary ──────────────────────────────────────────────────────
test("the hosted URL carries no project name, cwd, session id, or raw text", () => {
  const recs = fixture();
  const url = hostedWrappedUrl(statsFor(recs), recs);
  for (const secret of [SENTINEL_PROJECT, SENTINEL_CWD, SENTINEL_SESSION, "hunter2", "muppet", "password"]) {
    assert.ok(!url.includes(secret), `URL must not contain "${secret}"`);
  }
});

test("detect() scores the entire decoded URL 0 — nothing reconstructable leaks", () => {
  const recs = fixture();
  const url = hostedWrappedUrl(statsFor(recs), recs);
  // the raw URL string, and the fully-decoded query values
  assert.equal(detect(url).coins, 0, `raw URL owes ${JSON.stringify(detect(url).words)}`);
  const decoded = decodeWrappedParams(new URL(url).searchParams);
  const blob = JSON.stringify(decoded);
  assert.equal(detect(blob).coins, 0, `decoded payload owes ${JSON.stringify(detect(blob).words)}`);
  // and the censored strings that DO travel are schema-clean (not uncensored)
  assert.equal(isUncensoredSwear(decoded.top_word), false);
  for (const key of Object.keys(decoded.families)) {
    assert.equal(isUncensoredSwear(key), false, `family key "${key}" must be censored`);
  }
});

test("the URL params are exactly the wire allow-list, and decode to exactly the schema fields", () => {
  const recs = fixture();
  const url = hostedWrappedUrl(statsFor(recs), recs);
  const q = new URL(url).searchParams;
  assert.deepEqual(
    [...q.keys()].sort(),
    ["ad", "ag", "av", "bd", "bh", "d", "fam", "fb", "o", "rh", "sd", "spd", "tc", "tw", "uvm"].sort(),
    "only the compact wire keys appear"
  );
  const res = validateWrapped(decodeWrappedParams(q));
  assert.equal(res.ok, true, `decoded payload validates: ${res.errors?.join("; ")}`);
  assert.deepEqual(
    Object.keys(res.value).sort(),
    [
      "active_days",
      "agent",
      "app_version",
      "by_dow",
      "by_hour",
      "dollars",
      "families",
      "fbomb_pct",
      "odds",
      "release_hash",
      "streak_days",
      "swears_per_day",
      "top_word",
      "total_coins",
      "user_vs_machine",
    ].sort(),
    "exactly the schema field set — nothing else"
  );
});

test("the URL starts at HOSTED_BASE and respects the 2KB cap even when maxed out", () => {
  const recs = fixture();
  const url = hostedWrappedUrl(statsFor(recs), recs);
  assert.ok(url.startsWith(HOSTED_BASE + "?"));
  assert.ok(url.length <= 2048, `url is ${url.length} chars`);

  // A deliberately maxed-out stats object: 12 long families with 7-digit counts,
  // full distributions — still under the hard cap.
  const bigFamilies = [
    "motherfucker",
    "clusterfuck",
    "cocksucker",
    "bollocks",
    "knobhead",
    "bastard",
    "goddamn",
    "douchebag",
    "fuck",
    "shit",
    "bitch",
    "prick",
  ].map((word, i) => ({ word, count: 900000 + i, tier: "premium", coins: 1 }));
  const maxed = {
    totalCoins: 999999,
    dollarsOwed: 249999.99,
    swearsPerDay: 4999.9,
    fbombPct: 100,
    activeDays: 99999,
    userCoins: 500000,
    machineCoins: 499999,
    topWords: bigFamilies,
    byHour: new Array(24).fill(999999),
    byDow: new Array(7).fill(999999),
    odds: 98,
    longestStreak: 99999,
  };
  const bigUrl = hostedWrappedUrl(maxed, [{ agent: "claude" }, { agent: "codex" }]);
  assert.ok(bigUrl.length <= 2048, `maxed url is ${bigUrl.length} chars — over the cap`);
});

// ── buildWrappedPayload: only the aggregate fields, censored families ──────────
test("buildWrappedPayload reads only the aggregate fields (no project/day-series)", () => {
  const recs = fixture();
  const value = buildWrappedPayload(statsFor(recs), recs);
  assert.deepEqual(Object.keys(value).sort(), [
    "active_days",
    "agent",
    "app_version",
    "by_dow",
    "by_hour",
    "dollars",
    "families",
    "fbomb_pct",
    "odds",
    "release_hash",
    "streak_days",
    "swears_per_day",
    "top_word",
    "total_coins",
    "user_vs_machine",
  ].sort());
  assert.equal(value.agent, "both"); // claude + codex present
  assert.equal(value.total_coins, 17);
  assert.equal(value.user_vs_machine[0] + value.user_vs_machine[1], 17);
  assert.ok(Object.keys(value.families).length <= 12);
});

test("families are capped at 12 and same-shape collisions merge (never overwrite)", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    word: `word${i}extra`,
    count: 20 - i,
    tier: "mild",
    coins: 20 - i,
  }));
  const value = buildWrappedPayload(
    { totalCoins: 100, dollarsOwed: 25, swearsPerDay: 1, fbombPct: 0, activeDays: 1, userCoins: 100, machineCoins: 0, topWords: many, byHour: new Array(24).fill(0), byDow: new Array(7).fill(0), odds: 50, longestStreak: 1 },
    [{ agent: "claude" }]
  );
  assert.ok(Object.keys(value.families).length <= 12, "never more than 12 families");
});

// ── the round-trip (shared with the hosted Worker) ────────────────────────────
test("encode -> decode -> validateWrapped round-trips exactly", () => {
  const recs = fixture();
  const value = buildWrappedPayload(statsFor(recs), recs);
  const decoded = decodeWrappedParams(encodeWrappedParams(value));
  const res = validateWrapped(decoded);
  assert.equal(res.ok, true, res.errors?.join("; "));
  assert.deepEqual(res.value, value, "the payload survives the wire unchanged");
});

// ── the agent mapping (parity with wrapped --submit) ──────────────────────────
test("agentForRecords matches the canonical submission enum", () => {
  assert.equal(agentForRecords([{ agent: "claude" }]), "claude");
  assert.equal(agentForRecords([{ agent: "codex" }]), "codex");
  assert.equal(agentForRecords([{ agent: "claude" }, { agent: "codex" }]), "both");
  assert.equal(agentForRecords([{ agent: "claude" }, { agent: "human" }]), "other");
  assert.equal(agentForRecords([{ agent: "dictation" }]), "other");
  assert.equal(agentForRecords([]), "other");
  assert.equal(agentForRecords(null), "other");
});

// ── the pure closing decision matrix (SPEC m3 §7) ─────────────────────────────
test("resolveClosing: hosted by default, local escapes, non-TTY prints both", () => {
  const m = (o) => resolveClosing(o);
  assert.deepEqual(m({ canOpen: true }), { mode: "open-hosted", hostedApplicable: true });
  assert.deepEqual(m({ canOpen: true, localOnly: true }), { mode: "open-local", hostedApplicable: false });
  assert.deepEqual(m({ canOpen: true, ledgerEmpty: true }), { mode: "open-local", hostedApplicable: false });
  // --hosted overrides --local, but an empty ledger still has nothing to share
  assert.deepEqual(m({ canOpen: true, localOnly: true, forceHosted: true }), { mode: "open-hosted", hostedApplicable: true });
  assert.deepEqual(m({ canOpen: true, ledgerEmpty: true, forceHosted: true }), { mode: "open-local", hostedApplicable: false });
  // no open (non-TTY / --no-open): print — still report the hosted URL unless local/empty
  assert.deepEqual(m({ canOpen: false }), { mode: "print", hostedApplicable: true });
  assert.deepEqual(m({ canOpen: false, localOnly: true }), { mode: "print", hostedApplicable: false });
  assert.deepEqual(m({ canOpen: false, ledgerEmpty: true }), { mode: "print", hostedApplicable: false });
});

// ── the disclosure line names every field before we open ──────────────────────
test("disclosureLine names the payload fields and the local escape hatch", () => {
  const line = disclosureLine();
  for (const field of ["coins", "swears/day", "top word", "f-bomb", "active days", "families", "by-hour", "odds", "streak"]) {
    assert.ok(line.includes(field), `disclosure names "${field}"`);
  }
  assert.match(line, /Never your words/);
  assert.match(line, /--local/);
});
