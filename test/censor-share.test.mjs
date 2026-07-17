// The censor hard rule + the share path, guarded at the SOURCE.
//
// Censored mode is ON by default and, while it is on, EVERY visible swear is
// censored — there is no surface that forgets one. Turning it off is an explicit
// user act (the toggle) and stays allowed; what LEAVES the page (the caption, the
// card) is censored unconditionally, toggle or not.
//
// These surfaces are self-contained HTML with inlined <script> and no build step,
// so the honest check is to read the shipped source and prove the invariant in the
// code that actually runs — same style as test/site.test.mjs and the parity block
// in test/sharecard.test.mjs. Browser-free by design (node --test, zero deps).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const lineOf = (src, i) => src.slice(0, i).split("\n").length;

// Surfaces that ship the censor TOGGLE: the damage report, its generated sample,
// and the browser scanner. The kindness surfaces deliberately have none — their
// board lists lexicon courtesies ("please"/"thanks"), never a swear.
const TOGGLE_SURFACES = ["assets/report_template.html", "docs/demo.html", "web/app.html"];

// Every surface that draws the share CARD. The card is the thing that leaves the
// machine, so its favourite-word label is censored on ALL of them, toggle or not.
const CARD_SURFACES = [
  "assets/report_template.html",
  "assets/kindness_template.html",
  "docs/demo.html",
  "docs/kindness.html",
];

// ── censored by default ──────────────────────────────────────────────────────
test("censored mode is the DEFAULT on every surface that ships the toggle", () => {
  for (const f of TOGGLE_SURFACES) {
    const src = read(f);
    assert.match(src, /\blet\s+CENSOR\s*=\s*true\b/, `${f} must default CENSOR to true`);
    assert.ok(!/\blet\s+CENSOR\s*=\s*false\b/.test(src), `${f} must never default CENSOR to false`);
    assert.match(src, /id="censorTog"[^>]*\bchecked\b/, `${f} ships the checkbox pre-checked`);
    // the toggle is the ONE thing that flips it — an explicit, deliberate user act
    assert.match(
      src,
      /censorTog['"]\)?\s*\)?\.addEventListener\(\s*['"]change['"]/,
      `${f} flips CENSOR only on the toggle's change event`
    );
    // ...and the page is painted censored before a human can read or share it
    assert.match(src, /^\s*paintCensor\(\);/m, `${f} paints censored on load`);
  }
});

// ── every visible swear is censorable ────────────────────────────────────────
// Each read of a swear out of the payload must be wrapped in sww() (a censorable
// span paintCensor owns) or censor() (unconditional). A raw read is a word that
// renders uncensored while the toggle says "Censored" — the exact bug this guards.
// NB: `favKind.word` is deliberately NOT here: courtesies are lexicon constants
// (please/thanks), safe uncensored — see the note in src/sharecard.mjs.
const SWEAR_READS = [
  /\bfav\.word\b/g, // favourite word — KPI tile + card preview
  /\bw\.word\b/g, // the hit-list board
  /\bc\.[ab]\b/g, // the signature combo (two swears in one message)
  /\bS\.topWords\[0\]\.word\b/g, // the browser scanner's top word
];
const WRAPPED = /(?:sww|censor)\(\s*[A-Za-z0-9_.$[\]]*$/;

test("every visible swear routes through the sww()/paintCensor path", () => {
  for (const f of TOGGLE_SURFACES) {
    const src = read(f);
    const raw = [];
    for (const re of SWEAR_READS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const before = src.slice(Math.max(0, m.index - 40), m.index);
        if (!WRAPPED.test(before)) {
          raw.push(`${f}:${lineOf(src, m.index)} — ${JSON.stringify(src.slice(Math.max(0, m.index - 14), m.index + 10))}`);
        }
      }
    }
    assert.deepEqual(raw, [], `swear rendered without sww()/censor():\n${raw.join("\n")}`);
  }
});

// The regression that motivated this file. The donate section did
//   const ct=$('credit-tip'); ct.href=url;
// for an element that is NOT in the markup. donate is ON by default, so on every
// REAL report that TypeError killed the rest of the inline script — including
// paintCensor(), the function that turns the swear spans into f***. Result: every
// swear rendered RAW under a toggle that still read "Censored 🙈". The generated
// samples never caught it because they build with donate OFF, so the throwing line
// was never reached. Every $() here resolves an id (all three surfaces define
// `$ = (id) => document.getElementById(id)`), so a missing id is a live null deref.
// Full-line // comments are dropped first: prose (and commented-out code) is not
// a live deref, and the note above is allowed to quote the call that caused this.
const stripLineComments = (src) => src.replace(/^\s*\/\/.*$/gm, "");

test("every element the inline script reaches for exists in the markup", () => {
  for (const f of [...TOGGLE_SURFACES, "assets/kindness_template.html", "docs/kindness.html"]) {
    const src = read(f);
    const code = stripLineComments(src);
    const ids = new Set([...code.matchAll(/\$\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g)].map((m) => m[1]));
    const missing = [...ids].filter((id) => !src.includes(`id="${id}"`));
    assert.deepEqual(missing, [], `${f}: script reaches for ${missing.map((i) => "#" + i).join(", ")} — not in the markup`);
  }
});

