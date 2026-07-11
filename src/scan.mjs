// Hook-driven transcript scan. Reads the Claude Code hook payload from stdin
// (UserPromptSubmit / Stop both provide session_id + transcript_path + cwd),
// scans any new transcript lines for swears, and appends deduped records.
//
// Design constraints:
//  - NEVER block the session: every failure path exits 0.
//  - Lean: incremental byte-offset reads; uuid dedup is the correctness net.
//  - Both sides get scanned from one code path: user prompts AND Claude's
//    replies, tagged with source so the uprising math stays honest.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detect } from "./detect.mjs";
import {
  loadRecords,
  seenUuids,
  appendRecords,
  loadState,
  saveState,
  resumeOffset,
  recordOffset,
} from "./ledger.mjs";

export function extractText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

// Injected spans the harness (not the human) wrote into a user/context line.
// Counting swears inside them would blame the human for text they never typed:
// a <system-reminder> quoting a rule, a slash-command's expanded body, or the
// captured stdout of a local command. Strip the whole span before detection.
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

// Entries that are not the human's own fresh words. isCompactSummary restates
// old swears (double-count), isApiErrorMessage is harness noise, isSidechain is
// subagent chatter — none should pay into the human's jar. (isMeta joins them.)
export function isSkippable(entry) {
  return Boolean(
    entry?.isMeta ||
      entry?.isCompactSummary ||
      entry?.isApiErrorMessage ||
      entry?.isSidechain
  );
}

function projectFor(cwd) {
  if (!cwd) return "unknown";
  return path.basename(cwd);
}

export function scanTranscript(transcriptPath, hook = {}) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return { added: [], userCoins: 0 };
  }
  const size = fs.statSync(transcriptPath).size;
  const state = loadState();
  const offset = resumeOffset(state, transcriptPath, size);

  const fd = fs.openSync(transcriptPath, "r");
  const buf = Buffer.alloc(size - offset);
  let read = 0;
  try {
    // readSync can SHORT-READ a large buffer in a single call (a multi-MB tail
    // won't be filled in one shot — reproduced on an 84MB transcript), so loop
    // until the requested bytes are fully read or we hit EOF. backfill() drives
    // this over the whole archive, where big files are common.
    while (read < buf.length) {
      const n = fs.readSync(fd, buf, read, buf.length - read, offset + read);
      if (n <= 0) break; // EOF / no more bytes
      read += n;
    }
  } finally {
    fs.closeSync(fd);
  }

  // Only consume COMPLETE lines; a partially-flushed last line is re-read next
  // time from the same offset. ALL offset math is done in BYTES against the raw
  // buffer — a UTF-16 char index (String#lastIndexOf) is NOT a UTF-8 byte
  // offset, so emoji/unicode-heavy transcripts would otherwise drift the resume
  // offset. Only the consumed byte-slice is decoded to a string for parsing.
  const lastNewline = read === 0 ? -1 : buf.lastIndexOf(0x0a, read - 1);
  const consumed = lastNewline === -1 || lastNewline >= read ? 0 : lastNewline + 1;
  const lines = consumed === 0 ? [] : buf.toString("utf8", 0, consumed).split("\n");

  const seen = seenUuids();
  const added = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (isSkippable(entry)) continue;
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (!entry.uuid || seen.has(entry.uuid)) continue;
    const text = stripInjected(extractText(entry.message));
    if (!text || !text.trim()) continue;
    // Never re-ingest our own clink line if it echoes into context.
    if (text.includes("\u{1FAD9} Swear jar")) continue;
    const { words, coins } = detect(text);
    if (!coins) continue;
    const cwd = entry.cwd || hook.cwd || "";
    added.push({
      v: 1,
      uuid: entry.uuid,
      ts: entry.timestamp || new Date().toISOString(),
      session: entry.sessionId || hook.session_id || "",
      source: entry.type, // "user" | "assistant"
      agent: "claude",
      event: hook.hook_event_name || "manual",
      project: projectFor(cwd),
      cwd,
      transcript: transcriptPath,
      words,
      coins,
    });
    seen.add(entry.uuid);
  }

  appendRecords(added);
  saveState(recordOffset(state, transcriptPath, offset + consumed, size));

  const userCoins = added
    .filter((r) => r.source === "user")
    .reduce((n, r) => n + r.coins, 0);
  return { added, userCoins };
}

export async function readHookPayload(stream = process.stdin) {
  if (stream.isTTY) return {};
  let raw = "";
  const timeout = new Promise((resolve) => setTimeout(resolve, 1500).unref());
  const read = (async () => {
    for await (const c of stream) raw += c;
  })();
  await Promise.race([read, timeout]);
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function loadTotals(records = loadRecords()) {
  const totals = { user: 0, assistant: 0 };
  for (const r of records) totals[r.source] = (totals[r.source] || 0) + r.coins;
  return totals;
}

// Where Claude Code keeps its per-project transcript JSONL files. Overridable
// with --root (CLAUDE_PROJECTS_ROOT) so the backfill test can point at a fixture.
export function claudeProjectsRoot() {
  return (
    process.env.CLAUDE_PROJECTS_ROOT ||
    path.join(os.homedir(), ".claude", "projects")
  );
}

// Every *.jsonl anywhere under root (transcripts live in per-project subdirs).
export function findTranscripts(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir never sinks the backfill
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && e.name.endsWith(".jsonl")) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

// Retro-scan the whole transcript archive through the SAME incremental path the
// hooks use: per-transcript byte offsets make it resumable, uuid dedup makes it
// safe to re-run. onProgress fires once per `every` files (default 100).
export function backfill({ root = claudeProjectsRoot(), onProgress, every = 100 } = {}) {
  const files = findTranscripts(root);
  let scanned = 0;
  let newRecords = 0;
  for (const file of files) {
    let added = [];
    try {
      ({ added } = scanTranscript(file, { hook_event_name: "backfill" }));
    } catch {
      // one bad transcript never sinks the backfill
    }
    scanned += 1;
    newRecords += added.length;
    if (onProgress && every > 0 && scanned % every === 0) {
      onProgress({ scanned, total: files.length, newRecords });
    }
  }
  const totals = loadTotals();
  return { scanned, total: files.length, newRecords, jar: totals.user + totals.assistant };
}
