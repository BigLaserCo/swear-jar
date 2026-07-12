#!/usr/bin/env node
// Build docs/demo.html — a fully synthetic Swear Jar damage report for the
// public landing site.
//
// HARD rule: this script reads NOTHING real. No ~/.swear-jar, no ~/.claude, no
// ledger, no real project names. Every record below is invented from a SEEDED
// PRNG so the output is byte-for-byte reproducible (re-running never produces a
// different page). It renders through the REAL renderDashboard() from
// src/dashboard.mjs so the demo matches the exact visual language of a real
// report, then splices in a loud "SYNTHETIC DEMO" banner.
//
//   node scripts/site/buildDemo.mjs
//
// Deterministic inputs: SEED, TARGET, the family/project/hour weight tables,
// and NOW. Change any of them and the report changes; leave them and it is
// stable across machines and runs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDashboard } from "../../src/dashboard.mjs";
import { computeStats } from "../../src/stats.mjs";
import { LEXICON, TIER_COINS, FAMILY_CAP } from "../../src/detect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(ROOT, "docs", "demo.html");

// ── deterministic knobs ──────────────────────────────────────────────────────
const SEED = 0x53574a52; // fixed constant "SWJR" — the ONLY entropy source
const TARGET = 400; // approx record count
// Fixed "now" so generatedAt / odds / date ranges are reproducible. All records
// land in the ~90 days BEFORE this instant.
const NOW = Date.UTC(2026, 6, 10, 12, 0, 0); // 2026-07-10T12:00:00Z
const WINDOW_DAYS = 90;
const START_MS = NOW - (WINDOW_DAYS + 1) * 86400000; // ~2026-04-10, midnight-ish

// ── seeded PRNG (mulberry32) — no Math.random anywhere ───────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const randInt = (n) => Math.floor(rand() * n);

// weighted pick over [ [value, weight], ... ]
function weightedPick(pairs) {
  let total = 0;
  for (const [, w] of pairs) total += w;
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r < 0) return v;
  }
  return pairs[pairs.length - 1][0];
}
// weighted index over a plain array of weights
function weightedIndex(weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0) return i;
  }
  return weights.length - 1;
}

// family -> tier (first tier wins, mirrors src/stats.mjs) and its coin price
const TIER_BY_KEY = (() => {
  const m = {};
  for (const { key, tier } of LEXICON) if (!(key in m)) m[key] = tier;
  return m;
})();
const priceOf = (fam) => TIER_COINS[TIER_BY_KEY[fam] || "standard"] || 1;

// ── invented, obviously-fake project names (none contain a lexicon word) ─────
const PROJECTS = [
  ["death-star-plans", 22],
  ["prod-hotfix-friday", 20],
  ["todo-app-v9", 16],
  ["cursed-regex", 14],
  ["legacy-jenga", 12],
  ["quantum-blender", 9],
  ["tax-bot-3000", 5],
  ["my-startup-idea", 2],
];

// families that exist in the audited lexicon, weighted so the classics dominate
const FAMILIES = [
  ["fuck", 30],
  ["shit", 20],
  ["damn", 12],
  ["hell", 8],
  ["crap", 6],
  ["ass", 6],
  ["bitch", 5],
  ["motherfucker", 3],
  ["goddamn", 3],
  ["bastard", 3],
  ["dick", 3],
  ["piss", 3],
  ["bloody", 3],
  ["bollocks", 2],
  ["cunt", 2],
  ["clusterfuck", 1],
];

// believable dev rage-o-clock: quiet overnight, morning ramp, an afternoon peak,
// a late-night spike. Index = hour 0..23.
const HOUR_WEIGHTS = [
  6, 4, 2, 1, 1, 2, // 00-05
  3, 5, 7, 9, 11, 10, // 06-11
  8, 7, 10, 12, 13, 11, // 12-17
  8, 7, 9, 8, 7, 7, // 18-23
];

function isoFor(dayOffset, hour, minute, second) {
  const ms = START_MS + dayOffset * 86400000 + hour * 3600000 + minute * 60000 + second * 1000;
  return new Date(ms).toISOString();
}

