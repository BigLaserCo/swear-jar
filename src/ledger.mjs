// Append-only JSONL ledger + scan-position state.
//
// Identity rules (the whole point):
//  - A record's identity is the transcript message `uuid`, NEVER a timestamp.
//    Clock skew, re-scans, duplicate hook fires, or a transcript replayed from
//    byte 0 can never double-count a message.
//  - Timestamps are recorded for reporting only.
//  - `source` (user|assistant), `agent`, `event`, `project`, and `cwd` are all
//    factored onto every record so later debugging can slice by origin.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export function dataDir() {
  return process.env.SWEAR_JAR_HOME || path.join(os.homedir(), ".swear-jar");
}

export function ledgerPath() {
  return path.join(dataDir(), "ledger.jsonl");
}

export function statePath() {
  return path.join(dataDir(), "state.json");
}

export function loadRecords() {
  const p = ledgerPath();
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn write never poisons the jar
    }
  }
  return out;
}

export function seenUuids(records = loadRecords()) {
  return new Set(records.map((r) => r.uuid));
}

export function appendRecords(records) {
  if (!records.length) return;
  fs.mkdirSync(dataDir(), { recursive: true });
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  fs.appendFileSync(ledgerPath(), lines, "utf8");
}

export function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { transcripts: {} };
  }
}

export function saveState(state) {
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf8");
}

// Where to resume reading a transcript. If the file shrank (compaction,
// rewrite), restart from 0 — the uuid dedup layer makes a full re-scan safe.
export function resumeOffset(state, transcriptPath, currentSize) {
  const entry = state.transcripts?.[transcriptPath];
  if (!entry) return 0;
  if (typeof entry.offset !== "number" || entry.offset > currentSize) return 0;
  return entry.offset;
}

export function recordOffset(state, transcriptPath, offset, size) {
  state.transcripts ||= {};
  state.transcripts[transcriptPath] = { offset, size, updated: new Date().toISOString() };
  // keep state lean: cap at the 40 most recently touched transcripts
  const entries = Object.entries(state.transcripts);
  if (entries.length > 40) {
    entries.sort((a, b) => String(b[1].updated).localeCompare(String(a[1].updated)));
    state.transcripts = Object.fromEntries(entries.slice(0, 40));
  }
  return state;
}
