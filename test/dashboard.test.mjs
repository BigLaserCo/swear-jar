import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderDashboard, writeDashboard } from "../src/dashboard.mjs";
import { computeStats } from "../src/stats.mjs";
import { survivalOdds } from "../src/odds.mjs";
import { DONATE_URL } from "../src/donate.mjs";

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
  assert.equal(stats.dollarsOwed, 5.5); // $1 fuck + $1 shit + $.50 damn + $1 machine fuck
  assert.ok(html.includes('"dollarsOwed":5.5'), "dollar figure present");
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

test("HTML auto-requests nothing — external URLs are human-clicked share and footer links", () => {
  const HOSTED = "https://swearjar.unfocused.ai/wrapped?tc=1";
  const html = renderDashboard(computeStats(FIXTURE, NOW), { hostedUrl: HOSTED });
  // no subresources, no scripted network: nothing loads or phones home on open
  assert.ok(!/<script\s+src=/i.test(html) && !/<link\b/i.test(html), "no external script/link tags");
  assert.ok(
    !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|new\s+EventSource/.test(html),
    "no scripted network calls"
  );
  // Every http(s) reference is a human-clicked link: tip jar, optional report
  // share, social composers, source, and maker credits. Nothing is fetched on load.
  const urls = [...html.matchAll(/https?:\/\/[^\s"'`<>()]+/gi)].map((m) => m[0]);
  const allowed = [DONATE_URL, HOSTED, "https://github.com/BigLaserCo/swear-jar", "https://swearjar.unfocused.ai/", "https://x.com/intent/post?", "https://www.linkedin.com/sharing/share-offsite/?", "https://youtube.com/@BigLaserCo", "https://tiktok.com/@biglaserco", "https://setupyour.ai", "https://biglaser.co", "http://www.w3.org/2000/svg"];
  const foreign = urls.filter((u) => !allowed.some((prefix) => u === prefix || u.startsWith(prefix)));
  assert.deepEqual(foreign, [], `found unexpected external URL: ${foreign.join(", ")}`);
  // With donation and optional report share hidden, static source/social links remain.
  const off = renderDashboard(computeStats(FIXTURE, NOW), { donateUrl: false });
  assert.ok(!/https:\/\/[^"'`<>()]*wrapped/i.test(off), "no hosted report URL when lights are hidden");
});

test("hosted 'in lights' button injects only when a hosted URL is provided", () => {
  const HOSTED = "https://swearjar.unfocused.ai/wrapped?tc=42";
  const on = renderDashboard(computeStats(FIXTURE, NOW), { hostedUrl: HOSTED });
  assert.ok(on.includes(`"hosted_wrapped_url":${JSON.stringify(HOSTED)}`), "hosted URL injected as data");
  const off = renderDashboard(computeStats(FIXTURE, NOW), {});
  assert.ok(!off.includes('"hosted_wrapped_url"'), "no hosted URL by default in renderDashboard");
});

test("censor toggle defaults to ON (sharing is censored)", () => {
  const html = render();
  assert.ok(/id="censorTog"[^>]*checked/.test(html), "censor checkbox checked by default");
});

test("donate is default-ON (DONATE_URL); a custom URL overrides; donateUrl:false hides", () => {
  const def = renderDashboard(computeStats(FIXTURE, NOW), {});
  assert.ok(
    def.includes(`"donate_url":${JSON.stringify(DONATE_URL)}`),
    "the default render points the donate section at DONATE_URL"
  );
  const on = renderDashboard(computeStats(FIXTURE, NOW), { donateUrl: "https://example.test/give" });
  assert.ok(on.includes('"donate_url":"https://example.test/give"'), "configured URL overrides the default");
  const off = renderDashboard(computeStats(FIXTURE, NOW), { donateUrl: false });
  assert.ok(!off.includes('"donate_url"'), "donateUrl:false (--no-donate) hides the section");
});

test("writeDashboard writes report.html and returns its path", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swearjar-dash-"));
  try {
    const out = path.join(dir, "report.html");
    // hostedUrl:false keeps the equality check deterministic (the default path
    // injects a computed hosted URL — exercised in the allowlist test above).
    const returned = writeDashboard(FIXTURE, { now: NOW, outPath: out, hostedUrl: false });
    assert.equal(returned, out);
    assert.ok(fs.existsSync(out), "report.html written");
    const html = fs.readFileSync(out, "utf8");
    assert.equal(html, renderDashboard(computeStats(FIXTURE, NOW), { hostedUrl: false }));
    assert.ok(html.startsWith("<!doctype html>"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("writeDashboard injects the hosted 'in lights' button by default, omits it when local-only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swearjar-dash2-"));
  try {
    const def = fs.readFileSync(writeDashboard(FIXTURE, { now: NOW, outPath: path.join(dir, "a.html") }), "utf8");
    assert.match(def, /"hosted_wrapped_url":"https:\/\/swearjar\.unfocused\.ai\/wrapped\?/, "default carries the hosted button");
    const loc = fs.readFileSync(writeDashboard(FIXTURE, { now: NOW, outPath: path.join(dir, "b.html"), localOnly: true }), "utf8");
    assert.ok(!loc.includes('"hosted_wrapped_url"'), "local-only omits the hosted button");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("gold-star state is driven by the goldStar flag in the payload, and the banner element ships", () => {
  // swear-heavy fixture → not a gold star
  const off = render();
  assert.ok(off.includes('"goldStar":false'), "goldStar:false for a swearing ledger");
  // mannered ledger → gold star on
  const mannered = [
    { source: "user", project: "a", ts: "2026-07-06T09:15:00Z", words: { damn: 1 }, coins: 1, polite: { please: 2, thanks: 1 } },
  ];
  const on = renderDashboard(computeStats(mannered, NOW), {});
  assert.ok(on.includes('"goldStar":true'), "goldStar:true when manners beat swears");
  // the banner element is present in the template either way (JS toggles .on)
  assert.ok(on.includes('id="goldstar"'), "gold-star banner element ships in the template");
});

test("dashboard never opens a browser (no open/spawn in source)", () => {
  const src = fs.readFileSync(path.join(HERE, "..", "src", "dashboard.mjs"), "utf8");
  assert.ok(!/xdg-open|child_process|\bspawn\b|\bexecSync\b|\bexec\(/.test(src), "no process/browser launching");
  assert.ok(!/\bopen\s*\(/.test(src), "no open() call");
});