// Defence in depth for the same class of failure: censoring must not depend on a
// later line surviving. The span is written censored, so even a total script
// abort leaves a censored page — no raw word is ever put into the DOM.
test("sww() spans render CENSORED at creation, not only via paintCensor()", () => {
  for (const f of TOGGLE_SURFACES) {
    const src = read(f);
    assert.match(
      src,
      /class="sww" data-w="\$\{w\}">\$\{\s*CENSOR\s*\?\s*censor\(w\)\s*:\s*w\s*\}/,
      `${f} must write the span already censored (CENSOR starts true)`
    );
  }
});

test("paintCensor repaints EVERY .sww span, and the raw word lives only in data-w", () => {
  for (const f of TOGGLE_SURFACES) {
    const src = read(f);
    assert.match(src, /querySelectorAll\(\s*['"]\.sww['"]\s*\)/, `${f} repaints every .sww span`);
    assert.match(
      src,
      /CENSOR\s*\?\s*censor\(\s*el\.dataset\.w\s*\)\s*:\s*el\.dataset\.w/,
      `${f} renders censor(word) while CENSOR is on`
    );
    assert.match(src, /class="sww" data-w="\$\{w\}"/, `${f} keeps the raw word in data-w only`);
  }
});

// ── what LEAVES is censored unconditionally ──────────────────────────────────
test("the caption builder censors the favourite word unconditionally", () => {
  for (const f of ["assets/report_template.html", "docs/demo.html"]) {
    const src = read(f);
    const cap = src.match(/const wrappedCaption=[\s\S]*?;\n/);
    assert.ok(cap, `${f} builds the wrapped caption`);
    assert.match(cap[0], /censor\(fav\.word\)/, `${f} caption censors the favourite`);
    assert.ok(!/CENSOR/.test(cap[0]), `${f} caption must NOT consult the on-screen toggle`);
  }
});

test("the card's favLabel calls censor() unconditionally on EVERY card surface", () => {
  for (const f of CARD_SURFACES) {
    const src = read(f);
    const card = src.match(/const CARD=\{[\s\S]*?\n\};/);
    assert.ok(card, `${f} builds the CARD display object`);
    assert.match(card[0], /favLabel:fav\?censor\(fav\.word\):'—'/, `${f} card label is censored`);
    assert.ok(!/CENSOR/.test(card[0]), `${f} card must NOT consult the on-screen toggle`);
  }
});

test("the share wiring never puts a raw swear into what leaves the page", () => {
  for (const f of CARD_SURFACES) {
    const src = read(f);
    const st = src.match(/const shareText=`[^`]*`/);
    assert.ok(st, `${f} builds shareText`);
    assert.ok(!/\.word\b/.test(st[0]), `${f} shareText reads no word — numbers and fixed copy only`);
    assert.ok(!/CENSOR/.test(st[0]), `${f} shareText must NOT consult the on-screen toggle`);
    // the toast/label copy must never promise a raw word either
    assert.ok(!/uncensored/i.test(st[0]), `${f} shareText says nothing about uncensored words`);
  }
});

// ── the share sheet carries the CARD, not a link ─────────────────────────────
test("the generated card travels as a PNG — never a URL standing in for it", () => {
  for (const f of CARD_SURFACES) {
    const src = read(f);
    assert.match(src, /c\.toBlob\(.*'image\/png'\)/s, `${f} rasterizes the card to PNG`);
    assert.match(src, /navigator\.canShare\(\{files:\[file\]\}\)/, `${f} asks whether the FILE can be shared`);
    assert.match(
      src,
      /navigator\.share\(\{files:\[file\],text:shareText\}\)/,
      `${f} shares the file itself — no url standing in for the card`
    );
    // Web Share Level 2 rejects image/svg+xml everywhere: an SVG File is silently
    // dropped and the post degrades to a bare link. It must never be offered again.
    assert.ok(
      !/new File\(\[[^\]]*\],\s*'[^']*\.svg'/.test(src),
      `${f} must not hand an SVG File to the share sheet (it gets dropped)`
    );
    assert.ok(!/navigator\.share\([^)]*\burl:/.test(src), `${f} never presents a URL as the card`);
    // the clipboard + download fallbacks, so the card still reaches the user
    assert.match(src, /new ClipboardItem\(\{'image\/png':blob\}\)/, `${f} falls back to copying the PNG`);
    assert.match(src, /function savePng\(/, `${f} falls back to downloading the PNG`);
  }
});

test("the X/LinkedIn composers copy the card first and say so honestly", () => {
  for (const f of CARD_SURFACES) {
    const src = read(f);
    const fn = src.match(/async function shareToComposer\([\s\S]*?\n\}/);
    assert.ok(fn, `${f} routes the web intents through shareToComposer`);
    // the card goes to the clipboard BEFORE the composer opens
    assert.ok(
      fn[0].indexOf("copyPngToClipboard") < fn[0].indexOf("openSocial"),
      `${f} copies the card before opening the composer`
    );
    assert.match(fn[0], /Card image copied — paste it into your \$\{network\} post/, `${f} tells the user to paste it`);
    // an intent can't attach an image: never claim it posted the card
    assert.ok(!/posted for you|card posted|shared to (X|LinkedIn)/i.test(fn[0]), `${f} never claims the card was posted`);
  }
});
