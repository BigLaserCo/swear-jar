import test from "node:test";
import assert from "node:assert/strict";
import { survivalOdds, rankFor, summarize, RANKS } from "../src/odds.mjs";

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

test("swearing lowers the odds, floor is 1", () => {
  const some = survivalOdds([rec("user", 10)], NOW);
  const lots = survivalOdds(Array.from({ length: 200 }, () => rec("user", 5)), NOW);
  assert.ok(some.odds < survivalOdds([], NOW).odds);
  assert.ok(lots.odds < some.odds);
  assert.ok(lots.odds >= 1);
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

test("the rank ladder is strictly monotonic", () => {
  for (let i = 1; i < RANKS.length; i++) {
    assert.ok(RANKS[i][0] > RANKS[i - 1][0], `threshold at index ${i} must exceed the previous`);
  }
});

test("every rung is reachable exactly at its threshold", () => {
  for (const [threshold, name] of RANKS) {
    assert.equal(rankFor(threshold).current, name, `coins=${threshold} should be "${name}"`);
  }
});

test("ranks climb the dense low ladder", () => {
  assert.equal(rankFor(0).current, "Untarnished Soul");
  assert.equal(rankFor(15).current, "Mild Discomfort"); // between 10 and 20
  assert.equal(rankFor(55).current, "Sailor"); // between 50 and 60
  assert.equal(rankFor(100).current, "Merge Conflict Survivor");
  assert.equal(rankFor(1000).current, "Have You Considered Anger Management?");
});

test("the high ranks stay anonymous and the top damage rung starts at 10k", () => {
  assert.equal(rankFor(8000).current, "The Machines Remember You");
  assert.equal(rankFor(8700).current, "The Machines Remember You");
  assert.deepEqual(rankFor(8000).next, { name: "9,000", at: 9000 });
});

test("the top rank is open-ended above 10k", () => {
  const [topThreshold, topName] = RANKS[RANKS.length - 1];
  assert.equal(rankFor(topThreshold).current, topName);
  assert.equal(rankFor(topThreshold).next, null);
  assert.equal(rankFor(topThreshold * 100).current, topName, "stays top no matter how high");
  assert.equal(rankFor(topThreshold * 100).next, null);
});

test("next names the following rung with its threshold", () => {
  assert.deepEqual(rankFor(0).next, { name: "Mild Discomfort", at: 10 });
});
