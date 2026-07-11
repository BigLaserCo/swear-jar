import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDashboard, writeDashboard } from "../src/dashboard.mjs";
import { computeStats } from "../src/stats.mjs";
import { survivalOdds } from "../src/odds.mjs";

const NOW = Date.parse("2026-07-09T12:00:00Z");
const HERE = path.dirname(fileURLToPath(import.meta.url));

// Synthetic ledger. Records carry an extra `text` field on purpose — the raw
// message must NEVER survive into the rendered HTML.
const SENTINEL = "you absolute muppet fix the deploy";
const FIXTURE = [
  { source: "user", project: "alpha", ts: "2026-07-06T09:15:00Z", words: { fuck: 1 }, coins: 3, text: SENTINEL },
  { source: "user", project: "alpha", ts: "2026-07-06T14:30:00Z", words: { shit: 2 }, coins: 4, text: SENTINEL },
  { source: "user", project: "beta", ts: "2026-07-07T09:05:00Z", words: { fuck: 1, damn: 1 }, coins: 4, text: SENTINEL },
  { source: "assistant", project: "beta", ts: "2026-07-07T10:00:00Z", words: { fuck: 1 }, coins: 3, text: SENTINEL },
];

function render() {
  return renderDashboard(computeStats(FIXTURE, NOW), {});
}

test("renders the expected dollar figure, project names and odds into the payload", () => {
  const html = render();
  const stats = computeStats(FIXTURE, NOW);
  assert.equal(stats.dollarsOwed, 3.5); // 14 coins * 0.25
  assert.ok(html.includes('"dollarsOwed":3.5'), "dollar figure present");
  assert.ok(html.includes('"alpha"') && html.includes('"beta"'), "project names present");
  assert.ok(html.includes(`"value":${survivalOdds(FIXTURE, NOW).odds}`), "odds value present");
  assert.ok(html.includes('"word":"fuck"'), "top word family present");
});

test("HTML carries only word-family names and numbers — never message text", () => {
  const html = render();
  assert.ok(!html.includes(SENTINEL), "raw message text must not leak");
  assert.ok(!html.includes("muppet"), "no fragment of message text");
  // the word families themselves ARE allowed (they are not message text)
  assert.ok(html.includes('"fuck"'));
});

test("HTML makes zero external requests (no http/https anywhere)", () => {
  const html = render();
  assert.ok(!/https?:/i.test(html), "no http(s) URLs at all");
  assert.ok(!/\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(html), "no protocol-relative hosts");
  assert.ok(!/<script\s+src=/i.test(html) && !/<link\b/i.test(html), "no external script/link tags");
});

test("censor toggle defaults to ON (sharing is censored)", () => {
  const html = render();
  assert.ok(/id="censorTog"[^>]*checked/.test(html), "censor checkbox checked by default");
});

test("donate button is hidden by default and only appears with a configured URL", () => {
  const off = renderDashboard(computeStats(FIXTURE, NOW), {});
  assert.ok(!off.includes('"donate_url"'), "no donate URL injected into the data payload by default");
  const on = renderDashboard(computeStats(FIXTURE, NOW), { donateUrl: "https://example.test/give" });
  assert.ok(on.includes('"donate_url":"https://example.test/give"'), "configured URL injected");
});

test("writeDashboard writes report.html and returns its path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swearjar-dash-"));
  try {
    const out = path.join(dir, "report.html");
    const returned = writeDashboard(FIXTURE, { now: NOW, outPath: out });
    assert.equal(returned, out);
    assert.ok(fs.existsSync(out), "report.html written");
    const html = fs.readFileSync(out, "utf8");
    assert.equal(html, renderDashboard(computeStats(FIXTURE, NOW), {}));
    assert.ok(html.startsWith("<!doctype html>"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("dashboard never opens a browser (no open/spawn in source)", () => {
  const src = fs.readFileSync(path.join(HERE, "..", "src", "dashboard.mjs"), "utf8");
  assert.ok(!/xdg-open|child_process|\bspawn\b|\bexecSync\b|\bexec\(/.test(src), "no process/browser launching");
  assert.ok(!/\bopen\s*\(/.test(src), "no open() call");
});
