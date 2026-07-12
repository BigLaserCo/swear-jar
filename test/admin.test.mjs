// Invariants for the generated debug console (docs/admin.html).
//
// It is open (no auth) and fully client-side, so it must obey the same two hard
// guarantees as the rest of the site — zero external requests, censored words
// only — while additionally being a faithful, deterministic state gallery.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { detect } from "../src/detect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const ADMIN = path.join(ROOT, "docs", "admin.html");
const BUILDER = path.join(ROOT, "scripts", "site", "buildAdmin.mjs");

// Click-through hosts allowed on the admin page: the source repo, the canonical
// site (canonical/OG tags), and the maker's socials in the shared footer.
const ALLOWED_REF =
  /^https?:\/\/(github\.com\/BigLaserCo\/swear-jar|swearjar\.unfocused\.ai\/|(www\.)?tiktok\.com\/|(www\.)?youtube\.com\/)/i;

function read() {
  return fs.readFileSync(ADMIN, "utf8");
}
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#\d+;/g, " ");
}

test("admin.html exists and is the generated debug console", () => {
  assert.ok(fs.existsSync(ADMIN), "docs/admin.html exists");
  assert.match(read(), /debug console/i);
});

test("admin.html makes zero external requests (only allowed click-throughs)", () => {
  const html = read();
  const refs = [...html.matchAll(/https?:\/\/[^\s"'`<>()]+/gi)].map((m) => m[0]);
  const disallowed = refs.filter((u) => !ALLOWED_REF.test(u));
  assert.deepEqual(disallowed, [], `only repo/site/social links allowed; found: ${disallowed.join(", ")}`);
  assert.ok(!/["'(\s]\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(html), "no protocol-relative external hosts");
  assert.ok(!/<script\s[^>]*\bsrc=/i.test(html), "no external <script src>");
  // the ONLY <link> permitted is rel=canonical — never a stylesheet/font/icon
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  for (const l of links) assert.match(l, /rel=["']canonical["']/i, `only canonical <link> allowed: ${l}`);
});

test("admin.html shows no uncensored lexicon words in its visible chrome", () => {
  // The embedded state documents live inside a <script> data island and are
  // stripped here; only the console's own visible text is checked.
  const { coins, words } = detect(visibleText(read()));
  assert.equal(coins, 0, `visible text owes the jar ${coins} coins: ${JSON.stringify(words)}`);
});

test("admin.html carries every advertised state and the live editor", () => {
  const html = read();
  for (const key of ["normal", "empty", "gold", "royalty", "held", "submitOk", "submitErr"]) {
    assert.ok(html.includes(`data-state="${key}"`), `state button ${key} present`);
  }
  assert.ok(html.includes('id="apply"') && html.includes('id="ed-coins"'), "live stats editor present");
  assert.ok(/href="demo\.html"/.test(html), "links the shareable demo");
  assert.match(html, /content="noindex/i, "excluded from search indexes");
});

test("admin.html keeps the note for the smart-ass reading the source", () => {
  assert.match(read(), /smart-ass reading the source/i);
});

test("buildAdmin.mjs is deterministic (byte-for-byte reproducible)", () => {
  const before = read();
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "swear-admin-"));
  try {
    // regenerate in place and confirm identical bytes
    execFileSync(process.execPath, [BUILDER], { cwd: ROOT, env: { ...process.env, SWEAR_JAR_HOME: tmpHome } });
    assert.equal(read(), before, "regenerated admin.html is byte-identical");
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
