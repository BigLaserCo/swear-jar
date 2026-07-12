// First-run wizard — `swear-jar init` (alias `setup`).
//
// This module is PURE COMPOSITION: it wires together the collectors that
// already exist (install/backfill/scanCodexDir/importSuperwhisper) and the
// reporters (writeDashboard/computeStats). It re-implements NO engine logic —
// no scanning, no detection lexicon, no ledger math. Its whole job is UX:
// find the user's files, ask "where are they?" only when we truly can't, run
// each collector once, and close on the "you owe $X" payoff + the report path.
//
// Two contracts guard the design:
//  - Separate ledgers stay separate (invariant 7): the closing summary REPORTS
//    the rage.wav dictation numbers but reads them from loadDictationRecords()
//    and NEVER sums them into the jar balance (which comes only from
//    loadRecords() / ledger.jsonl). The two never touch.
//  - Auto-open is a TTY-only courtesy (monetization-v1): in a real terminal
//    the finished report opens for you (src/open.mjs); the path is ALWAYS
//    printed, and --no-open / SWEAR_JAR_NO_OPEN=1 — or any non-TTY run (the
//    Claude skill, CI, a pipe) — means we only print. Ctrl-C mid-run is safe
//    because every ledger is append-only and uuid-deduped, so no cleanup
//    handler is needed (adding one would risk corrupting a torn write, not
//    prevent it).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

import { install, settingsPath } from "./install.mjs";
import { backfill, claudeProjectsRoot, findTranscripts, loadTotals } from "./scan.mjs";
import { scanCodexDir, defaultCodexRoot } from "./codex.mjs";
import {
  importSuperwhisper,
  defaultSuperwhisperRoot,
  loadDictationRecords,
} from "./superwhisper.mjs";
import { writeDashboard } from "./dashboard.mjs";
import { computeStats } from "./stats.mjs";
import { loadRecords } from "./ledger.mjs";
import { dollars } from "./render.mjs";
import { shouldAutoOpen, openInBrowser } from "./open.mjs";
import { tipLine } from "./donate.mjs";

// Display-only mirror of superwhisper.mjs CANDIDATE_ROOTS: the "usual spots" the
// wizard/skill names when nothing is found. superwhisper.mjs owns the
// authoritative probe (defaultSuperwhisperRoot); this list only decorates the
// not-found message, so it must never be read as a source of truth or drift
// into a second detector.
const SUPERWHISPER_CANDIDATES = [
  "Documents/superwhisper/recordings",
  "Documents/Superwhisper/recordings",
  "Library/Application Support/superwhisper/recordings",
  "superwhisper/recordings",
];

// ── cheap filesystem probes (counts only, never file contents) ───────────────
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

// `~` / `~/x` → absolute home path. Bare tilde only; we don't do `~user`.
export function expandTilde(p) {
  if (!p || typeof p !== "string") return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// Count Superwhisper recordings the cheap way: immediate <root>/<id> subdirs
// that carry a meta.json. Matches importSuperwhisper's `files` tally without
// parsing a single meta.json (a directory count, not a scan).
function countSuperwhisperRecordings(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  let n = 0;
  for (const e of entries) {
    if (e.isDirectory() && fileExists(path.join(root, e.name, "meta.json"))) n += 1;
  }
  return n;
}

// The typed-path validation contract (SPEC §3 step 4): a real recordings folder
// is a directory that holds at least one <id>/meta.json. An empty or wrong dir
// is treated as not-found so we re-prompt instead of importing nothing.
export function validSuperwhisperDir(p) {
  return isDir(p) && countSuperwhisperRecordings(p) >= 1;
}

// Cheap rollout count for detection: walk the tree counting rollout-*.jsonl
// files (mirrors codex.mjs listRolloutFiles, which isn't exported). No file is
// opened — this stays a directory count, not a scan.
function countRollouts(root) {
  let n = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable dir never sinks the count
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile() && /^rollout-.*\.jsonl$/.test(e.name)) n += 1;
    }
  }
  return n;
}

