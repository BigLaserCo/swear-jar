// Tests for the hosted web app's client-side scanning layer.
//
// Two jobs:
//   1. Prove web/browser-scan.mjs reproduces src/scan.mjs's filtering EXACTLY
//      (same records, same coins, same skips) — and pin its mirrored text-hygiene
//      helpers to the audited source by cross-checking against the REAL exports.
//   2. Prove the browser contract holds: browser-scan.mjs imports no node builtin,
//      and web/app.html makes no external request and shows no uncensored swears.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  scanFileText,
  scanFiles,
  extractText,
  stripInjected,
  isSkippable,
  projectFor,
} from "../web/browser-scan.mjs";
import { detect } from "../src/detect.mjs";
// The audited source of truth. Node-only (node:fs) — importable in a test, NOT in
// a browser — which is exactly why browser-scan.mjs mirrors these three helpers.
import {
  extractText as srcExtractText,
  stripInjected as srcStripInjected,
  isSkippable as srcIsSkippable,
} from "../src/scan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, "..", "web");

function line(obj) {
  return JSON.stringify(obj) + "\n";
}
function userMsg(uuid, text, extra = {}) {
  return {
    type: "user",
    uuid,
    timestamp: "2026-07-09T12:00:00.000Z",
    sessionId: "sess-1",
    cwd: "/Users/dev/Code/example-app",
    message: { role: "user", content: text },
    ...extra,
  };
}
function assistantMsg(uuid, text) {
  return {
    type: "assistant",
    uuid,
    timestamp: "2026-07-09T12:00:05.000Z",
    sessionId: "sess-1",
    cwd: "/Users/dev/Code/example-app",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

// ── the port is pinned to the audited source ─────────────────────────────────
// If src/scan.mjs's helpers ever change, these cross-checks go red, forcing the
// browser mirror to be updated in lockstep.

test("mirrored extractText matches src/scan.mjs over a battery of message shapes", () => {
  const cases = [
    { content: "plain string body with fuck" },
    { content: [{ type: "text", text: "block one" }, { type: "text", text: "block two" }] },
    { content: [{ type: "tool_result", content: "damn output" }, { type: "text", text: "kept" }] },
    { content: [{ type: "thinking", text: "hidden" }] },
    { content: [] },
    { content: null },
    { content: undefined },
    {},
    null,
    undefined,
    { content: [{ type: "text" }, { type: "text", text: 42 }] }, // malformed blocks
  ];
  for (const message of cases) {
    assert.equal(
      extractText(message),
      srcExtractText(message),
      `extractText(${JSON.stringify(message)})`
    );
  }
});

test("mirrored stripInjected matches src/scan.mjs for every injected tag", () => {
  const cases = [
    "no tags here, just fuck",
    "before <system-reminder>fuck inside</system-reminder> after",
    "<command-name>/fuck-it</command-name>",
    "<command-message>running fuck</command-message>",
    '<command-args>--reason "fuck this build"</command-args>',
    "<local-command-caveat>may contain fuck</local-command-caveat>",
    "<local-command-stdout>error: fucking refused\nfuck</local-command-stdout>",
    "<command-name>/a</command-name>\nreal shit\n<system-reminder>fuck fuck</system-reminder>",
    "<system-reminder>only span</system-reminder>",
    "<SYSTEM-REMINDER>case insensitive fuck</SYSTEM-REMINDER>",
    "unclosed <system-reminder>span stays as-is",
    "",
    null,
    undefined,
  ];
  for (const c of cases) {
    assert.deepEqual(stripInjected(c), srcStripInjected(c), `stripInjected(${JSON.stringify(c)})`);
  }
});

test("mirrored isSkippable matches src/scan.mjs for every flag", () => {
  const cases = [
    { isMeta: true },
    { isCompactSummary: true },
    { isApiErrorMessage: true },
    { isSidechain: true },
    { type: "user" },
    {},
    null,
    undefined,
    { isMeta: false, isSidechain: false },
  ];
  for (const c of cases) {
    assert.equal(isSkippable(c), srcIsSkippable(c), `isSkippable(${JSON.stringify(c)})`);
  }
});

// ── scanFileText: same records + coins as the CLI scanner ────────────────────

test("scanFileText records user + assistant swears with correct coins, source, project", () => {
  const text =
    line(userMsg("u1", "why is this fucking broken")) +
    line(assistantMsg("a1", "I regret to report the build is, technically, shit.")) +
    line(userMsg("u2", "thank you, a very polite message"));
  const recs = scanFileText(text, "session.jsonl");
  assert.equal(recs.length, 2);
  const bySource = Object.fromEntries(recs.map((r) => [r.source, r]));
  assert.equal(bySource.user.words.fuck, 1);
  assert.equal(bySource.user.coins, 3); // premium
  assert.equal(bySource.assistant.words.shit, 1);
  assert.equal(bySource.assistant.coins, 2); // standard
  assert.equal(bySource.user.project, "example-app"); // basename of cwd
  assert.equal(bySource.user.transcript, "session.jsonl");
  assert.equal(bySource.user.agent, "claude");
});

test("scanFileText never stores raw message text — only word-count keys", () => {
  const recs = scanFileText(line(userMsg("u1", "this fucking build, what shit")), "t.jsonl");
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.ok(!("text" in r) && !("content" in r) && !("message" in r), "no raw text fields");
  assert.deepEqual(Object.keys(r.words).sort(), ["fuck", "shit"]);
  assert.ok(!JSON.stringify(r).includes("build"), "no message fragment leaks into the record");
});

test("scanFileText skips isMeta / isCompactSummary / isApiErrorMessage / isSidechain", () => {
  for (const flag of ["isMeta", "isCompactSummary", "isApiErrorMessage", "isSidechain"]) {
    const text =
      line(userMsg("skip1", "fuck this shit", { [flag]: true })) + line(userMsg("keep1", "damn"));
    const recs = scanFileText(text, "t.jsonl");
    assert.equal(recs.length, 1, `only the non-${flag} line counts`);
    assert.equal(recs[0].uuid, "keep1");
  }
});

test("scanFileText only counts user|assistant types (tool_result / other types ignored)", () => {
  const text =
    line({
      type: "user",
      uuid: "tr1",
      message: { role: "user", content: [{ type: "tool_result", content: "damn output" }] },
    }) +
    line({ type: "system", uuid: "sys1", message: { content: "fuck this system line" } }) +
    line({ type: "summary", summary: "fuck fuck fuck" }) +
    line(userMsg("u1", "shit"));
  const recs = scanFileText(text, "t.jsonl");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].uuid, "u1");
});

