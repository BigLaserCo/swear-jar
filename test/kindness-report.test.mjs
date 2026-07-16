// Kindness Report — stats distributions + side-B dashboard render.

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStats } from "../src/stats.mjs";
import { renderDashboard } from "../src/dashboard.mjs";

const NOW = Date.parse("2026-07-16T12:00:00Z");
const RECS = [
  { uuid: "a", ts: "2026-07-14T09:15:00Z", source: "claude", project: "p", words: { fuck: 2 }, word_count: 100, polite: { please: 2, thanks: 1 }, rejects: { "sarcasm:thanks-a-lot": 1 } },
  { uuid: "b", ts: "2026-07-15T14:40:00Z", source: "claude", project: "p", words: {}, word_count: 50, polite: { sorry: 1 } },
  { uuid: "c", ts: "2026-07-15T15:00:00Z", source: "assistant", project: "p", words: { fuck: 1 }, word_count: 40, polite: { please: 9 } }, // machine manners never credit
  { uuid: "d", ts: "2026-07-16T08:05:00Z", source: "codex", project: "q", words: {}, word_count: 60, polite: { please: 1 } },
];

test("kindness distributions: hour/day/dow buckets are credit-weighted and human-only", () => {
  const s = computeStats(RECS, NOW);
  // 3 human kind days in a row -> streak 3, series has 3 points
  assert.equal(s.kindStreak, 3);
  assert.equal(s.kindDaySeries.length, 3);
  assert.deepEqual(s.kindDaySeries.map((d) => d.date), ["2026-07-14", "2026-07-15", "2026-07-16"]);
  // machine record contributed nothing despite polite:{please:9}
  const totalSeries = s.kindDaySeries.reduce((n, d) => n + d.credits, 0);
  const hourTotal = s.kindByHour.reduce((a, b) => a + b, 0);
  assert.equal(hourTotal, totalSeries, "hour buckets sum to day-series credits");
  assert.ok(s.kindByHour[9] > 0, "09:15 record landed in hour 9");
  assert.ok(s.kindByHour[15] === 0, "assistant 15:00 manners earned zero");
  assert.equal(s.bestKindDay.date, "2026-07-14");
  assert.equal(typeof s.firstThanksAvg, "string");
});

test("renderDashboard kind:'kindness' uses the side-B template and injects data", () => {
  const s = computeStats(RECS, NOW);
  const html = renderDashboard(s, { kind: "kindness", donateUrl: false, hostedUrl: false });
  assert.ok(html.includes("the kindness report"), "side-B title");
  assert.ok(html.includes("grace.wav"), "side-B tape");
  assert.ok(!html.includes("/*__DATA__*/{}"), "data marker replaced");
  assert.ok(html.includes("kindDaySeries"), "payload carries kindness series");
  // privacy: no raw ledger sentences exist to leak; ensure no ledger path junk
  assert.ok(!html.includes("/Users/"), "no operator paths");
});

test("renderDashboard default remains the damage template (back-compat)", () => {
  const s = computeStats(RECS, NOW);
  const html = renderDashboard(s, { donateUrl: false, hostedUrl: false });
  assert.ok(html.includes("the damage report"));
  assert.ok(html.includes("swear-jar-kindness-card.svg"), "damage side offers the kindness card download");
});
