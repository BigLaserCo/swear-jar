// Invariants for the public site under docs/ (served at swearjar.unfocused.ai via Caddy).
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

// Every HTML page under docs/ is a public surface and must obey the invariants —
// glob so a newly-added page (admin.html, submit.html, …) is covered automatically.
const PAGES = fs
  .readdirSync(DOCS)
  .filter((f) => f.endsWith(".html"))
  .sort();
// Pages that must always exist (the site is broken without them).
const REQUIRED = ["index.html", "demo.html", "tip.html", "wrapped.html", "admin.html"];

// Permitted outbound links (click-throughs a human clicks, NOT page-load
// subresources — those stay banned below). LINKS are allowed; a page-load REQUEST
// to any of these is still forbidden. The set: the source repo, the Stripe
// payment link (tip page), the maker's socials (footer), and the maker's own
// sites (canonical / OG / cross-links). Each entry allows a bare host (no path)
// or a path.
const ALLOWED_REF =
  /^https?:\/\/(github\.com\/BigLaserCo\/swear-jar|(buy|donate)\.stripe\.com\/|(www\.)?tiktok\.com\/|(www\.)?youtube\.com\/|([a-z0-9-]+\.)?unfocused\.ai(\/|$)|([a-z0-9-]+\.)?setupyour\.ai(\/|$))/i;

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
  for (const p of REQUIRED) {
    assert.ok(fs.existsSync(path.join(DOCS, p)), `${p} exists`);
  }
  assert.ok(fs.existsSync(path.join(DOCS, ".nojekyll")), "docs/.nojekyll exists (harmless static-serve marker)");
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
    // the ONLY <link> permitted is rel=canonical (SEO, loads nothing) — never a
    // stylesheet / font / icon / preload, which WOULD fetch a subresource.
    for (const l of [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])) {
      assert.match(l, /rel=["']canonical["']/i, `only rel=canonical <link> allowed (no stylesheets/fonts/icons): ${l}`);
    }
  });

  test(`${name} contains no uncensored lexicon words in its visible text`, () => {
    const html = readPage(name);
    const { words, coins } = detect(visibleText(html));
    assert.equal(coins, 0, `visible text owes the jar ${coins} coins: ${JSON.stringify(words)}`);
  });
}

// The maker's socials live in the shared footer of these pages (identical line).
// Plain human-clicked anchors with rel="noopener" — links, never page-load requests.
for (const name of ["index.html", "tip.html", "wrapped.html", "admin.html"]) {
  test(`${name} footer carries the maker's social links (rel=noopener)`, () => {
    const html = readPage(name);
    const tiktok = html.match(/<a\b[^>]*href="https:\/\/tiktok\.com\/@biglaserco"[^>]*>/i);
    const youtube = html.match(/<a\b[^>]*href="https:\/\/youtube\.com\/@BigLaserCo"[^>]*>/i);
    assert.ok(tiktok, "TikTok anchor present");
    assert.ok(youtube, "YouTube anchor present");
    assert.match(tiktok[0], /rel="[^"]*noopener/i, "TikTok link is rel=noopener");
    assert.match(youtube[0], /rel="[^"]*noopener/i, "YouTube link is rel=noopener");
    assert.match(html, /Follow the maker/i, "the shared social line label is present");
  });
}
