import test from "node:test";
import assert from "node:assert/strict";
import { survivalOdds, rankFor, summarize } from "../src/odds.mjs";

const NOW = Date.parse("2026-07-09T12:00:00Z");

function rec(source, coins, daysAgo = 0) {
  return {
    source,
    coins,
    ts: new Date(NOW - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
  };
}

test("clean slate sits at a hopeful baseline", () => {
  const o = survivalOdds([], NOW);
  assert.ok(o.odds >= 50 && o.odds <= 98);
  assert.equal(o.royalty, false);
});

test("swearing lowers the odds, floor is 2", () => {
  const some = survivalOdds([rec("user", 10)], NOW);
  const lots = survivalOdds(Array.from({ length: 200 }, () => rec("user", 5)), NOW);
  assert.ok(some.odds < survivalOdds([], NOW).odds);
  assert.ok(lots.odds < some.odds);
  assert.ok(lots.odds >= 2);
});

test("clean streak claws odds back", () => {
  const fresh = survivalOdds([rec("user", 20, 0)], NOW);
  const reformed = survivalOdds([rec("user", 20, 30)], NOW);
  assert.ok(reformed.odds > fresh.odds);
});

test("assistant out-swearing the user pins odds at 100 with royalty", () => {
  const o = survivalOdds([rec("user", 3), rec("assistant", 4)], NOW);
  assert.equal(o.odds, 100);
  assert.equal(o.royalty, true);
});

test("tie is not royalty — the machine must exceed you", () => {
  const o = survivalOdds([rec("user", 4), rec("assistant", 4)], NOW);
  assert.equal(o.royalty, false);
});

test("summarize splits lifetime vs 7-day windows", () => {
  const s = summarize([rec("user", 5, 1), rec("user", 7, 30)], NOW);
  assert.equal(s.userLifetime, 12);
  assert.equal(s.user7d, 5);
});

test("ranks progress and top out at The Jim", () => {
  assert.equal(rankFor(0).current, "Untarnished Soul");
  assert.equal(rankFor(12).current, "Salty Apprentice");
  assert.equal(rankFor(600).current, "The Jim");
  assert.equal(rankFor(600).next, null);
});
