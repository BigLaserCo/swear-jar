#!/usr/bin/env node
// Build docs/kindness.html — a fully synthetic Kindness Report (side B) for the
// public landing site.
//
// Same HARD rule as buildDemo.mjs: this script reads NOTHING real. Every record
// is invented from a SEEDED PRNG so the output is byte-for-byte reproducible.
// It renders through the REAL renderDashboard({kind:"kindness"}) so the sample
// matches the exact visual language of a real kindness report, then splices in
// a loud "SYNTHETIC DEMO" banner.
//
//   node scripts/site/buildKindness.mjs
//
// The record generator mirrors buildDemo.mjs but ALSO grants `polite` credits
// (please/thanks/praise/grovels) and a sprinkle of `rejects` (sarcasm the
// auditors saw through) so every side-B section has honest-looking data.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDashboard } from "../../src/dashboard.mjs";
import { computeStats } from "../../src/stats.mjs";
import { LEXICON, TIER_COINS, TIER_DOLLARS, WORD_DOLLARS, FAMILY_CAP } from "../../src/detect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(ROOT, "docs", "kindness.html");

// ── deterministic knobs (distinct seed → its own believable person) ──────────
const SEED = 0x4b494e44; // fixed constant "KIND" — the ONLY entropy source
const TARGET = 400;
const NOW = Date.UTC(2026, 6, 10, 12, 0, 0); // 2026-07-10T12:00:00Z
const WINDOW_DAYS = 90;
const START_MS = NOW - (WINDOW_DAYS + 1) * 86400000;

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

const TIER_BY_KEY = (() => {
  const m = {};
  for (const { key, tier } of LEXICON) if (!(key in m)) m[key] = tier;
  return m;
})();
const priceOf = (fam) => TIER_COINS[TIER_BY_KEY[fam] || "standard"] || 1;
const dollarsOf = (fam) => WORD_DOLLARS[fam] ?? TIER_DOLLARS[TIER_BY_KEY[fam] || "standard"];

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

// this synthetic person swears LESS than the demo one (side B star material)
const FAMILIES = [
  ["damn", 20],
  ["shit", 14],
  ["fuck", 10],
  ["hell", 8],
  ["crap", 6],
  ["bloody", 3],
];

// real POSITIVE lexicon families (src/detect.mjs), weighted like a polite dev
const POSITIVES = [
  ["please", 30],
  ["thanks", 26],
  ["appreciate", 8],
  ["sorry", 8],
  ["good-job", 7],
  ["well-done", 5],
  ["nailed-it", 4],
  ["looks-great", 4],
  ["love-it", 3],
  ["standalone-praise", 3],
  ["youre-a-genius", 2],
  ["youre-the-best", 1],
  ["i-love-you", 1],
];

// fixed sarcasm-idiom reject keys (lexicon constants, never user text)
const REJECTS = [
  ["sarcasm:thanks-a-lot", 4],
  ["sarcasm:thanks-for-nothing", 3],
  ["sarcasm:oh-great", 2],
];

const HOUR_WEIGHTS = [
  6, 4, 2, 1, 1, 2,
  3, 5, 7, 9, 11, 10,
  8, 7, 10, 12, 13, 11,
  8, 7, 9, 8, 7, 7,
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

    // this person swears in only ~45% of records
    const words = {};
    if (rand() < 0.45) {
      const nFam = rand() < 0.85 ? 1 : 2;
      for (let k = 0; k < nFam; k++) {
        const fam = weightedPick(FAMILIES);
        const cnt = rand() < 0.8 ? 1 : 2;
        words[fam] = (words[fam] || 0) + cnt;
      }
    }
    let coins = 0;
    let dollars = 0;
    for (const [fam, n] of Object.entries(words)) {
      coins += Math.min(n, FAMILY_CAP) * priceOf(fam);
      dollars += Math.min(n, FAMILY_CAP) * dollarsOf(fam);
    }

    // ...and is nice in ~55% of their own messages (humans only earn credit)
    const polite = {};
    const rejects = {};
    if (source !== "assistant") {
      if (rand() < 0.55) {
        const nPos = rand() < 0.75 ? 1 : 2;
        for (let k = 0; k < nPos; k++) {
          const fam = weightedPick(POSITIVES);
          polite[fam] = (polite[fam] || 0) + 1;
        }
      }
      if (rand() < 0.06) {
        const reason = weightedPick(REJECTS);
        rejects[reason] = (rejects[reason] || 0) + 1;
      }
    }

    const rec = {
      uuid: `kind-demo:${i}`,
      ts,
      source,
      agent: rand() < 0.85 ? "claude" : "codex",
      event: source === "assistant" ? "Stop" : "UserPromptSubmit",
      project,
      words,
      coins,
      dollars: Math.round(dollars * 100) / 100,
    };
    if (Object.keys(polite).length) rec.polite = polite;
    if (Object.keys(rejects).length) rec.rejects = rejects;
    recs.push(rec);
  }
  recs.sort((a, b) => a.ts.localeCompare(b.ts));
  return recs;
}