test("scanFileText strips injected spans before counting", () => {
  const body =
    "this is damn broken\n<system-reminder>The user previously said fuck.</system-reminder>";
  const recs = scanFileText(line(userMsg("u1", body)), "t.jsonl");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].words.damn, 1, "real swear outside the span counts");
  assert.equal(recs[0].words.fuck, undefined, "decoy inside the span was stripped");
  assert.equal(recs[0].coins, 1);
});

test("scanFileText: a line that is ONLY an injected span produces no record", () => {
  const recs = scanFileText(
    line(userMsg("u1", "<system-reminder>you swore: fuck shit cunt</system-reminder>")),
    "t.jsonl"
  );
  assert.equal(recs.length, 0);
});

test("scanFileText dedups uuids within a file (same uuid twice = once)", () => {
  const text = line(userMsg("dup", "shit")) + line(userMsg("dup", "fuck"));
  const recs = scanFileText(text, "t.jsonl");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].words.shit, 1);
});

test("scanFileText: same text, different uuids counts twice (not a duplicate)", () => {
  const recs = scanFileText(line(userMsg("u1", "shit")) + line(userMsg("u2", "shit")), "t.jsonl");
  assert.equal(recs.length, 2);
});

test("scanFileText skips lines with no uuid", () => {
  const noUuid = { type: "user", message: { content: "fuck" } };
  const recs = scanFileText(line(noUuid) + line(userMsg("u1", "shit")), "t.jsonl");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].uuid, "u1");
});

test("scanFileText never re-ingests Swear Jar's own clink line", () => {
  const clink = "\u{1FAD9} Swear jar *clink* +3 coin(s) — the machine says fuck";
  const recs = scanFileText(line(userMsg("u1", clink)), "t.jsonl");
  assert.equal(recs.length, 0, "the echoed clink line is not counted");
});

