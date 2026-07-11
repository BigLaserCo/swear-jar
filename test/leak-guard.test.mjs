// Unit + integration coverage for the leak-guard supply-chain scanner. The
// unit tests drive the PURE detection function (`detectLeaks`) with in-memory
// fixtures — no spawning, no temp files. The integration test runs the guard
// over the REAL tracked source and asserts the repo is clean today.
//
// NB: the fixtures below deliberately contain internal tokens (@blc/…,
// BlcCommon) as STRING DATA passed to the detector. This file lives under
// test/, which the guard does NOT scan, so these fixtures never trip CI.

import test from "node:test";
import assert from "node:assert/strict";
import {
  detectLeaks,
  runGuard,
  formatHit,
  INTERNAL_TOKENS,
} from "../scripts/ci/leak-guard.mjs";

const ROOT = new URL("../", import.meta.url).pathname;

// Convenience: run the detector over a single { path, text } fixture.
const scan = (path, text) => detectLeaks([{ path, text }]);
const kinds = (hits) => hits.map((h) => h.kind);

// ── clean fixtures pass ──────────────────────────────────────────────────────
test("clean source with node: + relative imports produces no hits", () => {
  const text = [
    'import fs from "node:fs";',
    'import path from "node:path";',
    'import { detect } from "./detect.mjs";',
    'import { COIN_VALUE } from "../src/render.mjs";',
    "export function f() { return fs.readFileSync(path.join('.', 'x')); }",
  ].join("\n");
  assert.deepEqual(scan("src/clean.mjs", text), []);
});

test('a node: builtin import does NOT trip', () => {
  assert.deepEqual(scan("src/a.mjs", 'import fs from "node:fs";'), []);
});

test('a relative import that stays inside the repo does NOT trip', () => {
  assert.deepEqual(scan("src/a.mjs", 'import { x } from "./ledger.mjs";'), []);
});

test('the marketing string "biglaser.co" in a caption does NOT trip', () => {
  const text = 'const caption = "Shared from biglaser.co — swear responsibly 🫙";';
  assert.deepEqual(scan("src/render.mjs", text), []);
});

// ── each hostile case trips it ───────────────────────────────────────────────
test("a first-party @blc/… import trips the guard", () => {
  const hits = scan("src/evil.mjs", 'import { persona } from "@blc/persona-runtime";');
  assert.ok(hits.length >= 1, "at least one hit");
  assert.ok(kinds(hits).includes("external-import"), "flagged as a non-stdlib import");
});

test("a first-party @biglaser/… import trips the guard", () => {
  const hits = scan("src/evil.mjs", 'import x from "@biglaser/secrets";');
  assert.ok(hits.some((h) => h.kind === "external-import"), "flagged as a non-stdlib import");
});

test("a relative import escaping the repo root trips the guard", () => {
  const hits = scan("src/evil.mjs", 'import x from "../../../Code/BlcCommon/x.mjs";');
  assert.ok(hits.some((h) => h.kind === "escaping-import"), "flagged as a repo-escaping import");
});

test('a bare npm import ("lodash") trips the guard', () => {
  const hits = scan("src/evil.mjs", 'import _ from "lodash";');
  assert.ok(hits.length >= 1, "at least one hit");
  assert.equal(hits[0].kind, "external-import");
});

test("an inline BlcCommon reference (no import) trips the guard", () => {
  const hits = scan("src/evil.mjs", "// TODO: wire this up to BlcCommon later\nconst x = 1;");
  assert.ok(hits.some((h) => h.kind === "internal-token"), "flagged as an internal-scope token");
});

test("a require() of a first-party scope trips the guard", () => {
  const hits = scan("src/evil.cjs", 'const p = require("@blc/artifact-review");');
  assert.ok(hits.some((h) => h.kind === "external-import"), "require of a scoped pkg is flagged");
});

test("a dynamic import() of a bare specifier trips the guard", () => {
  const hits = scan("src/evil.mjs", 'const m = await import("some-npm-pkg");');
  assert.ok(hits.some((h) => h.kind === "external-import"), "dynamic bare import is flagged");
});

test("a dynamic import(new URL(...)) is NOT a bare specifier and does NOT trip", () => {
  const text = 'const m = await import(new URL("../../src/scan.mjs", import.meta.url).href);';
  assert.deepEqual(
    scan("scripts/ci/verify.mjs", text).filter((h) => h.kind !== "internal-token"),
    []
  );
});

test("multi-line binding lists are parsed and vetted", () => {
  const text = 'import {\n  a,\n  b,\n  c,\n} from "@blc/persona-runtime";';
  const hits = scan("src/evil.mjs", text);
  assert.ok(hits.some((h) => h.kind === "external-import"), "multiline import specifier is vetted");
});

// ── denylist + formatting sanity ─────────────────────────────────────────────
test("the internal-token denylist is a non-empty, auditable array", () => {
  assert.ok(Array.isArray(INTERNAL_TOKENS) && INTERNAL_TOKENS.length >= 8);
  for (const [label, needle] of INTERNAL_TOKENS) {
    assert.equal(typeof label, "string");
    assert.ok(needle.length, "each needle is a non-empty string");
  }
});

test("formatHit renders a file:line [kind] detail line", () => {
  const [hit] = scan("src/evil.mjs", 'import _ from "lodash";');
  assert.match(formatHit(hit), /^src\/evil\.mjs:\d+ \[external-import\] /);
});

// ── integration: the REAL tracked source is clean ────────────────────────────
test("the guard passes over the real tracked source (repo is clean)", () => {
  const { hits, fileCount } = runGuard(ROOT);
  assert.equal(
    hits.length,
    0,
    "real source has leaks:\n" + hits.map(formatHit).join("\n")
  );
  assert.ok(fileCount > 0, "the guard actually scanned some source files");
});
