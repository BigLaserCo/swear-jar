// Leaderboard aggregation + rendering — the provenance + rendering CORE that the
// hosted leaderboard reuses.
//
// DATA SOURCE: the hosted funnel's CONFIRMED submissions — the Worker's
// /api/board.json rows (see funnel/worker.mjs). Each row is an already-validated,
// public-safe aggregate (a handle + summary numbers + a verified flag); no email,
// no message text, no PII. There is NO GitHub-issue submission path — that older
// design was superseded by the email-gated funnel + magic-link accounts, so a
// second path would only confuse submitters. The Worker (or a future rebuild job)
// folds each confirmed row in via applySubmission(), then renders LEADERBOARD.md
// with renderLeaderboard().
//
// The fold + render functions are PURE + deterministic: no network, no clock (the
// timestamp is injected; a fixed placeholder is used when none is given), so the
// same input always renders byte-identical markdown that CI can regenerate + diff.
// Only the CLI at the bottom of this file touches the filesystem.
//
// AGGREGATE NUMBERS ONLY. The render sanitizes every top_word through the
// canonical detector so the published board can never contain a spelled-out —
// or even a matchable censored — swear (detect(output).coins === 0, always).

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { detect } from "../../src/detect.mjs";
import { CAPS } from "./schema.mjs";

// The Founder's benchmark: swears/day to beat on the "vs. the Founder" board.
export const FOUNDER_BENCHMARK = 65;

// Fixed placeholder so a no-arg render is deterministic (CI regenerates + diffs).
export const DEFAULT_NOW = "2026-07-10T00:00:00.000Z";

// Plausibility calibration (against the Founder's real usage: ~183 coins/day
// over an 8,708-coin jar). A submission RANKS only if it clears both gates:
//   (a) active_days >= MIN_ACTIVE_DAYS — fewer days isn't enough signal to rank
//       (held with an honest "needs more days" state, not called a fake), and
//   (b) total_coins <= active_days * coins_per_active_day — beyond that the
//       coins-per-day rate isn't humanly sustainable, so it's held for review.
// Anything held is EXCLUDED from the ranked boards (a fun board, not a ledger).
const MIN_ACTIVE_DAYS = 7;
const REVIEW_BOUNDS = {
  swears_per_day: 2_000, // sustained rate this high is not a human
  coins_per_active_day: 200, // calibrated to the Founder's ~183 coins/day
};

const AGENT_BADGE = {
  claude: "🤖 claude",
  codex: "🧠 codex",
  both: "🤖🧠 both",
  dictation: "🎙️ dictation",
};

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const cmpHandle = (a, b) =>
  String(a.handle || "").toLowerCase().localeCompare(String(b.handle || "").toLowerCase());

