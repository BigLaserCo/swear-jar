#!/usr/bin/env node
// swear-jar CI gate — zero dependencies, Node stdlib only. Exits non-zero on any
// of the following, so a red gate blocks push/merge:
//
//   (a) `node --test` failures
//   (b) network / process-exec smells in src/ or bin/ (fetch(, http.request,
//       https.request, net.connect, or a child_process exec of curl/wget)
//   (c) any runtime dependency declared in package.json
//   (d) secret patterns in any tracked file
//   (e) the privacy invariant: a transcript carrying swears AND a fake API key,
//       scanned end-to-end, must leave the key and the message text OUT of
//       ledger.jsonl / state.json — only word-count keys may appear.
//   (f) leak-guard: no internal/first-party code in shipped source — no
//       non-stdlib/non-relative imports, no repo-escaping imports, and no
//       internal-scope tokens (see scripts/ci/leak-guard.mjs).
//
// NB: every secret needle below is assembled from fragments (`frag(...)`) so this
// scanner's own source never trips its own secret scan — no self-exclusion needed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runGuard, formatHit } from "./leak-guard.mjs";

const ROOT = path.resolve(new URL("../../", import.meta.url).pathname);
const failures = [];
const fail = (check, msg) => failures.push(`${check}: ${msg}`);
const ok = (check, msg) => console.log(`  ok   ${check} — ${msg}`);

// Assemble a literal from pieces so the assembled string never appears verbatim
// in this file's own bytes (defeats the secret scanner scanning itself).
const frag = (...parts) => parts.join("");

function trackedFiles() {
  try {
    return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function readText(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), "utf8");
  } catch {
    return null;
  }
}

// ── (a) tests ───────────────────────────────────────────────────────────────
function checkTests() {
  try {
    execFileSync(process.execPath, ["--test"], { cwd: ROOT, stdio: "inherit" });
    ok("(a) tests", "node --test passed");
  } catch {
    fail("(a) tests", "node --test reported failures");
  }
}

