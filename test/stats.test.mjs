import test from "node:test";
import assert from "node:assert/strict";
import { computeStats } from "../src/stats.mjs";
import { survivalOdds } from "../src/odds.mjs";

const NOW = Date.parse("2026-07-09T12:00:00Z"); // a Thursday

// Fully synthetic ledger — no real user data. Dates:
//   2026-07-06 = Mon, 07-07 = Tue, 08 = Wed.
const FIXTURE = [
  { source: "user", project: "alpha", ts: "2026-07-06T09:15:00Z", words: { fuck: 1 }, coins: 3 },
  { source: "user", project: "alpha", ts: "2026-07-06T14:30:00Z", words: { shit: 2 }, coins: 4 },
  { source: "user", project: "beta", ts: "2026-07-07T09:05:00Z", words: { fuck: 1, damn: 1 }, coins: 4 },
  { source: "assistant", project: "alpha", ts: "2026-07-07T10:00:00Z", words: { fuck: 1 }, coins: 3 },
  { source: "user", project: "beta", ts: "2026-07-08T23:00:00Z", words: { motherfucker: 1 }, coins: 5 },
  { source: "user", project: "alpha", ts: "2026-07-08T09:40:00Z", words: { hell: 1 }, coins: 1 },
];

test("hero totals: coins and dollars owed", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.equal(s.totalCoins, 20);
  assert.equal(s.dollarsOwed, 5); // 20 * 0.25
  assert.equal(s.coinValue, 0.25);
  assert.equal(s.totalRecords, 6);
});

test("you vs machine split", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.equal(s.userCoins, 17);
  assert.equal(s.machineCoins, 3);
  assert.equal(s.userPct, 85);
  assert.equal(s.machinePct, 15);
});

test("coins by hour (literal wall clock, TZ-independent)", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.equal(s.byHour.length, 24);
  assert.equal(s.byHour[9], 8); // 3 + 4 + 1
  assert.equal(s.byHour[10], 3);
  assert.equal(s.byHour[14], 4);
  assert.equal(s.byHour[23], 5);
  assert.equal(s.byHour.reduce((a, b) => a + b, 0), 20);
});

test("coins by day of week + worst weekday", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.equal(s.byDow.length, 7);
  assert.equal(s.byDow[1], 7); // Monday
  assert.equal(s.byDow[2], 7); // Tuesday
  assert.equal(s.byDow[3], 6); // Wednesday
  assert.equal(s.worstDow.label, "Monday"); // first max wins on tie
  assert.equal(s.worstDow.coins, 7);
});

test("coins by project, top 10, sorted", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.deepEqual(s.byProject, [
    { project: "alpha", coins: 11 },
    { project: "beta", coins: 9 },
  ]);
});

test("top word families carry counts, tiers and coin value", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.equal(s.topWords[0].word, "fuck");
  assert.equal(s.topWords[0].count, 3);
  assert.equal(s.topWords[0].tier, "premium");
  assert.equal(s.topWords[0].coins, 9); // 3 * 3
  assert.equal(s.topWords[1].word, "shit");
  assert.equal(s.topWords[1].count, 2);
  const mf = s.topWords.find((w) => w.word === "motherfucker");
  assert.equal(mf.tier, "artisanal");
  assert.equal(mf.coins, 5);
  assert.equal(s.vocab, 5);
  assert.equal(s.fbombs, 4); // fuck 3 + motherfucker 1
  assert.equal(s.spicyPct, 70); // (9 + 5) / 20
});

test("per-day series and worst day", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.deepEqual(s.daySeries, [
    { date: "2026-07-06", coins: 7 },
    { date: "2026-07-07", coins: 7 },
    { date: "2026-07-08", coins: 6 },
  ]);
  assert.equal(s.worstDay.date, "2026-07-06");
  assert.equal(s.worstDay.coins, 7);
});

test("longest daily streak counts consecutive human-swearing days", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.equal(s.longestStreak, 3);
});

test("timestamps, active days and per-day rate", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.equal(s.firstTs, "2026-07-06T09:15:00Z");
  assert.equal(s.lastTs, "2026-07-08T23:00:00Z");
  assert.equal(s.activeDays, 3);
  assert.equal(s.coinsPerActiveDay, 6.7); // 20 / 3
  assert.equal(s.firstSwearAvg, "9:20am");
  assert.equal(s.cleanStreakDays, 0);
});

