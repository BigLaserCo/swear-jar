// The hosted wrapped URL — milestone 3's collection moment, stated honestly.
//
// This module is PURE: no I/O, no spawn, no fetch, no network of any kind. Its
// entire job is to turn the local stats into a URL string that the CALLER hands
// to src/open.mjs's openInBrowser (the one sanctioned spawn site). The client
// NEVER makes a request — opening our website IS the transfer, and the honesty
// (public source, zero hidden network, every field named on the disclosure
// line) is the whole point.
//
// Privacy is enforced two ways: by CONSTRUCTION (buildWrappedPayload reads only
// the aggregate fields and runs them through funnel/schema.mjs validateWrapped,
// which drops everything else) and by TEST (test/hosted.test.mjs decodes the URL
// and proves no project name / cwd / raw text / uncensored swear survives, and
// that our own detect() scores the whole URL 0).

import {
  validateWrapped,
  encodeWrappedParams,
  CAPS,
} from "../funnel/schema.mjs";
import { APP_VERSION, RELEASE_HASH } from "./version.mjs";

// Every hosted surface lives at swearjar.unfocused.ai (SPEC m3 §7). Override for
// forks / a self-hosted mirror / tests via SWEAR_JAR_HOSTED_URL.
export const HOSTED_BASE =
  process.env.SWEAR_JAR_HOSTED_URL || "https://swearjar.unfocused.ai/wrapped";

// URLs must fit comfortably in any browser/proxy; the spec budgets ≤2KB and the
// worst-case real payload is ~1.1KB. This is a hard assert, not a hope.
const MAX_URL = 2048;

// Length-preserving censor for the wire. NOTE this is deliberately DIFFERENT
// from src/detect.mjs `censor()` ("fuck" -> "f**k"): detect()'s own censored-
// form patterns key on `[*@#$%!]`, so a "f**k" in the URL is still re-detectable
// — it would leave a reconstructable swear in the payload and fail the detect()
// -scores-0 privacy invariant. Masking the interior with "_" (outside detect's
// censor class) keeps the word clearly censored AND collision-resistant (first
// letter + last letter + length distinguish families) while guaranteeing our own
// detector finds nothing anywhere in the URL. "_" is URL-unreserved, so it also
// keeps the wire percent-encoding-free and compact.
function maskWord(w) {
  const s = String(w || "");
  if (!s) return s;
  if (s.length <= 2) return s[0] + "_";
  return s[0] + "_".repeat(s.length - 2) + s[s.length - 1];
}

// stats -> the validated wrapped payload. Only
// the aggregate fields are read; families are the censored top-12 word families
// (masked so even our detector can't reconstruct them, counts merged on the rare
// same-shape collision so nothing is silently lost). Throws if the assembled
// payload somehow fails validation — a bug-catcher, not an expected path.
export function buildWrappedPayload(stats) {
  const topWords = Array.isArray(stats?.topWords) ? stats.topWords : [];
  const families = {};
  for (const w of topWords.slice(0, CAPS.families_max)) {
    if (!w || !w.word) continue;
    const key = maskWord(w.word);
    families[key] = (families[key] || 0) + (Number(w.count) || 0);
  }
  const payload = {
    total_coins: stats.totalCoins,
    dollars: stats.dollarsOwed,
    swears_per_day: stats.swearsPerDay,
    top_word: topWords[0]?.word ? maskWord(topWords[0].word) : "none",
    fbomb_pct: stats.fbombPct,
    active_days: stats.activeDays,
    app_version: APP_VERSION,
    release_hash: RELEASE_HASH,
    families,
    by_hour: stats.byHour,
    by_dow: stats.byDow,
    user_vs_machine: [stats.userCoins, stats.machineCoins],
    odds: Math.round(stats.odds?.value ?? 0), // odds.value carries one decimal; the wire is a whole %
    streak_days: stats.longestStreak ?? 0,
  };
  const res = validateWrapped(payload);
  if (!res.ok) {
    throw new Error(`hosted payload failed schema validation: ${res.errors.join("; ")}`);
  }
  return res.value;
}

// stats (+ records) -> `${HOSTED_BASE}?<compact-params>`. Deterministic trim:
// if the URL somehow runs long, the smallest-count families are dropped first
// (stable tiebreak) until it fits, then a HARD ≤MAX_URL assert. Pure string
// work — no request is made here or anywhere in the client.
export function hostedWrappedUrl(stats, _records = [], opts = {}) {
  const base = opts.base || HOSTED_BASE;
  const value = buildWrappedPayload(stats);
  let url = `${base}?${encodeWrappedParams(value)}`;
  if (url.length > MAX_URL) {
    const fams = Object.entries(value.families).sort(
      (a, b) => a[1] - b[1] || a[0].localeCompare(b[0])
    );
    while (url.length > MAX_URL && fams.length) {
      const [dropKey] = fams.shift();
      delete value.families[dropKey];
      url = `${base}?${encodeWrappedParams(value)}`;
    }
  }
  if (url.length > MAX_URL) {
    throw new Error(`hosted wrapped URL exceeds ${MAX_URL} chars (${url.length})`);
  }
  return url;
}

// The host shown to the user (never a network lookup — just URL parsing).
function hostFor(base) {
  try {
    return new URL(base).host;
  } catch {
    return "swearjar.unfocused.ai";
  }
}

// The one honest line that names EVERY field the URL carries, and points at the
// local escape hatch. `opening:true` (the default) is printed right before we
// actually open the page; `opening:false` is the non-TTY / print-both wording so
// we never claim to have opened anything we didn't. Never your words.
export function disclosureLine(base = HOSTED_BASE, { opening = true } = {}) {
  const lead = opening
    ? `Opening your report on ${hostFor(base)} —`
    : `Your wrapped report on ${hostFor(base)} (open it to share) —`;
  return (
    `🫙 ${lead} the URL carries only: coins, $, ` +
    `swears/day, top word (censored), f-bomb %, active days, families, by-hour, ` +
    `by-day, you-vs-machine, odds, streak. Never your words. ` +
    `(--local keeps it on your machine)`
  );
}

// The PURE closing decision (SPEC m3 §7): hosted is the default; --local /
// SWEAR_JAR_LOCAL_ONLY and an empty ledger force local; --hosted forces hosted
// (but an empty ledger still has nothing to share). `canOpen` comes from
// src/open.mjs shouldAutoOpen (TTY && !--no-open && !SWEAR_JAR_NO_OPEN) — this
// composes with that single gate, it does NOT re-derive it. When we can't open
// (non-TTY, or --no-open), the caller prints BOTH the local path and (when
// applicable) the hosted URL so the skill can relay them.
export function resolveClosing({
  canOpen = false,
  localOnly = false,
  forceHosted = false,
  ledgerEmpty = false,
} = {}) {
  const hostedApplicable = !ledgerEmpty && (forceHosted || !localOnly);
  const mode = canOpen ? (hostedApplicable ? "open-hosted" : "open-local") : "print";
  return { mode, hostedApplicable };
}
