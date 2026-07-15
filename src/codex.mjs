// Codex CLI rollout scan — the second collector into the shared swear jar.
//
// OpenAI's Codex CLI writes one append-only JSONL "rollout" per session under
// ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl. Every line is an
// envelope { timestamp, type, payload }. This adapter mirrors src/scan.mjs:
// incremental byte-offset reads, the same shrink→rescan-from-0 fallback, uuid
// dedup as the correctness net, and it writes the SAME ledger record shape —
// just tagged agent:"codex".
//
// Design constraints (identical posture to scan.mjs):
//  - NEVER throw out of a scan: every failure path returns the empty result.
//  - Lean: read only the new tail of each file; uuid dedup makes re-scans safe.
//  - Count ONLY genuine user text and assistant reply text.
//
// --- What the schema told us (structural research, no content copied) ---
// Envelope .type values: session_meta | event_msg | response_item |
// turn_context | compacted. The conversation exists in TWO parallel streams:
//  - event_msg/{user_message,agent_message}: the UI event stream. `.message`
//    is a plain string of exactly the user's typed text / the assistant's
//    reply. Structurally carries NO injected blocks (no environment_context,
//    user_instructions, or system-reminder markers were ever present).
//  - response_item/message: the raw model-transcript items (role user/
//    assistant/developer, content blocks input_text/output_text/input_image).
// We deliberately consume ONLY the event_msg stream: it is the clean genuine
// text, one entry per message (agent_message count == response_item assistant
// count), and using a single stream makes cross-stream double-counting
// impossible. Everything else — reasoning, function_call(/_output),
// exec_command_end, patch_apply, web_search, token_count, task_*, the
// developer/system role, session_meta, turn_context, compacted — is tool
// noise / thinking / instructions / auto-generated and is skipped.
//
// --- Identity / dedup ---
// Codex rollouts contain NO stable per-message id (payload.id exists only on
// session_meta, and that is the SESSION id). So each recorded message gets a
// deterministic synthetic uuid: `codex:<file-basename>:<absolute-line-index>`.
// It is deterministic (same physical line → same id on any re-scan, so the
// ledger's uuid `seen` set dedups a full rescan after a shrink) and unique
// (one message per line). The absolute line index is tracked across
// incremental windows via a `line` field stored alongside the byte offset.

import fs from "node:fs";
import { loadCustomWords } from "./custom.mjs";
import path from "node:path";
import os from "node:os";
import { detect } from "./detect.mjs";
import {
  seenUuids,
  appendRecords,
  loadState,
  saveState,
  resumeOffset,
  recordOffset,
} from "./ledger.mjs";

export function defaultCodexRoot() {
  return path.join(os.homedir(), ".codex", "sessions");
}

function projectFor(cwd) {
  if (!cwd) return "unknown";
  return path.basename(cwd);
}

function countWords(text) {
  return String(text || "").trim() ? String(text).trim().split(/\s+/u).length : 0;
}

// The rollout filename ends in the session uuid; verified to equal
// session_meta.id, so we can recover it without reading the (large) meta line.
function sessionIdFromName(basename) {
  const m = basename.match(
    /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i
  );
  return m ? m[1] : basename.replace(/\.jsonl$/i, "");
}

// Best-effort read of the first line (session_meta) to seed session id + cwd
// on an INCREMENTAL scan whose window starts after line 0. Bounded so a large
// base_instructions blob can't blow up memory; any failure yields {}.
function readSessionMeta(filePath, size) {
  try {
    const cap = Math.min(size, 512 * 1024);
    const fd = fs.openSync(filePath, "r");
    let head;
    try {
      const buf = Buffer.alloc(cap);
      fs.readSync(fd, buf, 0, cap, 0);
      head = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    const nl = head.indexOf("\n");
    if (nl === -1) return {};
    const obj = JSON.parse(head.slice(0, nl));
    if (obj?.type !== "session_meta") return {};
    const p = obj.payload || {};
    return { session: typeof p.id === "string" ? p.id : "", cwd: typeof p.cwd === "string" ? p.cwd : "" };
  } catch {
    return {};
  }
}

// Text hygiene mirrors scan.mjs. Codex's user_message carries no injected
// blocks (verified structurally), so the <system-reminder> strip is a
// defensive no-op safeguard; the clink skip prevents re-ingesting our own line.
function hygiene(text) {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "");
}

