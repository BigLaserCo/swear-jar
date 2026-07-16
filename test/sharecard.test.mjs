// Share-card generator + surface-parity tests.
//
// The self-contained HTML surfaces inline cardSvg VERBATIM (no build step).
// The parity test here is what makes that duplication safe: it extracts the
// block between the __CARD_SVG__ markers from every surface and asserts it
// byte-matches the canonical src/sharecard.mjs block. Drift = red.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cardSvg, cardData } from "../src/sharecard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const D = {
  coins: 1435,
  dollars: 789.5, // decimal in DATA — must render whole on the card
  favLabel: "f***",
  fbombPct: 41,
  vocab: 16,
  kindActs: 190,
  credits: 252,
  favKindLabel: "please",
  grovelPct: 12,
  kindVocab: 13,
};

test("damage card renders the aggregate numbers, whole dollars only", () => {
  const svg = cardSvg(D, "damage");
  assert.ok(svg.startsWith("<svg "), "svg root");
  assert.ok(svg.includes("1,435"), "coins");
  assert.ok(svg.includes("$790"), "dollars rounded to whole ($789.5 -> $790)");
  assert.ok(!/\$\d+\.\d/.test(svg), "no decimal dollars anywhere");
  assert.ok(svg.includes("f***"), "censored favourite only");
  assert.ok(!svg.includes("fuck"), "no raw swear leaks");
});

test("kindness card is karma-only: points, NEVER money (Jim red-alert 2026-07-16)", () => {
  const svg = cardSvg(D, "kindness");
  assert.ok(svg.includes("the kindness report"), "kindness heading");
  assert.ok(svg.includes("190"), "nice things said — the headline number");
  assert.ok(svg.includes("nice things said to an AI"), "plain-language framing");
  assert.ok(svg.includes("252 karma points (worth nothing)"), "karma framing, explicitly worthless");
  assert.ok(!svg.includes("$"), "NO dollar sign anywhere on the kindness card — karma is not money");
  assert.ok(!/earned back|owed|off the jar/i.test(svg), "no money-back language");
  assert.ok(svg.includes("please"), "favourite courtesy (lexicon constant)");
  assert.ok(svg.includes("#FBF7EC"), "paper background");
  assert.ok(svg.includes("#F5C542"), "gold top bar");
});

test("both variants are well-formed single-root SVGs", () => {
  for (const v of ["damage", "kindness"]) {
    const svg = cardSvg(D, v);
    assert.equal((svg.match(/<svg /g) || []).length, 1);
    assert.ok(svg.endsWith("</svg>"));
    // every opened <text> closes
    assert.equal((svg.match(/<text /g) || []).length, (svg.match(/<\/text>/g) || []).length);
  }
});

test("cardData maps stats to display fields with censoring + grovel share", () => {
  const stats = {
    totalCoins: 10,
    dollarsOwed: 2.5,
    fbombPct: 50,
    vocab: 3,
    topWords: [{ word: "fuck", count: 5 }],
    kindnessCredits: 8,
    kindnessDollars: 2,
    topPositives: [
      { word: "please", count: 3, tier: "courtesy", credits: 3 },
      { word: "youre-a-genius", count: 1, tier: "grovel", credits: 4 },
    ],
  };
  const d = cardData(stats);
  assert.equal(d.favLabel, "f***");
  assert.equal(d.favKindLabel, "please");
  assert.equal(d.grovelPct, 50); // 4 of 8 credits
  assert.equal(d.kindVocab, 2);
  assert.ok(!("dollarsBack" in d), "karma only — no money field on the kindness side");
});

// ── parity: every surface's inlined generator must byte-match the canonical ──
const START = "/*__CARD_SVG_START__*/";
const END = "/*__CARD_SVG_END__*/";
function block(file) {
  const s = fs.readFileSync(path.join(ROOT, file), "utf8");
  const a = s.indexOf(START);
  const b = s.indexOf(END);
  assert.ok(a !== -1 && b !== -1, `${file} carries the cardSvg parity block`);
  return s.slice(a + START.length, b).trim();
}

test("inlined cardSvg in every HTML surface byte-matches src/sharecard.mjs", () => {
  const canonical = block("src/sharecard.mjs");
  for (const surface of ["assets/report_template.html", "assets/kindness_template.html"]) {
    assert.equal(block(surface), canonical, `${surface} drifted from src/sharecard.mjs`);
  }
});

test("generated docs samples carry the same parity block", () => {
  const canonical = block("src/sharecard.mjs");
  for (const surface of ["docs/demo.html", "docs/kindness.html"]) {
    assert.equal(block(surface), canonical, `${surface} stale — re-run scripts/site/build*.mjs`);
  }
});
