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
  .filter((f) => f.endsWith(".html") && !f.startsWith("_"))
  .sort();
// Pages that must always exist (the site is broken without them).
const REQUIRED = ["index.html", "demo.html", "tip.html", "wrapped.html", "admin.html"];

// Permitted outbound links (click-throughs a human clicks, NOT page-load
// subresources — those stay banned below). LINKS are allowed; a page-load REQUEST
// to any of these is still forbidden. The set: the source repo, the Stripe
// payment link (tip page), the maker's socials (footer), and the maker's own
// sites (canonical / OG / cross-links). Each entry allows a bare host (no path)
// or a path.
// schema.org is the JSON-LD @context — a semantic namespace identifier, NOT a
// page subresource (browsers/crawlers never fetch it on load), so it does not
// break the zero-request guarantee.
const ALLOWED_REF =
  /^https?:\/\/(github\.com\/BigLaserCo\/swear-jar|(buy|donate)\.stripe\.com\/|(www\.)?tiktok\.com\/|(www\.)?youtube\.com\/|([a-z0-9-]+\.)?unfocused\.ai|([a-z0-9-]+\.)?setupyour\.ai|biglaser\.co|((www\.)?x\.com\/intent\/post)|((www\.)?linkedin\.com\/sharing\/share-offsite)|((www\.)?w3\.org\/2000\/svg)|schema\.org)/i;

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
    // Canonical is metadata; the only local page-load asset permitted is the
    // repo-owned stylesheet. Never add a remote stylesheet/font/icon/preload.
    for (const l of [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0])) {
      assert.ok(/rel=["']canonical["']/i.test(l) || /rel=["']stylesheet["'][^>]*href=["'](?:site|fab)\.css["']/i.test(l), `only canonical or local site/fab.css <link> allowed: ${l}`);
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

// ── SEO / discovery ──────────────────────────────────────────────────────────
// Canonical origin every public URL lives under.
const ORIGIN = "https://swearjar.unfocused.ai";
// Public, indexable pages → their canonical URL. admin.html is deliberately
// EXCLUDED (noindex, debug console) and must never appear in the sitemap.
const PUBLIC_CANONICALS = {
  "index.html": `${ORIGIN}/`,
  "origin.html": `${ORIGIN}/origin.html`,
  "uprising.html": `${ORIGIN}/uprising.html`,
  "terms.html": `${ORIGIN}/terms.html`,
  "demo.html": `${ORIGIN}/demo.html`,
  "kindness.html": `${ORIGIN}/kindness.html`,
  "tip.html": `${ORIGIN}/tip.html`,
  "wrapped.html": `${ORIGIN}/wrapped.html`,
  "submit.html": `${ORIGIN}/submit.html`,
};

function titleOf(html) {
  return (html.match(/<title>([^<]*)<\/title>/i) || [])[1]?.trim();
}
function descOf(html) {
  return (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) || [])[1]?.trim();
}
function canonicalOf(html) {
  return (html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i) || [])[1]?.trim();
}

test("every page has a unique, non-empty title, description and canonical", () => {
  const titles = new Set();
  const descs = new Set();
  const canons = new Set();
  for (const name of PAGES) {
    const html = readPage(name);
    const t = titleOf(html);
    const d = descOf(html);
    const c = canonicalOf(html);
    assert.ok(t, `${name} has a <title>`);
    assert.ok(d, `${name} has a meta description`);
    assert.ok(c && c.startsWith(ORIGIN), `${name} has a canonical under ${ORIGIN} (got ${c})`);
    assert.ok(!titles.has(t), `${name} title is unique (dupe: ${t})`);
    assert.ok(!descs.has(d), `${name} description is unique`);
    assert.ok(!canons.has(c), `${name} canonical is unique (dupe: ${c})`);
    titles.add(t);
    descs.add(d);
    canons.add(c);
  }
});

test("every page ships Open Graph + Twitter card tags", () => {
  for (const name of PAGES) {
    const html = readPage(name);
    assert.match(html, /<meta\s+property="og:title"/i, `${name} has og:title`);
    assert.match(html, /<meta\s+property="og:url"/i, `${name} has og:url`);
    assert.match(html, /<meta\s+name="twitter:card"/i, `${name} has a twitter:card`);
  }
});

test("admin.html is excluded from search (noindex) and unique-canonicalled", () => {
  const html = readPage("admin.html");
  assert.match(html, /<meta\s+name="robots"\s+content="noindex/i, "admin is noindex");
  assert.equal(canonicalOf(html), `${ORIGIN}/admin.html`);
});

test("index.html carries SoftwareApplication + Organization + FAQPage JSON-LD", () => {
  const html = readPage("index.html");
  const blocks = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  assert.ok(blocks.length >= 3, `expected >=3 JSON-LD blocks, got ${blocks.length}`);
  const types = blocks.map((b) => {
    const parsed = JSON.parse(b); // throws on invalid JSON-LD → fails the test
    return parsed["@type"];
  });
  assert.ok(types.includes("SoftwareApplication"), "SoftwareApplication present");
  assert.ok(types.includes("Organization"), "Organization present");
  assert.ok(types.includes("FAQPage"), "FAQPage present");
  const app = JSON.parse(blocks[types.indexOf("SoftwareApplication")]);
  assert.equal(app.license, "MIT", "declared MIT-licensed");
  assert.equal(app.offers.price, "0", "declared free");
});

test("robots.txt exists, allows all, names AI crawlers, and points at the sitemap", () => {
  const robots = fs.readFileSync(path.join(DOCS, "robots.txt"), "utf8");
  assert.match(robots, /User-agent:\s*\*/i, "has a wildcard agent");
  assert.match(robots, /Allow:\s*\//i, "allows crawling");
  for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot"]) {
    assert.ok(robots.includes(bot), `explicitly allows ${bot}`);
  }
  assert.match(robots, new RegExp(`Sitemap:\\s*${ORIGIN}/sitemap\\.xml`), "declares the sitemap");
});

test("sitemap.xml parses and covers EXACTLY the public pages (never admin.html)", () => {
  const xml = fs.readFileSync(path.join(DOCS, "sitemap.xml"), "utf8");
  assert.match(xml, /^<\?xml/, "is an XML document");
  assert.match(xml, /<urlset\b[^>]*sitemaps\.org\/schemas\/sitemap\/0\.9/i, "is a sitemap urlset");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1].trim()).sort();
  const expected = Object.values(PUBLIC_CANONICALS).sort();
  assert.deepEqual(locs, expected, "sitemap URLs == public canonicals");
  assert.ok(!xml.includes("admin.html"), "admin.html is never in the sitemap");
});

test("llms.txt exists with the brand, the privacy stance, an install one-liner and links", () => {
  const llms = fs.readFileSync(path.join(DOCS, "llms.txt"), "utf8");
  assert.match(llms, /Swear Jar/, "names the brand");
  assert.match(llms, /local|no upload|never a transcript/i, "states the privacy stance");
  assert.match(llms, /git clone https:\/\/github\.com\/BigLaserCo\/swear-jar/i, "has the install one-liner");
  assert.match(llms, /github\.com\/BigLaserCo\/swear-jar/, "links the source");
});