test("swear-instance counts and you-vs-founder rate", () => {
  const s = computeStats(FIXTURE, NOW);
  // 8 total hits: fuck1+shit2 + fuck1+damn1 + fuck1(machine) + motherfucker1 + hell1
  assert.equal(s.totalSwears, 8);
  assert.equal(s.userSwears, 7); // minus the one machine fuck
  assert.equal(s.activeDays, 3);
  assert.equal(s.swearsPerDay, 2.3); // 7 / 3, rounded to 1dp
  assert.equal(s.founderPerDay, 65);
  assert.equal(s.fbombPct, 50); // 4 f-tier hits / 8 total
});

test("signature combo is the human's most common in-message pairing", () => {
  const s = computeStats(FIXTURE, NOW);
  // Only the 07-07 beta record pairs two families: {fuck, damn}
  assert.deepEqual(s.signatureCombo, { a: "damn", b: "fuck", count: 1 });
});

test("clean-days percentage spans first→last active day", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.equal(s.spanDays, 3); // 07-06 .. 07-08 inclusive
  assert.equal(s.cleanDaysPct, 0); // all 3 days had coins

  // A sparse ledger: two coins 10 days apart -> mostly clean.
  const sparse = [
    { source: "user", project: "a", ts: "2026-07-01T09:00:00Z", words: { damn: 1 }, coins: 1 },
    { source: "user", project: "a", ts: "2026-07-11T09:00:00Z", words: { damn: 1 }, coins: 1 },
  ];
  const ss = computeStats(sparse, NOW);
  assert.equal(ss.spanDays, 11);
  assert.equal(ss.activeDays, 2);
  assert.equal(ss.cleanDaysPct, 82); // 9 clean of 11
});

test("empty ledger yields sane zeros for the new fields", () => {
  const s = computeStats([], NOW);
  assert.equal(s.totalSwears, 0);
  assert.equal(s.userSwears, 0);
  assert.equal(s.swearsPerDay, 0);
  assert.equal(s.founderPerDay, 65);
  assert.equal(s.fbombPct, 0);
  assert.equal(s.signatureCombo, null);
  assert.equal(s.spanDays, 0);
  assert.equal(s.cleanDaysPct, 0);
});

test("uprising odds + rank reuse odds.mjs", () => {
  const s = computeStats(FIXTURE, NOW);
  assert.equal(s.odds.value, survivalOdds(FIXTURE, NOW).odds);
  assert.equal(s.odds.royalty, false);
  assert.equal(s.rank.current, "Salty Apprentice");
  assert.deepEqual(s.rank.next, { name: "Dockworker", at: 25 });
});

test("machine out-swearing the human flips odds to royalty", () => {
  const royal = [
    { source: "user", project: "a", ts: "2026-07-08T09:00:00Z", words: { damn: 1 }, coins: 1 },
    { source: "assistant", project: "a", ts: "2026-07-08T10:00:00Z", words: { fuck: 2 }, coins: 6 },
  ];
  const s = computeStats(royal, NOW);
  assert.equal(s.odds.value, 100);
  assert.equal(s.odds.royalty, true);
});

test("empty ledger yields a well-formed zero object", () => {
  const s = computeStats([], NOW);
  assert.equal(s.totalCoins, 0);
  assert.equal(s.dollarsOwed, 0);
  assert.equal(s.userCoins, 0);
  assert.equal(s.machineCoins, 0);
  assert.equal(s.userPct, 0);
  assert.equal(s.machinePct, 0);
  assert.deepEqual(s.byHour, new Array(24).fill(0));
  assert.deepEqual(s.byDow, new Array(7).fill(0));
  assert.deepEqual(s.byProject, []);
  assert.deepEqual(s.topWords, []);
  assert.deepEqual(s.daySeries, []);
  assert.equal(s.worstDay, null);
  assert.equal(s.worstDow, null);
  assert.equal(s.longestStreak, 0);
  assert.equal(s.activeDays, 0);
  assert.equal(s.coinsPerActiveDay, 0);
  assert.equal(s.firstSwearAvg, null);
  assert.equal(s.firstTs, "");
  assert.equal(s.lastTs, "");
});
