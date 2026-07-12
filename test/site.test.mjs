// Invariants for the public site under docs/ (GitHub Pages).
//
// Two hard guarantees, enforced on every build:
//   1. Zero external requests. The only http(s) references allowed anywhere in
//      docs/*.html are links to github.com/BigLaserCo/swear-jar. No CDN, no
//      fonts, no analytics, no remote images.
//   2. The site itself owes the jar nothing. Running the REAL detector over the
//      visible text (scripts + styles + tags stripped) must find zero swears —
//      censored forms like f*** are fine and expected, but no uncensored word
//      may appear where a reader can see it.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detect } from "../src/detect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(HERE, "..", "docs");
const PAGES = ["index.html", "demo.html", "tip.html", "wrapped.html"];

// Permitted outbound links (click-throughs, NOT page-load subresources — those
// are separately banned below): the source repo, and the Stripe payment link on
// the tip page (the one page whose whole job is to send you to checkout).
const ALLOWED_REF =
  /^https?:\/\/(github\.com\/BigLaserCo\/swear-jar|(buy|donate)\.stripe\.com\/)/i;

function readPage(name) {
  return fs.readFileSync(path.join(DOCS, name), "utf8");
}

// visible text = everything a reader sees: scripts + styles + tags removed.
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#\d+;/g, " ");
}

test("the site pages exist and .nojekyll is present", () => {
  for (const p of PAGES) {
    assert.ok(fs.existsSync(path.join(DOCS, p)), `${p} exists`);
  }
  assert.ok(fs.existsSync(path.join(DOCS, ".nojekyll")), "docs/.nojekyll exists (Pages serves verbatim)");
});

for (const name of PAGES) {
  test(`${name} makes zero external requests (only github.com/BigLaserCo/swear-jar links)`, () => {
    const html = readPage(name);
    const refs = [...html.matchAll(/https?:\/\/[^\s"'`<>()]+/gi)].map((m) => m[0]);
    const disallowed = refs.filter((u) => !ALLOWED_REF.test(u));
    assert.deepEqual(disallowed, [], `only swear-jar repo links allowed; found: ${disallowed.join(", ")}`);
    // protocol-relative hosts (//cdn.example.com) are external too — none allowed
    assert.ok(!/["'(\s]\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(html), "no protocol-relative external hosts");
    // no external subresource tags
    assert.ok(!/<script\s[^>]*\bsrc=/i.test(html), "no external <script src>");
    assert.ok(!/<link\b[^>]*\bhref=/i.test(html), "no <link href> (stylesheets/fonts/icons)");
  });

  test(`${name} contains no uncensored lexicon words in its visible text`, () => {
    const html = readPage(name);
    const { words, coins } = detect(visibleText(html));
    assert.equal(coins, 0, `visible text owes the jar ${coins} coins: ${JSON.stringify(words)}`);
  });
}
