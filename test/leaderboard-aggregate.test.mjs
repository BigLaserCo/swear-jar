import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateSubmission, AGENTS } from "../scripts/leaderboard/schema.mjs";
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
  agent: "claude",
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

test("agent enum is closed", () => {
  assert.equal(validateSubmission({ ...base, agent: "skynet" }, "octocat", { releases: KNOWN }).ok, false);
  for (const a of AGENTS) {
    assert.equal(validateSubmission({ ...base, agent: a }, "octocat", { releases: KNOWN }).ok, true);
  }
});

// ── aggregation ─────────────────────────────────────────────────────────────
const S = (h, over = {}) => ({ ...base, handle: h, verified: true, ...over });

test("dedupe keeps a handle's highest total_coins", () => {
  const boards = computeBoards([S("dup", { total_coins: 100 }), S("dup", { total_coins: 900 })]);
  const row = boards.mostOwed.find((s) => s.handle === "dup");
  assert.equal(row.total_coins, 900);
  assert.equal(boards.mostOwed.filter((s) => s.handle === "dup").length, 1);
});

test("implausible row is held for review and excluded from ranked boards", () => {
  const subs = [S("real", { total_coins: 500 }), S("faker", { swears_per_day: 9000, total_coins: 999999 })];
  const { verified, review } = partition(subs);
  assert.ok(review.some((s) => s.handle === "faker"));
  assert.ok(!verified.some((s) => s.handle === "faker"));
  assert.equal(rankOnPrimaryBoard(subs, "faker"), null);
});

test("unverified rows never rank; they land in the unverified bucket", () => {
  const subs = [S("v", { total_coins: 10 }), { ...S("u", { total_coins: 9000 }), verified: false }];
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