// Are our scan hooks already wired into ~/.claude/settings.json? Read-only peek
// (never writes); mirrors install.mjs's marker test without importing its
// private helper. Any parse/read failure is reported as "not installed".
function hooksInstalled() {
  try {
    const p = settingsPath();
    if (!fileExists(p)) return false;
    const settings = JSON.parse(fs.readFileSync(p, "utf8"));
    const hooks = settings.hooks || {};
    for (const event of ["UserPromptSubmit", "Stop"]) {
      for (const entry of hooks[event] || []) {
        for (const h of entry.hooks || []) {
          if (typeof h.command === "string" && h.command.includes("swear-jar")) return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

// detectSources — the machine-readable heart of `init --detect`, consumed by the
// plugin skill (WP2). Treat the returned shape as an API. Every detection root
// is overridable (params first, then env) so tests never touch the real home:
//   claude:  opts.claudeRoot | CLAUDE_PROJECTS_ROOT | ~/.claude/projects
//   codex:   opts.codexRoot  | CODEX_SESSIONS_ROOT  | ~/.codex/sessions
//   swhspr:  opts.superwhisperRoot | SWEAR_JAR_SUPERWHISPER_ROOT | CANDIDATE walk
// Counts are cheap directory counts, not full scans.
export function detectSources(opts = {}) {
  const home = opts.home || os.homedir();

  // Claude Code transcripts.
  const claudeRoot = opts.claudeRoot || claudeProjectsRoot();
  const claudeFound = isDir(claudeRoot);
  const transcripts = claudeFound ? findTranscripts(claudeRoot).length : 0;

  // Codex rollouts.
  const codexRoot = opts.codexRoot || process.env.CODEX_SESSIONS_ROOT || defaultCodexRoot();
  const codexFound = isDir(codexRoot);
  const rollouts = codexFound ? countRollouts(codexRoot) : 0;

  // Superwhisper dictation (the CANDIDATE_ROOTS walk, or an explicit override).
  const candidates = SUPERWHISPER_CANDIDATES.map((rel) => path.join(home, rel));
  const swOverride = opts.superwhisperRoot ?? process.env.SWEAR_JAR_SUPERWHISPER_ROOT ?? null;
  const swRoot = swOverride ? expandTilde(swOverride) : defaultSuperwhisperRoot();
  const swFound = Boolean(swRoot) && isDir(swRoot);
  const recordings = swFound ? countSuperwhisperRecordings(swRoot) : 0;

  // Ledger + hooks (cheap reads of existing local state).
  const records = loadRecords();
  const totals = loadTotals(records);

  return {
    claude: { found: claudeFound, root: claudeRoot, transcripts },
    codex: { found: codexFound, root: codexRoot, rollouts },
    superwhisper: { found: swFound, root: swFound ? swRoot : null, recordings, candidates },
    ledger: { records: records.length, coins: totals.user + totals.assistant },
    hooks: { installed: hooksInstalled() },
  };
}

// en-US grouping so counts read "1,482" deterministically regardless of locale.
function fmtCount(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

// Y/n prompt with an explicit default (found sources default to yes).
async function confirm(rl, question, def = true) {
  const ans = (await ask(rl, question)).trim().toLowerCase();
  if (!ans) return def;
  return ans[0] === "y";
}

// The typed-path fallback loop (SPEC §3 step 4): ≤3 tries, `~` expands, a bad
// path re-prompts with `not found: <path>`, an empty line skips, and exhausting
// the tries skips with a pointer to the manual importer. Returns the resolved
// recordings dir, or null to skip.
async function typePathLoop(rl, write) {
  for (let tries = 0; tries < 3; tries++) {
    const raw = (await ask(rl, "      Type the path to your recordings folder (Enter to skip): ")).trim();
    if (!raw) return null; // deliberate skip — not a failed try
    if (validSuperwhisperDir(expandTilde(raw))) return expandTilde(raw);
    write(`      not found: ${raw}`);
  }
  write("      Still can't find it — skipping dictation for now. Import later with:");
  write("        swear-jar import-dictation --root <dir>");
  return null;
}

// Interactive step 4: use the found root, type a different one, or skip. When
// nothing was found we drop straight into the typed-path loop.
async function resolveSuperwhisper(rl, det, write) {
  if (det.superwhisper.found) {
    write("      Superwhisper keeps every dictation transcript at:");
    write(`        ${det.superwhisper.root}    <- found, ${fmtCount(det.superwhisper.recordings)} recordings`);
    const ans = (await ask(rl, "      [Enter] use this   [p] type a different path   [s] skip: "))
      .trim()
      .toLowerCase();
    if (ans === "s") return null;
    if (ans === "p") return typePathLoop(rl, write);
    return det.superwhisper.root; // Enter (or anything else) accepts the found path
  }
  write("      Superwhisper not found at any of the usual spots.");
  return typePathLoop(rl, write);
}

// Print the closing "damage" payoff (SPEC §3). Jar numbers come from the main
// ledger only; rage.wav is reported from its OWN ledger and never summed in.
// The path is ALWAYS printed; `willOpen` only changes the parenthetical.
function printDamage(write, records, reportPath, willOpen) {
  const stats = computeStats(records);
  const dict = loadDictationRecords();
  const dictSwears = dict.reduce(
    (n, r) => n + Object.values(r.words || {}).reduce((a, b) => a + (Number(b) || 0), 0),
    0
  );

  write("🫙 The damage:");
  write(
    `   Jar balance:   ${dollars(stats.totalCoins)}  (${stats.totalCoins} coins) — ` +
      `you ${stats.userCoins} · the machine ${stats.machineCoins}`
  );
  if (dict.length) {
    write(
      `   rage.wav:      ${dictSwears} swears across ${dict.length} dictations  (separate ledger)`
    );
  }
  write(`   Uprising odds: ${stats.odds.value}%  — rank: ${stats.rank.current}`);
  write("");
  write(
    willOpen
      ? `   Full report:   ${reportPath}   (opening it for you now — --no-open or SWEAR_JAR_NO_OPEN=1 to just print)`
      : `   Full report:   ${reportPath}   (auto-opens in a real terminal — --no-open or SWEAR_JAR_NO_OPEN=1 to always just print)`
  );
}

// runInit — the wizard. Interactive when stdin is a TTY (and no --yes); otherwise
// fully non-interactive: no prompts, scan every FOUND source, name the flag that
// supplies each missing one. Idempotent by construction (all dedup lives in the
// ledgers), so it is always safe to re-run.
export async function runInit(opts = {}) {
  const out = opts.output || process.stdout;
  const input = opts.input || process.stdin;
  const write = (s = "") => out.write(s + "\n");

  const claudeRoot = opts.claudeRoot || claudeProjectsRoot();
  const codexRoot = opts.codexRoot || process.env.CODEX_SESSIONS_ROOT || defaultCodexRoot();
  const swOverride = opts.superwhisperRoot ?? process.env.SWEAR_JAR_SUPERWHISPER_ROOT ?? null;
  const det = detectSources({ claudeRoot, codexRoot, superwhisperRoot: swOverride });

  const yes = Boolean(opts.yes);
  const noHooks = Boolean(opts.noHooks);
  const interactive = opts.interactive ?? (Boolean(input.isTTY) && !yes);

  write("🫙 Swear Jar — first-time setup. Everything stays on your machine.");
  write("");

  // Idempotency reassurance: a non-empty jar means we've run before. Re-running
  // never double-counts (uuid dedup), so say so up front.
  if (det.ledger.records > 0) {
    write(`🫙 Jar so far: ${dollars(det.ledger.coins)} — re-running is safe, nothing double-counts.`);
    write("");
  }

  let doHooks = !noHooks;
  let doClaude = det.claude.found;
  let doCodex = det.codex.found;
  let swRoot = null; // resolved Superwhisper recordings dir to import, or null

  if (interactive) {
    const rl = readline.createInterface({ input, output: out });
    try {
      // [1/4] Live hooks
      write("[1/4] Live hooks");
      if (noHooks) {
        write("      skipped (--no-hooks)");
        doHooks = false;
      } else if (det.hooks.installed) {
        write("      Already wired — leaving them in place.");
        doHooks = false;
      } else {
        doHooks = await confirm(
          rl,
          "      Wire the Claude Code hooks so every future swear pays in automatically?  [Y/n] "
        );
      }
      write("");

      // [2/4] Claude Code history
      write("[2/4] Claude Code history");
      if (det.claude.found) {
        doClaude = await confirm(
          rl,
          `      Found ${det.claude.root} (${fmtCount(det.claude.transcripts)} transcripts). Scan it?  [Y/n] `
        );
      } else {
        write("      not found — skipped");
        doClaude = false;
      }
      write("");

      // [3/4] Codex history
      write("[3/4] Codex history");
      if (det.codex.found) {
        doCodex = await confirm(
          rl,
          `      Found ${det.codex.root} (${fmtCount(det.codex.rollouts)} rollouts). Scan it too?  [Y/n] `
        );
      } else {
        write("      not found — skipped");
        doCodex = false;
      }
      write("");

      // [4/4] Dictation — rage.wav (Superwhisper)
      write("[4/4] Dictation — rage.wav (Superwhisper)");
      swRoot = await resolveSuperwhisper(rl, det, write);
      write("");
    } finally {
      rl.close();
    }
  } else {
    // Non-interactive: no prompts. Scan what we found; for each missing source
    // print exactly one line naming the flag/env that supplies it.
    if (det.superwhisper.found) {
      swRoot = det.superwhisper.root;
    } else if (swOverride) {
      write(`🫙 Superwhisper dictation not found at ${swOverride} — skipped. (pass --root <dir>)`);
    } else {
      write("🫙 Superwhisper dictation not found — skipped. (pass --root <dir>)");
    }
    if (!det.claude.found) {
      write(
        `🫙 Claude Code history not found at ${det.claude.root} — skipped. (set CLAUDE_PROJECTS_ROOT to point at it)`
      );
    }
    if (!det.codex.found) {
      write(`🫙 Codex history not found at ${det.codex.root} — skipped. (pass --codex-root <dir>)`);
    }
    if (noHooks) doHooks = false;
    write("");
  }

  // ── run what we were told to, each collector exactly once ───────────────────
  if (doHooks) {
    const r = install();
    write(
      r.changed.length
        ? `🫙 Hooks wired (${r.changed.join(", ")}). Restart Claude Code (or run /hooks) to pick them up.`
        : "🫙 Hooks already wired."
    );
  }
  if (doClaude) {
    write("🫙 Backfilling from your Claude Code history…");
    backfill({
      root: claudeRoot,
      onProgress: ({ scanned, total, newRecords }) =>
        write(`  …${scanned}/${total} transcripts scanned (${newRecords} new records)`),
    });
  }
  if (doCodex) {
    write("🫙 …and your Codex history…");
    scanCodexDir(codexRoot);
  }
  if (swRoot) {
    write("🫙 Importing your rage.wav dictation history (a separate ledger)…");
    importSuperwhisper(swRoot);
  }

  // ── close on the payoff + the report path (+ the TTY-only open courtesy) ────
  const records = loadRecords();
  const reportPath = writeDashboard(records, { outPath: opts.outPath || undefined });
  // Gate on the OUTPUT stream's TTY: real terminal → open; the Claude skill,
  // CI, pipes, and test streams are non-TTY and mechanically never open.
  const willOpen = shouldAutoOpen({ isTTY: out.isTTY, noOpen: Boolean(opts.noOpen) });
  write("");
  printDamage(write, records, reportPath, willOpen);
  if (willOpen) openInBrowser(reportPath);
  write("");
  write(tipLine());

  return { reportPath, detection: det };
}
