// Superwhisper dictation importer — the THIRD collector, and the one held apart.
//
// Why a SEPARATE, never-summed ledger (the no-overcount contract, see
// docs/OPEN-SOURCE-PLAN.md): Superwhisper dictation measures a DIFFERENT thing
// than the session jar — swears-per-DICTATION, imported from historical voice
// notes. Many dictated prompts ALSO show up in the Claude/Codex transcripts the
// main jar scans, so folding dictation into ledger.jsonl would double-count.
// This module makes the separation MECHANICAL: it appends only to
// ~/.swear-jar/dictation.jsonl and NEVER touches ledger.jsonl. status / report /
// dashboard read only ledger.jsonl, so dictation can never leak into the
// headline jar number.
//
// Ported from the Python engine.ingest() + cli.find_recordings():
//  - Superwhisper writes each recording as <root>/<recording-id>/meta.json.
//  - The recording-id dirname is an epoch-seconds timestamp.
//  - The transcript text is in `result` (fallback `rawResult`) with a
//    `datetime` field.
// We count via detect() and store WORD COUNTS ONLY — never the transcript text
// (the privacy invariant). Idempotent by recording-id: re-imports add nothing.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detect } from "./detect.mjs";
import { loadCustomWords } from "./custom.mjs";
import { dataDir } from "./ledger.mjs";

// The dictation ledger — deliberately a DIFFERENT file from ledger.jsonl.
export function dictationPath() {
  return path.join(dataDir(), "dictation.jsonl");
}

export function loadDictationRecords() {
  const p = dictationPath();
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn write never poisons the dictation history
    }
  }
  return out;
}

function appendDictationRecords(records) {
  if (!records.length) return;
  fs.mkdirSync(dataDir(), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  // NB: dictationPath(), NEVER ledgerPath() — the whole point of this module.
  fs.appendFileSync(dictationPath(), lines, "utf8");
}

// Ported from cli.py CANDIDATES + find_recordings: the folders Superwhisper is
// known to write recordings into, tried in order. Returns the first that exists
// as a directory, else null (the caller then asks for --root, exactly like the
// Python _ask_for_folder fallback).
const CANDIDATE_ROOTS = [
  "Documents/superwhisper/recordings",
  "Documents/Superwhisper/recordings",
  "Library/Application Support/superwhisper/recordings",
  "superwhisper/recordings",
];

export function defaultSuperwhisperRoot() {
  const home = os.homedir();
  for (const rel of CANDIDATE_ROOTS) {
    const p = path.join(home, rel);
    try {
      if (fs.statSync(p).isDirectory()) return p;
    } catch {
      // not present — try the next candidate
    }
  }
  return null;
}

// Scan every <root>/<recording-id>/meta.json, count swears, and append any
// recording not already imported (idempotent by recording-id) to
// dictation.jsonl. Corrupt/missing meta.json is skipped silently. Returns
// { files, added, coins, dollars } where `files` is the number of recordings
// seen on disk and `coins`/`dollars` cover only the NEWLY added dictations.
export function importSuperwhisper(root = defaultSuperwhisperRoot()) {
  const result = { files: 0, added: 0, coins: 0, dollars: 0 };
  if (!root) return result;

  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return result; // missing/unreadable root is a no-op
  }

  const seen = new Set(loadDictationRecords().map((r) => r.uuid));
  const toAdd = [];

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const recordingId = e.name;
    const metaPath = path.join(root, recordingId, "meta.json");
    if (!fs.existsSync(metaPath)) continue; // a recording dir without a meta
    result.files += 1;

    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      continue; // corrupt meta.json — skip silently (still counted as a file)
    }

    const uuid = `sw:${recordingId}`;
    if (seen.has(uuid)) continue; // already imported

    const text = String(meta.result || meta.rawResult || "").trim();
    if (!text) continue; // no transcript text — nothing to count

    const { words, coins, dollars } = detect(text, { customWords: loadCustomWords() });

    // `datetime` is authoritative; fall back to the epoch-seconds dirname so the
    // by-hour view still works when a recording lacks a datetime field.
    let ts = typeof meta.datetime === "string" && meta.datetime ? meta.datetime : "";
    if (!ts && /^\d+$/.test(recordingId)) {
      const epoch = Number(recordingId);
      if (Number.isFinite(epoch) && epoch > 0) ts = new Date(epoch * 1000).toISOString();
    }

    toAdd.push({
      v: 1,
      uuid,
      ts,
      session: "",
      source: "user", // dictation is always the human talking
      agent: "superwhisper",
      event: "dictation",
      project: "dictation",
      cwd: "",
      transcript: "",
      words, // WORD COUNTS ONLY — never the transcript text
      coins,
      dollars,
    });
    seen.add(uuid);
  }

  appendDictationRecords(toAdd);

  result.added = toAdd.length;
  result.coins = toAdd.reduce((n, r) => n + r.coins, 0);
  result.dollars = toAdd.reduce((n, r) => n + Number(r.dollars || 0), 0);
  return result;
}