function buildRecords() {
  const recs = [];
  for (let i = 0; i < TARGET; i++) {
    const source = rand() < 0.28 ? "assistant" : "user";
    const project = weightedPick(PROJECTS);

    // day: weekdays carry more of the load (weekend records get a resample shot)
    let dayOffset;
    for (let guard = 0; guard < 4; guard++) {
      dayOffset = randInt(WINDOW_DAYS);
      const dow = new Date(START_MS + dayOffset * 86400000).getUTCDay();
      if (!((dow === 0 || dow === 6) && rand() < 0.6)) break;
    }
    const hour = weightedIndex(HOUR_WEIGHTS);
    const minute = randInt(60);
    const second = randInt(60);
    const ts = isoFor(dayOffset, hour, minute, second);

    // 1 family most of the time, occasionally 2; small per-family counts
    const nFam = rand() < 0.82 ? 1 : 2;
    const words = {};
    for (let k = 0; k < nFam; k++) {
      const fam = weightedPick(FAMILIES);
      const cnt = rand() < 0.75 ? 1 : rand() < 0.7 ? 2 : 3;
      words[fam] = (words[fam] || 0) + cnt;
    }
    let coins = 0;
    for (const [fam, n] of Object.entries(words)) {
      coins += Math.min(n, FAMILY_CAP) * priceOf(fam);
    }

    recs.push({
      uuid: `demo:${i}`,
      ts,
      source,
      agent: rand() < 0.85 ? "claude" : "codex",
      event: source === "assistant" ? "Stop" : "UserPromptSubmit",
      project,
      words,
      coins,
    });
  }
  // chronological — matches how a real ledger appends
  recs.sort((a, b) => a.ts.localeCompare(b.ts));
  return recs;
}

// Loud, unmissable "this is fake" banner, spliced into the real report right
// inside <div class="app">. Inline styles only (no new external requests); it
// reuses the report's own CSS variables so it matches the theme.
const DEMO_BANNER = `
  <div class="demo-banner" role="note" style="margin:18px 0 0;padding:14px 18px;border:1px solid var(--baccent);border-radius:12px;background:linear-gradient(180deg,#241a0f,var(--section));font-family:var(--mono);font-size:13px;line-height:1.55;color:var(--secondary);display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline">
    <strong style="color:var(--accent-text);font-weight:700;letter-spacing:.08em">&#129514; SYNTHETIC DEMO DATA</strong>
    <span>Every figure below is invented for illustration &mdash; your report is generated locally from your own sessions, and nothing here reflects a real person or ever leaves your machine.</span>
    <a href="index.html" style="color:var(--accent-text);margin-left:auto;text-decoration:none">&larr; swear-jar home</a>
  </div>`;

function injectBanner(html) {
  const marker = '<div class="app">';
  const at = html.indexOf(marker);
  if (at === -1) throw new Error("could not find .wrap container to inject the demo banner");
  const cut = at + marker.length;
  return html.slice(0, cut) + "\n" + DEMO_BANNER + html.slice(cut);
}

function main() {
  const records = buildRecords();
  const stats = computeStats(records, NOW);
  // Donate is default-ON since monetization-v1 and points at the hosted tip
  // page — but the public demo must stay zero-external-request (site.test.mjs
  // allows only github.com/BigLaserCo/swear-jar refs), so the section is
  // explicitly suppressed here. A demo regen can never inject an external URL.
  let html = renderDashboard(stats, { donateUrl: false });
  html = injectBanner(html);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, "utf8");

  const rel = path.relative(ROOT, OUT);
  console.log(`demo built → ${rel}`);
  console.log(
    `  ${records.length} synthetic records · ${stats.totalCoins} coins · $${stats.dollarsOwed} owed`
  );
  console.log(
    `  you ${stats.userPct}% / machine ${stats.machinePct}% · odds ${stats.odds.value}% · rank ${stats.rank.current}`
  );
}

main();