export function scanCodexFile(filePath) {
  const empty = { added: [], userCoins: 0 };
  try {
    if (!filePath || !fs.existsSync(filePath)) return empty;
    const size = fs.statSync(filePath).size;
    const basename = path.basename(filePath);
    const sessionId = sessionIdFromName(basename);

    const state = loadState();
    const offset = resumeOffset(state, filePath, size);
    const prior = state.transcripts?.[filePath];
    // Absolute line index of the first line in our window. On a shrink,
    // resumeOffset returns 0 and we recount from 0 (dedup catches repeats).
    const startLine = offset > 0 && typeof prior?.line === "number" ? prior.line : 0;

    // Seed cwd from the meta line only when we're resuming past it; at offset 0
    // the session_meta line is inside our window and gets picked up below.
    let currentCwd = "";
    if (offset > 0) currentCwd = readSessionMeta(filePath, size).cwd || "";

    const fd = fs.openSync(filePath, "r");
    let buf;
    let read = 0;
    try {
      buf = Buffer.alloc(size - offset);
      // readSync can return a SHORT read on a large file (a single call won't
      // fill a multi-MB buffer), so loop until the tail is fully read or EOF.
      // Rollouts routinely reach several MB, unlike Claude transcripts.
      while (read < buf.length) {
        const n = fs.readSync(fd, buf, read, buf.length - read, offset + read);
        if (n <= 0) break; // EOF / no more bytes
        read += n;
      }
    } finally {
      fs.closeSync(fd);
    }

    // Only consume complete lines; a partially-flushed last line is re-read
    // next time from the same offset. All offset math is done in BYTES against
    // the buffer — never on the decoded string — because rollouts are
    // unicode-heavy and a UTF-16 char index != a UTF-8 byte offset.
    const lastNewline = buf.lastIndexOf(0x0a, read - 1);
    const consumed = lastNewline === -1 || lastNewline >= read ? 0 : lastNewline + 1;
    const lines = consumed === 0 ? [] : buf.toString("utf8", 0, consumed).split("\n");

  const seen = seenUuids();
  const added = [];
  const denominatorRecords = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = entry?.payload || {};
      // Track cwd from context frames as we pass them (turn_context precedes
      // each turn's user_message; session_meta seeds the file default).
      if (
        (entry.type === "session_meta" || entry.type === "turn_context") &&
        typeof payload.cwd === "string" &&
        payload.cwd
      ) {
        currentCwd = payload.cwd;
      }
      if (entry.type !== "event_msg") continue;

      let source;
      if (payload.type === "user_message") source = "user";
      else if (payload.type === "agent_message") source = "assistant";
      else continue; // skip tool calls/results, reasoning, system, auto-gen

      const raw = payload.message;
      if (typeof raw !== "string" || !raw) continue;
      // Never re-ingest our own clink line if it echoes back into a transcript.
      if (raw.includes("\u{1FAD9} Swear jar")) continue;
      const text = hygiene(raw);
      if (!text) continue;

      const { words, coins, dollars } = detect(text, { customWords: loadCustomWords() });
      const wordCount = source === "user" ? countWords(text) : 0;
      if (!coins && !wordCount) continue;

      const uuid = `codex:${basename}:${startLine + i}`;
      if (seen.has(uuid)) continue;

      const record = {
        v: 1,
        uuid,
        ts: entry.timestamp || new Date().toISOString(),
        session: sessionId,
        source, // "user" | "assistant"
        agent: "codex",
        event: "codex-rollout",
        project: projectFor(currentCwd),
        cwd: currentCwd,
        transcript: filePath,
        words,
        word_count: wordCount,
        coins,
        dollars,
      };
      if (coins) added.push(record);
      else denominatorRecords.push(record);
      seen.add(uuid);
    }

    appendRecords([...added, ...denominatorRecords]);

    // Advance the offset AND the absolute line count. split() of a chunk ending
    // in "\n" yields a trailing "" element, so complete lines == lines.length-1.
    const consumedLines = lines.length > 0 ? lines.length - 1 : 0;
    const next = recordOffset(state, filePath, offset + consumed, size);
    if (next.transcripts?.[filePath]) next.transcripts[filePath].line = startLine + consumedLines;
    saveState(next);

    const userCoins = added
      .filter((r) => r.source === "user")
      .reduce((n, r) => n + r.coins, 0);
    return { added, userCoins };
  } catch {
    // Swallow-and-continue: a scan must never take the session down.
    return empty;
  }
}

// Walk a rollout tree (default ~/.codex/sessions) and scan every rollout file.
// Each file is scanned independently; one bad file never aborts the sweep.
export function scanCodexDir(root = defaultCodexRoot()) {
  const result = { added: [], userCoins: 0, files: 0 };
  let files = [];
  try {
    if (!root || !fs.existsSync(root)) return result;
    files = listRolloutFiles(root);
  } catch {
    return result;
  }
  for (const filePath of files) {
    const { added, userCoins } = scanCodexFile(filePath);
    result.added.push(...added);
    result.userCoins += userCoins;
    result.files += 1;
  }
  return result;
}

function listRolloutFiles(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir: skip, keep sweeping
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) out.push(full);
    }
  }
  return out;
}