test("scanFileText is safe on empty, blank, and corrupt lines", () => {
  const text =
    "\n" +
    "   \n" +
    "{ this is not json \n" +
    '{"type":"user","uuid":"u2"\n' + // truncated JSON
    line(userMsg("u1", "shit")) +
    "\n";
  const recs = scanFileText(text, "t.jsonl");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].uuid, "u1");
});

test("scanFileText on empty / non-string input returns []", () => {
  assert.deepEqual(scanFileText("", "t.jsonl"), []);
  assert.deepEqual(scanFileText(undefined, "t.jsonl"), []);
  assert.deepEqual(scanFileText(null, "t.jsonl"), []);
});

test("scanFileText caps a single family at the paste guard (FAMILY_CAP)", () => {
  // 20 fucks on one line — detect() caps the family at 10; the record mirrors that.
  const recs = scanFileText(line(userMsg("u1", Array(20).fill("fuck").join(" "))), "t.jsonl");
  assert.equal(recs.length, 1);
  assert.equal(recs[0].words.fuck, 10);
  assert.equal(recs[0].coins, 30); // 10 * premium(3)
});

test("projectFor mirrors path.basename for realistic cwds", () => {
  assert.equal(projectFor("/Users/dev/Code/example-app"), "example-app");
  assert.equal(projectFor("/Users/dev/Code/example-app/"), "example-app");
  assert.equal(projectFor("C:\\Users\\dev\\proj"), "proj");
  assert.equal(projectFor(""), "unknown");
  assert.equal(projectFor(undefined), "unknown");
});

// ── scanFiles: streams many files, shared dedup, progress ────────────────────

test("scanFiles aggregates across files and dedups uuids across the whole scan", async () => {
  const files = [
    { name: "a.jsonl", text: line(userMsg("u1", "fuck")) + line(assistantMsg("a1", "shit")) },
    { name: "b.jsonl", text: line(userMsg("u1", "fuck")) + line(userMsg("u2", "damn")) }, // u1 dup across files
  ];
  const { records, files: fileCount, totalRecords, coins } = await scanFiles(files);
  assert.equal(fileCount, 2);
  assert.equal(totalRecords, 3); // u1(once), a1, u2
  assert.equal(records.length, 3);
  assert.equal(coins, 3 + 2 + 1); // fuck + shit + damn
  assert.equal(records.filter((r) => r.uuid === "u1").length, 1, "u1 counted once across files");
});

test("scanFiles fires onProgress once per file with running totals", async () => {
  const files = [
    { name: "a.jsonl", text: line(userMsg("u1", "fuck")) },
    { name: "b.jsonl", text: line(userMsg("u2", "all clean here")) }, // no coins
    { name: "c.jsonl", text: line(userMsg("u3", "shit shit")) },
  ];
  const ticks = [];
  await scanFiles(files, (p) => ticks.push({ files: p.files, records: p.records, coins: p.coins }));
  assert.equal(ticks.length, 3);
  assert.deepEqual(ticks[0], { files: 1, records: 1, coins: 3 });
  assert.deepEqual(ticks[1], { files: 2, records: 1, coins: 3 }); // clean file adds nothing
  assert.deepEqual(ticks[2], { files: 3, records: 2, coins: 3 + 4 }); // shit x2 = 4
});

test("scanFiles accepts an async iterable of {name,text}", async () => {
  async function* gen() {
    yield { name: "a.jsonl", text: line(userMsg("u1", "fuck")) };
    yield { name: "b.jsonl", text: line(userMsg("u2", "shit")) };
  }
  const { totalRecords, coins } = await scanFiles(gen());
  assert.equal(totalRecords, 2);
  assert.equal(coins, 5);
});

test("scanFiles survives a file whose text is not a string", async () => {
  const files = [
    { name: "bad.jsonl", text: null },
    { name: "ok.jsonl", text: line(userMsg("u1", "shit")) },
  ];
  const { totalRecords, coins } = await scanFiles(files);
  assert.equal(totalRecords, 1);
  assert.equal(coins, 2);
});

test("scanFiles output agrees with detect() scoring end-to-end", async () => {
  const { records } = await scanFiles([
    { name: "a.jsonl", text: line(userMsg("u1", "fucking hell, this shit")) },
  ]);
  const { coins } = detect("fucking hell, this shit");
  assert.equal(records.reduce((n, r) => n + r.coins, 0), coins);
});