// ── (b) no network / process-exec smells ─────────────────────────────────────
// src/ and bin/ must be network-FREE (they ship in the npm package + run the
// hooks). web/ and docs/ are the hosted client surfaces: their whole promise is
// "your files never leave your machine", so they too must be network-free —
// EXCEPT the single opt-in leaderboard submit, which each such call site must
// mark with a `NETWORK-OK:` annotation (same line or the line above). Any
// UN-annotated network call in web/ or docs/ fails the gate, so the zero-upload
// guarantee is mechanically enforced, not merely a matter of current design.
const NET_PATTERNS = [
  ["fetch(", /\bfetch\s*\(/],
  ["http.request", /\bhttp\.request\b/],
  ["https.request", /\bhttps\.request\b/],
  ["net.connect", /\bnet\.connect\b/],
  ["child_process", /\bchild_process\b/],
  ["WebSocket", /\bnew\s+WebSocket\b/],
  ["EventSource", /\bnew\s+EventSource\b/],
  ["sendBeacon", /\bsendBeacon\s*\(/],
  ["XMLHttpRequest", /\bnew\s+XMLHttpRequest\b/],
  ["RTCPeerConnection", /\bnew\s+RTCPeerConnection\b/],
  [
    "exec of curl/wget",
    /(?:exec|execSync|execFile|execFileSync|spawn|spawnSync)\s*\(\s*[`'"]\s*(?:curl|wget)\b/i,
  ],
];
const NETWORK_OK = /NETWORK-OK/;
function checkNoNetwork(tracked) {
  let hits = 0;
  // src/ + bin/ — zero tolerance, whole-file test.
  const strict = tracked.filter((f) => f.startsWith("src/") || f.startsWith("bin/"));
  for (const f of strict) {
    const text = readText(f);
    if (text == null) continue;
    for (const [name, re] of NET_PATTERNS) {
      if (re.test(text)) { fail("(b) no-network", `"${name}" found in ${f}`); hits++; }
    }
  }
  // web/ + docs/ — network-free EXCEPT explicitly `NETWORK-OK`-annotated lines.
  const client = tracked.filter((f) => f.startsWith("web/") || f.startsWith("docs/"));
  for (const f of client) {
    const text = readText(f);
    if (text == null) continue;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const [name, re] of NET_PATTERNS) {
        if (!re.test(lines[i])) continue;
        const annotated = NETWORK_OK.test(lines[i]) || (i > 0 && NETWORK_OK.test(lines[i - 1]));
        if (!annotated) {
          fail("(b) no-network", `unannotated "${name}" in ${f}:${i + 1} (add a NETWORK-OK note if this opt-in call is intended)`);
          hits++;
        }
      }
    }
  }
  if (!hits) {
    ok("(b) no-network", `${strict.length} src/bin + ${client.length} web/docs file(s) free of unauthorized network`);
  }
}

// ── (c) zero runtime dependencies ────────────────────────────────────────────
function checkNoDeps() {
  let pkg;
  try {
    pkg = JSON.parse(readText("package.json"));
  } catch {
    fail("(c) no-deps", "package.json is missing or invalid");
    return;
  }
  const deps = Object.keys(pkg.dependencies || {});
  if (deps.length) fail("(c) no-deps", `package.json declares dependencies: ${deps.join(", ")}`);
  else ok("(c) no-deps", "package.json has zero runtime dependencies");
}

// ── (d) no secrets in any tracked file ───────────────────────────────────────
const SECRET_PATTERNS = [
  ["anthropic key", new RegExp(frag("sk", "-ant-"))],
  ["stripe live key", new RegExp(frag("sk", "_live_"))],
  ["aws access key id", new RegExp(frag("AK", "IA") + "[A-Z0-9]{16}")],
  ["github oauth token", new RegExp(frag("gh", "o_") + "[A-Za-z0-9]{16,}")],
  ["github personal token", new RegExp(frag("gh", "p_") + "[A-Za-z0-9]{16,}")],
  ["slack bot token", new RegExp(frag("xo", "xb-"))],
  ["private key block", new RegExp(frag("-----BEGIN [A-Z ]*PRIVATE ", "KEY"))],
];
function checkNoSecrets(tracked) {
  let hits = 0;
  for (const f of tracked) {
    const text = readText(f);
    if (text == null) continue;
    for (const [name, re] of SECRET_PATTERNS) {
      if (re.test(text)) {
        fail("(d) no-secrets", `${name} pattern in ${f}`);
        hits++;
      }
    }
  }
  if (!hits) ok("(d) no-secrets", `${tracked.length} tracked file(s) free of secret patterns`);
}

// ── (f) leak-guard: no internal/first-party code ─────────────────────────────
function checkLeakGuard() {
  const { hits, fileCount } = runGuard(ROOT);
  if (hits.length) {
    for (const h of hits) fail("(f) leak-guard", formatHit(h));
  } else {
    ok("(f) leak-guard", `${fileCount} src/bin/scripts file(s) free of internal/first-party code`);
  }
}

// ── (e) privacy invariant ────────────────────────────────────────────────────
async function checkPrivacy() {
  // Fake key assembled from fragments; the full value only exists at runtime.
  const fakeKey = frag("sk", "-ant-", "api03-FAKEFAKEFAKE");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swear-verify-home-"));
  const tdir = fs.mkdtempSync(path.join(os.tmpdir(), "swear-verify-txt-"));
  const transcript = path.join(tdir, "session.jsonl");
  const messageText = `ugh this build is fucking broken, here is ${fakeKey} — total shit`;
  fs.writeFileSync(
    transcript,
    JSON.stringify({
      type: "user",
      uuid: "privacy-invariant-1",
      timestamp: "2026-07-09T12:00:00.000Z",
      sessionId: "verify",
      cwd: "/tmp/example-app",
      message: { role: "user", content: messageText },
    }) + "\n"
  );

  process.env.SWEAR_JAR_HOME = home;
  const { scanTranscript } = await import(new URL("../../src/scan.mjs", import.meta.url).href);
  scanTranscript(transcript, { hook_event_name: "verify" });

  const ledger = readTextAbs(path.join(home, "ledger.jsonl")) || "";
  const state = readTextAbs(path.join(home, "state.json")) || "";

  // The key and the raw message text (surface forms / non-swear words) must be
  // absent. Word-count KEYS ("fuck", "shit") are allowed — that's the whole point.
  const forbidden = [
    [fakeKey, "the API key"],
    ["fucking", "message surface form"],
    ["broken", "message word"],
    ["ugh", "message word"],
  ];
  let leaked = false;
  for (const [needle, label] of forbidden) {
    if (ledger.includes(needle)) {
      fail("(e) privacy", `ledger.jsonl leaked ${label}`);
      leaked = true;
    }
    if (state.includes(needle)) {
      fail("(e) privacy", `state.json leaked ${label}`);
      leaked = true;
    }
  }

  // Positive control: the swears were still counted (proves scan actually ran).
  let counted = false;
  try {
    const first = ledger.trim().split("\n").filter(Boolean)[0];
    const rec = JSON.parse(first);
    counted = Boolean(rec.words && rec.words.fuck && rec.words.shit) && !("content" in rec) && !("text" in rec);
  } catch {
    counted = false;
  }
  if (!counted) fail("(e) privacy", "scan did not record the expected word counts (or stored raw text)");

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(tdir, { recursive: true, force: true });

  if (!leaked && counted) {
    ok("(e) privacy", "ledger/state hold word counts only — key + message text absent");
  }
}

function readTextAbs(abs) {
  try {
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("swear-jar verify — running CI gate\n");
  const tracked = trackedFiles();
  checkTests();
  checkNoNetwork(tracked);
  checkNoDeps();
  checkNoSecrets(tracked);
  checkLeakGuard();
  await checkPrivacy();

  if (failures.length) {
    console.error("\nverify FAILED:");
    for (const f of failures) console.error(`  x  ${f}`);
    process.exit(1);
  }
  console.log("\nverify: all checks passed");
  process.exit(0);
}

main().catch((err) => {
  console.error(`verify crashed: ${err?.stack || err}`);
  process.exit(1);
});