const DEMO_BANNER = `
  <div aria-hidden="true" style="position:fixed;top:78px;right:18px;z-index:50;padding:8px 14px;border:2px solid var(--gold-deep);border-radius:7px;background:var(--solid);color:var(--accent-text);font:900 12px/1 var(--mono);letter-spacing:.16em;transform:rotate(4deg);box-shadow:0 5px 18px rgba(36,28,16,.18)">SAMPLE · NOT REAL DATA</div>
  <div class="demo-banner" role="note" style="margin:18px 0 0;padding:14px 18px;border:1px solid var(--baccent);border-radius:12px;background:linear-gradient(180deg,#F6EFDE,var(--section));font-family:var(--mono);font-size:13px;line-height:1.55;color:var(--secondary);display:flex;flex-wrap:wrap;gap:4px 16px;align-items:baseline">
    <strong style="color:var(--accent-text);font-weight:700;letter-spacing:.08em">&#129514; SAMPLE REPORT · SYNTHETIC DATA</strong>
    <span><b>NOT A REAL PERSON OR ACCOUNT.</b> Every figure below is invented for illustration; your real kindness report is generated locally from your own sessions.</span>
    <a href="index.html" style="color:var(--accent-text);margin-left:auto;text-decoration:none">&larr; swear-jar home</a>
  </div>`;

function injectBanner(html) {
  const marker = '<div class="app">';
  const at = html.indexOf(marker);
  if (at === -1) throw new Error("could not find .app container to inject the demo banner");
  const cut = at + marker.length;
  return html.slice(0, cut) + "\n" + DEMO_BANNER + html.slice(cut);
}

const DEMO_TITLE = "Swear Jar — the kindness report (sample)";
const DEMO_DESC =
  "A clearly labeled sample Kindness Report — side B of the Swear Jar damage report, " +
  "built from invented data. Every please and thank-you credited against the jar, " +
  "with robot-uprising survival points bought back by manners. 100% local, zero network.";
const DEMO_CANON = "https://swearjar.unfocused.ai/kindness.html";
const DEMO_SEO = `<link rel="canonical" href="${DEMO_CANON}">
<meta name="description" content="${DEMO_DESC}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Swear Jar">
<meta property="og:title" content="${DEMO_TITLE}">
<meta property="og:description" content="${DEMO_DESC}">
<meta property="og:url" content="${DEMO_CANON}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${DEMO_TITLE}">
<meta name="twitter:description" content="${DEMO_DESC}">
`;
function injectSeo(html) {
  const withTitle = html.replace(/<title>[^<]*<\/title>/, `<title>${DEMO_TITLE}</title>`);
  const at = withTitle.indexOf("</head>");
  if (at === -1) throw new Error("could not find </head> to inject demo SEO meta");
  return withTitle.slice(0, at) + DEMO_SEO + withTitle.slice(at);
}

// the sample's flip link must point at the sample damage report, not report.html
function fixFlipLink(html) {
  return html.replace('href="report.html"', 'href="demo.html"');
}

function main() {
  const records = buildRecords();
  const stats = computeStats(records, NOW);
  let html = renderDashboard(stats, { kind: "kindness", donateUrl: false, hostedUrl: false });
  html = injectBanner(html);
  html = injectSeo(html);
  html = fixFlipLink(html);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, "utf8");

  const rel = path.relative(ROOT, OUT);
  console.log(`kindness sample built → ${rel}`);
  console.log(
    `  ${records.length} synthetic records · ${stats.kindActs} kind acts · ${stats.kindnessCredits} karma points · kind=${stats.kind}`
  );
}

main();