// ── the browser contract ─────────────────────────────────────────────────────

test("web/browser-scan.mjs imports no node builtin", () => {
  const src = fs.readFileSync(path.join(WEB, "browser-scan.mjs"), "utf8");
  assert.ok(!/from\s+["']node:/.test(src), 'no `from "node:..."` imports');
  assert.ok(!/import\s+["']node:/.test(src), "no side-effect `node:` imports");
  assert.ok(
    !/\bfrom\s+["'](fs|path|os|child_process|net|http|https|url|process)["']/.test(src),
    "no bare node-builtin imports"
  );
  assert.ok(!/\brequire\s*\(/.test(src), "no require()");
  assert.ok(!/\bfetch\s*\(/.test(src), "no fetch() — scanning is offline");
});

// web/app.html: the same two guarantees the public docs/ pages carry.
const ALLOWED_REF = /^https?:\/\/github\.com\/BigLaserCo\//i;
function appHtml() {
  return fs.readFileSync(path.join(WEB, "app.html"), "utf8");
}
function visibleText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/&#\d+;/g, " ");
}

test("web/app.html makes zero external requests (only github.com/BigLaserCo links)", () => {
  const html = appHtml();
  const refs = [...html.matchAll(/https?:\/\/[^\s"'`<>()]+/gi)].map((m) => m[0]);
  const disallowed = refs.filter((u) => !ALLOWED_REF.test(u));
  assert.deepEqual(disallowed, [], `only BigLaserCo repo links allowed; found: ${disallowed.join(", ")}`);
  assert.ok(!/["'(\s]\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(html), "no protocol-relative external hosts");
  assert.ok(!/<script\s[^>]*\bsrc\s*=\s*["']https?:/i.test(html), "no external <script src>");
  assert.ok(!/<link\b/i.test(html), "no <link> tags at all (stylesheets/fonts/icons)");
  assert.ok(!/<img\b[^>]*\bsrc\s*=\s*["']https?:/i.test(html), "no external images");
});

test("web/app.html contains no uncensored lexicon words in its visible text", () => {
  const { words, coins } = detect(visibleText(appHtml()));
  assert.equal(coins, 0, `visible text owes the jar ${coins} coins: ${JSON.stringify(words)}`);
});

test("web/app.html says the scan is client-side and imports the audited src modules", () => {
  const html = appHtml();
  assert.ok(/never leave your machine/i.test(html), "states files never leave the machine");
  assert.ok(/client-side/i.test(html), "says client-side");
  assert.ok(html.includes("./browser-scan.mjs"), "imports the browser scan layer");
  assert.ok(html.includes("../src/detect.mjs"), "imports audited detect.mjs verbatim");
  assert.ok(html.includes("../src/stats.mjs"), "imports audited stats.mjs verbatim");
  assert.ok(html.includes("../src/version.mjs"), "imports app version for the upload payload");
  assert.ok(html.includes("../funnel/schema.mjs"), "imports the leaderboard schema");
});

test("web/app.html upload button is a disabled placeholder until CONFIG is set", () => {
  const html = appHtml();
  assert.ok(/API_BASE\s*:\s*null/.test(html), "API_BASE placeholder is null (upload disabled)");
  assert.ok(/ACCOUNTS_BASE\s*:\s*null/.test(html), "ACCOUNTS_BASE placeholder is null");
  assert.ok(/log in to get on the board/i.test(html), "disabled-state copy present");
  assert.ok(/coming online soon/i.test(html), "coming-soon copy present");
  assert.ok(/<button[^>]*id="uploadBtn"[^>]*\bdisabled\b/i.test(html), "button ships disabled in markup");
});

test("web/app.html offers all three folder doors and the hidden-folder hint", () => {
  const html = appHtml();
  assert.ok(html.includes("showDirectoryPicker"), "File System Access API door");
  assert.ok(/webkitdirectory/i.test(html), "webkitdirectory fallback door");
  assert.ok(/webkitGetAsEntry/.test(html), "drag-and-drop directory walk");
  assert.ok(/Cmd\+Shift\+\./.test(html), "macOS hidden-folder (Cmd+Shift+.) hint");
  assert.ok(/censored by default|Censored/i.test(html), "censor-by-default toggle present");
  assert.ok(/unfocused\.ai/i.test(html), "unfocused.ai branding present");
});
