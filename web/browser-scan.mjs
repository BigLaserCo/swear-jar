// Browser-side scanning layer for the hosted Swear Jar (biglaser.co).
//
// This is the ONE piece the npm package's src/ can't share verbatim: the CLI's
// src/scan.mjs does its filtering INSIDE a node:fs read loop (byte offsets, an
// on-disk ledger), so it opens by importing the node:fs / node:path / node:os
// builtins — which a browser cannot load at all. This module re-implements ONLY the pure, IO-free parts of
// that loop so the exact same records come out, and imports the real scoring
// brain — `detect` from src/detect.mjs — verbatim (that file is runtime-agnostic
// and is the part worth auditing).
//
// The three text-hygiene helpers below (extractText / stripInjected /
// isSkippable) are faithful mirrors of the ones EXPORTED from src/scan.mjs. They
// are pinned to the source mechanically: test/browser-scan.test.mjs imports the
// real src/scan.mjs exports and asserts these produce byte-identical output over
// a battery of inputs, so any future drift in the audited helpers turns the gate
// red. Importing them directly would be nicer, but src/scan.mjs's node:fs import
// would break the browser — this keeps the page loadable AND the semantics tied
// to the audited source.
//
// HARD RULE for this file: NO `node:` imports. It must run unchanged in a browser
// with native ES modules. The only import is the browser-safe detector.

import { detect } from "../src/detect.mjs";

// ── mirror of src/scan.mjs `extractText` ─────────────────────────────────────
// Handles both content shapes a transcript line can carry: a plain string, or an
// array of typed blocks (we keep only `text` blocks — tool_result / thinking /
// image blocks are not the human's or the assistant's spoken words).
export function extractText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

// ── mirror of src/scan.mjs injected-span stripping ───────────────────────────
// Spans the harness (not the human) wrote into a line: a <system-reminder>
// quoting a rule, a slash-command's expanded body, or captured local-command
// output. Counting swears inside them would blame the human for text they never
// typed, so the whole span is blanked before detection.
const INJECTED_TAGS = [
  "system-reminder",
  "command-name",
  "command-message",
  "command-args",
  "local-command-caveat",
  "local-command-stdout",
];
const INJECTED_RE = new RegExp(
  `<(${INJECTED_TAGS.join("|")})>[\\s\\S]*?</\\1>`,
  "gi"
);

export function stripInjected(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(INJECTED_RE, " ");
}

// ── mirror of src/scan.mjs `isSkippable` ─────────────────────────────────────
// Entries that are not the human's own fresh words: isCompactSummary restates
// old swears (double-count), isApiErrorMessage is harness noise, isSidechain is
// subagent chatter, isMeta is bookkeeping — none pay into the jar.
export function isSkippable(entry) {
  return Boolean(
    entry?.isMeta ||
      entry?.isCompactSummary ||
      entry?.isApiErrorMessage ||
      entry?.isSidechain
  );
}

// Browser-safe basename (no node:path). Mirrors path.basename for the realistic
// posix/windows cwd strings a transcript carries: last non-empty path segment.
export function projectFor(cwd) {
  if (!cwd) return "unknown";
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "unknown";
}

// The clink line Swear Jar itself prints; never re-ingest it if it echoes back
// into a later transcript. Same sentinel src/scan.mjs guards on.
const CLINK_SENTINEL = "\u{1FAD9} Swear jar";

// scanFileText(text, fileName[, seen]) -> ledger records for one transcript file.
//
// Mirrors the per-line body of src/scan.mjs `scanTranscript` EXACTLY (skip
// filters, type gate, uuid dedup, injected-span stripping, empty/clink guards,
// detect() scoring) — minus the node:fs byte-offset machinery, which the browser
// streams file-by-file instead. Pass a shared `seen` Set to dedup uuids across a
// whole folder scan; omit it and each call dedups within its own file only.
export function scanFileText(text, fileName = "", seen = new Set()) {
  const records = [];
  if (typeof text !== "string" || !text) return records;
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // a corrupt/partial line never sinks the scan
    }
    if (isSkippable(entry)) continue;
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (!entry.uuid || seen.has(entry.uuid)) continue;
    const body = stripInjected(extractText(entry.message));
    if (!body || !body.trim()) continue;
    if (body.includes(CLINK_SENTINEL)) continue;
    const { words, coins } = detect(body);
    if (!coins) continue;
    const cwd = entry.cwd || "";
    records.push({
      v: 1,
      uuid: entry.uuid,
      ts: entry.timestamp || new Date().toISOString(),
      session: entry.sessionId || "",
      source: entry.type, // "user" | "assistant"
      agent: "claude",
      event: "web-scan",
      project: projectFor(cwd),
      cwd,
      transcript: fileName || "",
      words,
      coins,
    });
    seen.add(entry.uuid);
  }
  return records;
}

// scanFiles(fileIter, onProgress) -> { records, files, totalRecords, coins }.
//
// `fileIter` is any (async- or sync-) iterable of { name, text } pairs — the page
// feeds it File objects read one at a time (bounded memory, live progress); tests
// feed it an array of fixtures. uuid dedup is shared across the whole scan so a
// transcript that appears in two folders isn't double-counted. onProgress fires
// once PER FILE with running { files, records, coins } for the clinking counter.
export async function scanFiles(fileIter, onProgress) {
  const seen = new Set();
  const all = [];
  let files = 0;
  let totalRecords = 0;
  let coins = 0;
  for await (const item of fileIter) {
    const name = item?.name || "";
    const text = item?.text ?? "";
    files += 1;
    let recs = [];
    try {
      recs = scanFileText(text, name, seen);
    } catch {
      recs = []; // one bad file never sinks the whole folder
    }
    for (const r of recs) {
      totalRecords += 1;
      coins += r.coins;
      all.push(r);
    }
    if (typeof onProgress === "function") {
      onProgress({ files, records: totalRecords, coins, name, fileRecords: recs.length });
    }
  }
  return { records: all, files, totalRecords, coins };
}
