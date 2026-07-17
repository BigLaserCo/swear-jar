// Guards the bug class that silently killed censoring on every real report:
// the script called $('credit-tip') for an element that was not in the markup,
// so it threw at top level and every statement AFTER it — including the
// paintCensor() call that hides swears — never ran. Censored mode looked on and
// did nothing. A grep could not see it; only running the page could. These tests
// make the failure impossible to reintroduce without running a browser.
//
// Two independent guarantees:
//   1. no dangling $('id') — every id the script looks up exists in the markup;
//   2. censored BY DEFAULT — the swear span is emitted already censored, so a
//      swear is never raw on screen even if no later pass ever runs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "..", "assets");
const DOCS = path.join(HERE, "..", "docs");
const WEB = path.join(HERE, "..", "web");

// Every surface that renders swears from an embedded payload.
const TEMPLATES = [
  path.join(ASSETS, "report_template.html"),
  path.join(ASSETS, "kindness_template.html"),
  path.join(DOCS, "demo.html"),
  path.join(DOCS, "kindness.html"),
  path.join(WEB, "app.html"),
];

const read = (f) => fs.readFileSync(f, "utf8");
const name = (f) => path.relative(path.join(HERE, ".."), f);

// Comments and HTML markup-comments describe code; they do not run it. A lookup
// written in prose ("there was a $('credit-tip') here") must not count as a live
// reference, or the guard cries wolf over the very note explaining the fix.
function stripComments(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:'"`])\/\/[^\n]*/g, "$1"); // not a URL's //
}

// ids the page LOOKS UP: $('x') / getElementById('x'). Ignores the helper's own
// definition (`const $=id=>document.getElementById(id)`) — a parameter, not a literal.
function referencedIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\$\(\s*['"]([^'"]+)['"]\s*\)/g)) ids.add(m[1]);
  for (const m of html.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) ids.add(m[1]);
  return ids;
}

// ids the markup DEFINES, including ones built inside JS template strings.
function definedIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/g)) ids.add(m[1]);
  return ids;
}

for (const file of TEMPLATES) {
  test(`${name(file)}: every $('id') it looks up exists in the markup`, () => {
    const html = read(file);
    const defined = definedIds(html); // ids may be declared anywhere, comments included
    const missing = [...referencedIds(stripComments(html))].filter((id) => !defined.has(id));
    assert.deepEqual(
      missing,
      [],
      `dangling id lookup(s) ${JSON.stringify(missing)} — these return null, and the ` +
        `first property access on one throws at top level, killing every statement ` +
        `after it in that script (that is how paintCensor() died and swears rendered raw).`,
    );
  });
}

test("the swear span is emitted ALREADY censored — never raw pending a later pass", () => {
  const html = read(path.join(ASSETS, "report_template.html"));
  const sww = /const sww\s*=\s*w\s*=>\s*`([^`]+)`/.exec(html);
  assert.ok(sww, "sww() must exist — it is the only sanctioned way to print a swear");
  assert.match(
    sww[1],
    /\$\{\s*CENSOR\s*\?\s*censor\(w\)\s*:\s*w\s*\}/,
    "the span's initial text must be censor(w) when CENSOR is on. Emitting the raw " +
      "word and relying on paintCensor() to hide it later is what shipped raw swears.",
  );
  assert.match(html, /let CENSOR\s*=\s*true/, "censored mode is the default");
});

test("nothing prints a swear outside the censor helper", () => {
  const html = read(path.join(ASSETS, "report_template.html"));
  // The payload's raw words may only reach the DOM through sww() or paintCensor().
  const rawUses = [...html.matchAll(/\$\{\s*(?:w|fav\.word|top\.word)\s*\}/g)].map((m) => m[0]);
  const inSww = /const sww\s*=\s*w\s*=>/.test(html);
  assert.ok(inSww, "sww() is the single choke point for rendering a swear");
  for (const use of rawUses) {
    const i = html.indexOf(use);
    const line = html.slice(html.lastIndexOf("\n", i) + 1, html.indexOf("\n", i));
    assert.ok(
      /sww|data-w|censor\(/.test(line),
      `raw word interpolation outside the censor path: ${line.trim().slice(0, 90)}`,
    );
  }
});