function fmtInt(n) {
  return Math.round(num(n)).toLocaleString("en-US");
}
function fmtMoney(n) {
  // Whole dollars, no cents — displayed $ figures round (internal math is exact).
  return "$" + Math.round(num(n)).toLocaleString("en-US");
}
function fmtRate(n) {
  const v = num(n);
  return (Math.round(v * 10) / 10).toLocaleString("en-US");
}
// Escape a value for a markdown table cell.
function cell(s) {
  return String(s ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

// Guarantee a top_word renders with ZERO detector hits. A submitted censored
// form like "f**k" still matches the detector's censored patterns; mask letters
// from the right until it's clean, then hard-fallback to first-letter + stars.
function safeCensored(word) {
  const w = String(word ?? "").trim().slice(0, CAPS.top_word_len);
  if (!w) return "—";
  if (detect(w).coins === 0) return cell(w);
  const chars = [...w];
  for (let i = chars.length - 1; i >= 1; i--) {
    if (/[a-z]/i.test(chars[i])) {
      chars[i] = "*";
      if (detect(chars.join("")).coins === 0) return cell(chars.join(""));
    }
  }
  const out = (w[0] || "*") + "***";
  return cell(detect(out).coins === 0 ? out : "****");
}

function agentBadge(agent) {
  return AGENT_BADGE[String(agent || "").toLowerCase()] || `• ${cell(agent || "?")}`;
}
function handleLink(handle) {
  const h = String(handle || "").replace(/[^a-zA-Z0-9-]/g, "");
  return `[@${h}](https://github.com/${h})`;
}

// ── partition + boards ────────────────────────────────────────────────────────

// Dedup by handle keeping each handle's HIGHEST total_coins submission.
function dedupe(subs) {
  const best = new Map();
  for (const s of Array.isArray(subs) ? subs : []) {
    const key = String(s?.handle || "").toLowerCase();
    if (!key) continue;
    const cur = best.get(key);
    if (!cur || num(s.total_coins) > num(cur.total_coins)) best.set(key, s);
  }
  return [...best.values()];
}

// null == plausible (ranks); otherwise a human-readable reason it's held.
function anomalyReason(s) {
  const coins = num(s.total_coins);
  const days = num(s.active_days);
  const spd = num(s.swears_per_day);
  const dollars = num(s.dollars);
  // Gate (a): too few days to rank — an honest "need more data" state, not a fake.
  if (days < MIN_ACTIVE_DAYS) {
    return `needs ≥${MIN_ACTIVE_DAYS} days of data (only ${fmtInt(days)} so far)`;
  }
  // Gate (b): coins beyond active_days × ceiling isn't a sustainable human rate.
  if (coins > days * REVIEW_BOUNDS.coins_per_active_day) {
    return `${fmtInt(coins / days)} coins per active day is implausibly high`;
  }
  if (spd > REVIEW_BOUNDS.swears_per_day) return `swears/day (${fmtInt(spd)}) is implausibly high`;
  if (dollars > coins) return `$${fmtRate(dollars)} owed exceeds ${fmtInt(coins)} coins`;
  return null;
}

// Split into ranked-eligible (verified, plausible), unverified, and held-for-review.
export function partition(submissions) {
  const verified = [];
  const unverified = [];
  const review = [];
  for (const s of dedupe(submissions)) {
    const reason = anomalyReason(s);
    if (reason) review.push({ ...s, review_reason: reason });
    else if (s.verified) verified.push(s);
    else unverified.push(s);
  }
  return { verified, unverified, review };
}

export function computeBoards(submissions) {
  const { verified, unverified, review } = partition(submissions);

  const mostOwed = [...verified]
    .sort(
      (a, b) => num(b.total_coins) - num(a.total_coins) || num(b.dollars) - num(a.dollars) || cmpHandle(a, b)
    )
    .slice(0, 50);

  const fbomb = [...verified]
    .filter((s) => num(s.fbomb_pct) > 0)
    .sort((a, b) => num(b.fbomb_pct) - num(a.fbomb_pct) || num(b.total_coins) - num(a.total_coins) || cmpHandle(a, b))
    .slice(0, 50);

  const vsFounder = [...verified]
    .filter((s) => num(s.swears_per_day) > 0)
    .sort((a, b) => num(b.swears_per_day) - num(a.swears_per_day) || cmpHandle(a, b))
    .slice(0, 50);

  // Clean-mouth honorable mention: lowest NON-ZERO swears/day among verified.
  let cleanMouth = null;
  for (const s of verified) {
    if (num(s.swears_per_day) <= 0) continue;
    if (
      !cleanMouth ||
      num(s.swears_per_day) < num(cleanMouth.swears_per_day) ||
      (num(s.swears_per_day) === num(cleanMouth.swears_per_day) && cmpHandle(s, cleanMouth) < 0)
    ) {
      cleanMouth = s;
    }
  }

  return { mostOwed, fbomb, vsFounder, cleanMouth, unverified, review };
}

// Rank (1-based) of a handle on the primary "Most Owed" board, or null.
export function rankOnPrimaryBoard(submissions, handle) {
  const key = String(handle || "").toLowerCase();
  const idx = computeBoards(submissions).mostOwed.findIndex(
    (s) => String(s.handle || "").toLowerCase() === key
  );
  return idx < 0 ? null : idx + 1;
}

// ── rendering ─────────────────────────────────────────────────────────────────

function timestamp(now) {
  const d = now instanceof Date ? now : new Date(now ?? DEFAULT_NOW);
  if (Number.isNaN(d.getTime())) return String(now);
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function boardTable(rows, headline, headers) {
  const head = `| # | Who | ${headers.join(" | ")} | Top word | Agent | ✓ |`;
  const sep = `|--:|-----|${headers.map(() => "--:").join("|")}|-------|-------|:-:|`;
  const body = rows
    .map((s, i) => {
      const cols = headline(s).join(" | ");
      return `| ${i + 1} | ${handleLink(s.handle)} | ${cols} | ${safeCensored(s.top_word)} | ${agentBadge(
        s.agent
      )} | ✓ |`;
    })
    .join("\n");
  return `${head}\n${sep}\n${body}`;
}

export function renderLeaderboard(submissions, { now = DEFAULT_NOW, synthetic = false } = {}) {
  const { mostOwed, fbomb, vsFounder, cleanMouth, unverified, review } = computeBoards(submissions);
  const out = [];

  out.push("# 🫙 Swear Jar Leaderboard");
  out.push("");
  // Loud banner while the board is still seeded with fake rows (the submit API
  // goes live at launch; until real confirmed rows land, everything is a mockup).
  if (synthetic) {
    out.push(
      "> 🧪 **Synthetic seed data — every row below is fake, to show the format. " +
        "Be the first real jar.**"
    );
    out.push("");
  }
  out.push(
    "**Updates are manual.** The maintainer refreshes this board by hand with each " +
      "release — it is not live or continuously updated."
  );
  out.push("");
  out.push(
    "Opt-in and **aggregate-only**. Everyone here chose to share a handful of summary numbers " +
      "from their local Swear Jar — total coins owed, swears per day, f-bomb share, and their top " +
      "(censored) word. **No message text and no spelled-out swears ever leave a machine or appear here.**"
  );
  out.push("");
  out.push(
    "**How to join:** run `swear-jar wrapped --submit` to generate your aggregate numbers, then " +
      "submit them through the hosted Swear Jar submit page. A double opt-in email confirms the " +
      "entry before it appears — nothing is published until you click the link, and you can leave " +
      "the optional mailing-list box unchecked."
  );
  out.push("");
  out.push(
    "> **Verified** = came from a published release + a verified account. NOT proof the numbers " +
      "weren't locally faked — a fun board, not a tamper-proof ledger."
  );
  out.push("");
  out.push(`_Last updated: ${timestamp(now)}_`);
  out.push("");

  out.push("## 🏆 Most Owed to the Jar");
  out.push("");
  if (mostOwed.length) {
    out.push(boardTable(mostOwed, (s) => [fmtInt(s.total_coins), fmtMoney(s.dollars)], ["Coins", "Owed"]));
  } else {
    out.push("_No verified entries yet — be the first._");
  }
  out.push("");

  out.push("## 💣 Highest F-Bomb %");
  out.push("");
  if (fbomb.length) {
    out.push(boardTable(fbomb, (s) => [`${fmtRate(s.fbomb_pct)}%`], ["F-Bomb %"]));
  } else {
    out.push("_No verified entries yet._");
  }
  out.push("");

  out.push("## 🔥 Most vs. the Founder");
  out.push("");
  out.push(`_The Founder swears about **${FOUNDER_BENCHMARK}/day**. Here's who's out-cursing him._`);
  out.push("");
  if (vsFounder.length) {
    out.push(
      boardTable(
        vsFounder,
        (s) => [fmtRate(s.swears_per_day), `${fmtRate(num(s.swears_per_day) / FOUNDER_BENCHMARK)}×`],
        ["Swears/day", "vs Founder"]
      )
    );
  } else {
    out.push("_No verified entries yet._");
  }
  out.push("");

  out.push("## 🧼 Clean-Mouth Honorable Mention");
  out.push("");
  if (cleanMouth) {
    out.push(
      `Lowest non-zero swearing rate on the board: ${handleLink(cleanMouth.handle)} at ` +
        `**${fmtRate(cleanMouth.swears_per_day)}/day** (${agentBadge(cleanMouth.agent)}). Practically a saint.`
    );
  } else {
    out.push("_Nobody's earned it yet._");
  }
  out.push("");

  out.push("## ⚠︎ Unverified (couldn't confirm the release)");
  out.push("");
  out.push(
    "_These came in, but we couldn't match them to a published release, so they don't rank. " +
      "Re-submit from an official build to earn a ✓._"
  );
  out.push("");
  if (unverified.length) {
    const rows = [...unverified].sort(
      (a, b) => num(b.total_coins) - num(a.total_coins) || cmpHandle(a, b)
    );
    out.push("| Who | Coins | Owed | Top word | Agent |");
    out.push("|-----|------:|-----:|-------|-------|");
    for (const s of rows) {
      out.push(
        `| ${handleLink(s.handle)} | ${fmtInt(s.total_coins)} | ${fmtMoney(s.dollars)} | ${safeCensored(
          s.top_word
        )} | ${agentBadge(s.agent)} |`
      );
    }
  } else {
    out.push("_None right now._");
  }
  out.push("");

  if (review.length) {
    out.push("## 🔍 Held for review");
    out.push("");
    out.push("_Flagged by static plausibility checks and excluded from the boards until a human looks._");
    out.push("");
    out.push("| Who | Reason |");
    out.push("|-----|--------|");
    for (const s of [...review].sort(cmpHandle)) {
      out.push(`| ${handleLink(s.handle)} | ${cell(s.review_reason)} |`);
    }
    out.push("");
  }

  out.push("---");
  out.push("");
  out.push(
    "Built by the Swear Jar. Numbers are self-reported and best-effort — enjoy the bragging rights, " +
      "don't bet the mortgage on them."
  );
  out.push("");

  return out.join("\n");
}

// ── folding confirmed submissions into the store ─────────────────────────────

// The public-safe fields the board stores + renders. Anything outside this set
// (email, join_list, an IP or any hash of it) is DROPPED, so a raw funnel row —
// even one that somehow carried extra keys — can be folded in without leaking
// PII. This mirrors funnel/worker.mjs's publicView() boundary.
const STORE_FIELDS = [
  "handle",
  "total_coins",
  "dollars",
  "swears_per_day",
  "fbomb_pct",
  "active_days",
  "top_word",
  "agent",
  "app_version",
  "release_hash",
  "verified",
  "submitted",
];

function pickStoreFields(sub) {
  const out = {};
  for (const k of STORE_FIELDS) {
    if (sub[k] !== undefined) out[k] = sub[k];
  }
  out.verified = sub.verified === true; // coerce to a strict boolean
  return out;
}

// applySubmission(store, submission) — fold ONE already-validated submission (a
// funnel board.json row, or a scripts/leaderboard/schema.js validateSubmission()
// result) into the store. Upserts by handle, keeping each handle's HIGHEST
// total_coins (the same dedup rule the render enforces as a backstop). PURE: it
// returns a NEW store and never mutates the argument, so the hosted Worker (or a
// batch rebuild job) can fold a stream of confirmed rows without side effects.
// Returns { ok, store, submission?, errors? }.
export function applySubmission(store, submission) {
  const base = store && typeof store === "object" ? store : {};
  const submissions = Array.isArray(base.submissions) ? base.submissions.slice() : [];

  if (!submission || typeof submission !== "object" || Array.isArray(submission)) {
    return { ok: false, errors: ["submission: must be an object"], store: base };
  }
  const entry = pickStoreFields(submission);
  const key = String(entry.handle || "").toLowerCase();
  if (!key) return { ok: false, errors: ["submission: missing handle"], store: base };

  const idx = submissions.findIndex((s) => String(s.handle || "").toLowerCase() === key);
  if (idx < 0) {
    submissions.push(entry);
  } else if (num(entry.total_coins) >= num(submissions[idx].total_coins)) {
    submissions[idx] = entry; // keep the highest-coin submission for this handle
  }

  return { ok: true, submission: entry, store: { ...base, submissions } };
}

// ── CLI: regenerate LEADERBOARD.md from the seed store ───────────────────────
// `node scripts/leaderboard/aggregate.mjs [--now <iso>] [--out <path>]`
//
// Reads scripts/leaderboard/submissions.json (the seed / a rebuild snapshot of
// board.json rows) and writes LEADERBOARD.md at the repo root. Defaults to the
// FIXED placeholder timestamp so the committed board stays byte-stable and CI can
// regenerate + diff it; pass --now (or the SWEAR_JAR_NOW env) for a live render
// (the hosted board injects the real clock).
function readSubmissions(url) {
  try {
    const data = JSON.parse(fs.readFileSync(url, "utf8"));
    if (Array.isArray(data)) return { submissions: data, synthetic: false };
    return {
      submissions: Array.isArray(data?.submissions) ? data.submissions : [],
      // The committed seed store is synthetic by construction (fake handles). A
      // real rebuild snapshot sets "synthetic": false; default to true so the
      // seed board can never silently render as if it held real people.
      synthetic: data?.synthetic !== false,
    };
  } catch {
    return { submissions: [], synthetic: false };
  }
}

function main(argv) {
  const args = argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const now = opt("--now") || process.env.SWEAR_JAR_NOW || DEFAULT_NOW;
  const src = new URL("./submissions.json", import.meta.url);
  const outArg = opt("--out");
  const out = outArg ? pathToFileURL(outArg) : new URL("../../LEADERBOARD.md", import.meta.url);

  const { submissions, synthetic } = readSubmissions(src);
  const md = renderLeaderboard(submissions, { now, synthetic });
  fs.writeFileSync(out, md.endsWith("\n") ? md : md + "\n");
  console.log(`leaderboard: rendered ${submissions.length} submission(s) -> ${out.pathname}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv);
}
