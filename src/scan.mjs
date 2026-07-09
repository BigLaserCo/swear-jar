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
  let chunk;
  try {
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    chunk = buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }

  // Only consume complete lines; a partially-flushed last line is re-read
  // next time from the same offset.
  const lastNewline = chunk.lastIndexOf("\n");
  const consumed = lastNewline === -1 ? 0 : lastNewline + 1;
  const lines = lastNewline === -1 ? [] : chunk.slice(0, consumed).split("\n");

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
    if (entry.isMeta) continue;
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (!entry.uuid || seen.has(entry.uuid)) continue;
    const text = extractText(entry.message);
    if (!text) continue;
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
