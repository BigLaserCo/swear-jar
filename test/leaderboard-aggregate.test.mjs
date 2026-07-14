import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateSubmission } from "../scripts/leaderboard/schema.mjs";
import {
  partition,
  computeBoards,
  renderLeaderboard,
  rankOnPrimaryBoard,
  DEFAULT_NOW,
} from "../scripts/leaderboard/aggregate.mjs";
import { detect } from "../src/detect.mjs";

const KNOWN = { "1111111111111111111111111111111111111111": { version: "0.1.0" } };
const base = {
  total_coins: 100,
  dollars: 25,
  swears_per_day: 5,
  fbomb_pct: 40,
  active_days: 10,
  top_word: "f**k",
  app_version: "0.1.0",
  release_hash: "1111111111111111111111111111111111111111",
};

// ── validation ────────────────────────────────────────────────────────────────
test("valid submission accepted; known release → verified", () => {
  const r = validateSubmission(base, "octocat", { releases: KNOWN });
  assert.equal(r.ok, true);
  assert.equal(r.verified, true);
  assert.equal(r.submission.handle, "octocat");
});

test("unknown-but-valid release_hash → recorded but verified:false", () => {
  const r = validateSubmission(
    { ...base, release_hash: "2222222222222222222222222222222222222222" },
    "octocat",
    { releases: KNOWN }
  );
  assert.equal(r.ok, true);
  assert.equal(r.verified, false);
});

test("missing release_hash is a HARD reject (not just unverified)", () => {
  const { release_hash, ...noHash } = base;
  const r = validateSubmission(noHash, "octocat", { releases: KNOWN });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /release_hash/);
});

test("over-cap value rejected", () => {
  const r = validateSubmission({ ...base, total_coins: 999_999_999 }, "octocat", { releases: KNOWN });
  assert.equal(r.ok, false);
});

test("missing field rejected", () => {
  const { fbomb_pct, ...missing } = base;
  assert.equal(validateSubmission(missing, "octocat", { releases: KNOWN }).ok, false);
});

test("uncensored top_word is rejected", () => {
  const r = validateSubmission({ ...base, top_word: "fuck" }, "octocat", { releases: KNOWN });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /top_word/);
});

test("bad handle (from author metadata) rejected", () => {
  assert.equal(validateSubmission(base, "not a handle!", { releases: KNOWN }).ok, false);
});

test("agent type is ignored by the public submission schema", () => {
  const r = validateSubmission({ ...base, agent: "claude" }, "octocat", { releases: KNOWN });
  assert.equal(r.ok, true);
  assert.ok(!("agent" in r.submission));
});

// ── aggregation ─────────────────────────────────────────────────────────────
// dollars derives from coins ($0.25/coin) unless overridden, so a low
// total_coins never accidentally trips the dollars>coins anomaly guard.
const S = (h, over = {}) => {
  const total_coins = over.total_coins ?? base.total_coins;
  return { ...base, handle: h, verified: true, dollars: total_coins * 0.25, ...over };
};

test("dedupe keeps a handle's highest total_coins", () => {
  const boards = computeBoards([S("dup", { total_coins: 100 }), S("dup", { total_coins: 900 })]);
  const row = boards.mostOwed.find((s) => s.handle === "dup");
  assert.equal(row.total_coins, 900);
  assert.equal(boards.mostOwed.filter((s) => s.handle === "dup").length, 1);
});

test("implausible row is held for review and excluded from ranked boards", () => {
  // 999,999 coins over 10 active days is ~100,000 coins/day — way past 200/day.
  const subs = [S("real", { total_coins: 500 }), S("faker", { swears_per_day: 9000, total_coins: 999999 })];
  const { verified, review } = partition(subs);
  assert.ok(review.some((s) => s.handle === "faker"));
  assert.ok(!verified.some((s) => s.handle === "faker"));
  assert.equal(rankOnPrimaryBoard(subs, "faker"), null);
});

// ── plausibility calibration: >=7 active days AND coins <= active_days * 200 ──
test("a plausible row (7 days, exactly 200/day) ranks", () => {
  const subs = [S("ok", { active_days: 7, total_coins: 1400 })]; // 1400 == 7*200
  const { verified, review } = partition(subs);
  assert.ok(verified.some((s) => s.handle === "ok"));
  assert.ok(!review.some((s) => s.handle === "ok"));
  assert.equal(rankOnPrimaryBoard(subs, "ok"), 1);
});

test("too few active days (<7) is held with a 'needs more days' reason, not ranked", () => {
  const subs = [S("newbie", { active_days: 6, total_coins: 300 })];
  const { verified, review } = partition(subs);
  assert.ok(!verified.some((s) => s.handle === "newbie"));
  const held = review.find((s) => s.handle === "newbie");
  assert.ok(held, "held for review");
  assert.match(held.review_reason, /days of data/);
  assert.equal(rankOnPrimaryBoard(subs, "newbie"), null);
});

test("coins beyond active_days * 200 is held as implausible (200*days + 1)", () => {
  const subs = [S("grinder", { active_days: 10, total_coins: 10 * 200 + 1 })];
  const { verified, review } = partition(subs);
  assert.ok(!verified.some((s) => s.handle === "grinder"));
  const held = review.find((s) => s.handle === "grinder");
  assert.ok(held, "held for review");
  assert.match(held.review_reason, /per active day/);
  assert.equal(rankOnPrimaryBoard(subs, "grinder"), null);
});

test("unverified rows never rank; they land in the unverified bucket", () => {
  // Keep it plausible (9000 coins over 50 days = 180/day) so it lands in
  // unverified, not review — the point is the missing ✓, not implausibility.
  const subs = [S("v", { total_coins: 10 }), { ...S("u", { total_coins: 9000, active_days: 50 }), verified: false }];
  const { verified, unverified } = partition(subs);
  assert.ok(unverified.some((s) => s.handle === "u"));
  assert.equal(rankOnPrimaryBoard(subs, "u"), null);
  assert.equal(rankOnPrimaryBoard(subs, "v"), 1);
});

test("render is deterministic for a fixed timestamp", () => {
  const subs = [S("a"), S("b", { total_coins: 5 })];
  assert.equal(renderLeaderboard(subs, { now: DEFAULT_NOW }), renderLeaderboard(subs, { now: DEFAULT_NOW }));
});

test("rendered board has ZERO detectable swears and leaks no email/path", () => {
  const subs = [S("a", { top_word: "f**k" }), S("b", { top_word: "s**t" }), { ...S("u"), verified: false }];
  const md = renderLeaderboard(subs, {});
  assert.equal(detect(md).coins, 0);
  assert.ok(!/@[a-z0-9.]+\.(com|co|net|org)/i.test(md.replace(/github\.com/g, "")), "no email addresses");
  assert.ok(!md.includes("/Users/"), "no filesystem paths");
});

test("the committed LEADERBOARD.md passes the zero-swear invariant", () => {
  const md = fs.readFileSync(new URL("../LEADERBOARD.md", import.meta.url), "utf8");
  assert.equal(detect(md).coins, 0);
  assert.ok(md.includes("Unverified"), "keeps the unverified section");
  assert.ok(md.includes("Held for review"), "keeps the review section");
});
