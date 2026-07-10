// Pure stats aggregation for the dashboard.
//
// Takes the raw ledger records (see src/ledger.mjs — {ts, source, project,
// words, coins, ...}) and folds them into a single plain object the HTML
// dashboard renders from. NO I/O, NO rendering, NO network — a pure function
// so it's trivially testable and can't leak anything.
//
// Deliberately DROPPED (were Superwhisper-specific in the Python build and are
// NOT computable from AI-session transcripts — we do not fake them):
//   - swears-per-1,000-words / rage-rate  (no per-record word totals here)
//   - "recordings" counts / % of recordings sworn  (there are no recordings)
//   - politeness + insult tallies          (base lexicon counts swears only)
// Their transcript-native replacements: coins-by-project, you-vs-machine,
// uprising odds + rank.

import { LEXICON, TIER_COINS } from "./detect.mjs";
import { survivalOdds, rankFor } from "./odds.mjs";
import { COIN_VALUE } from "./render.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const DOW_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// family -> tier (the lexicon lists a family under one tier; first wins).
const TIER_BY_KEY = (() => {
  const m = {};
  for (const { key, tier } of LEXICON) if (!(key in m)) m[key] = tier;
  return m;
})();

// The families that count as "f-bombs" for the Wolf-of-Wall-Street gag.
const FBOMB_KEYS = new Set(["fuck", "motherfucker", "clusterfuck", "cocksucker"]);

// Pull the literal wall-clock parts out of an ISO timestamp WITHOUT converting
// timezones — mirrors the Python build and makes hour/day-of-week buckets
// deterministic regardless of the machine that renders the report.
function parseParts(ts) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(ts || ""));
  if (!m) return null;
  const [, y, mo, da, hh, mm] = m.map(Number);
  const dateKey = `${m[1]}-${m[2]}-${m[3]}`;
  const dow = new Date(Date.UTC(y, mo - 1, da)).getUTCDay();
  return { y, mo, da, hh, mm, dateKey, dow };
}

function fmtClock(minsOfDay) {
  const h = Math.floor(minsOfDay / 60) % 24;
  const mm = String(Math.round(minsOfDay) % 60).padStart(2, "0");
  const h12 = h % 12 || 12;
  return `${h12}:${mm}${h < 12 ? "am" : "pm"}`;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function computeStats(records = [], now = Date.now()) {
  const recs = Array.isArray(records) ? records : [];

  // --- coin totals + you-vs-machine split ---
  let totalCoins = 0;
  let userCoins = 0;
  let machineCoins = 0;

  // --- distributions ---
  const byHour = new Array(24).fill(0);
  const byDow = new Array(7).fill(0);
  const byProject = new Map();
  const byDay = new Map(); // dateKey -> coins
  const wordCounts = new Map(); // family -> count
  const firstUserMin = new Map(); // dateKey -> earliest user-swear minute-of-day
  const userDates = new Set(); // dates the human swore (for the streak)
  let firstTs = null;
  let lastTs = null;

  for (const r of recs) {
    const coins = Number(r?.coins) || 0;
    totalCoins += coins;
    if (r?.source === "assistant") machineCoins += coins;
    else userCoins += coins;

    // project split (all coins — the jar total is user + machine)
    const proj = r?.project || "unknown";
    byProject.set(proj, (byProject.get(proj) || 0) + coins);

    // word families
    for (const [w, n] of Object.entries(r?.words || {})) {
      wordCounts.set(w, (wordCounts.get(w) || 0) + (Number(n) || 0));
    }

    // first/last by real instant
    const t = Date.parse(r?.ts);
    if (!Number.isNaN(t)) {
      if (firstTs === null || t < firstTs.t) firstTs = { t, ts: r.ts };
      if (lastTs === null || t > lastTs.t) lastTs = { t, ts: r.ts };
    }

    // time-of-day / day-of-week / per-day buckets (literal wall clock)
    const p = parseParts(r?.ts);
    if (p) {
      byHour[p.hh] += coins;
      byDow[p.dow] += coins;
      byDay.set(p.dateKey, (byDay.get(p.dateKey) || 0) + coins);
      if ((r?.source !== "assistant") && coins > 0) {
        userDates.add(p.dateKey);
        const mins = p.hh * 60 + p.mm;
        if (!firstUserMin.has(p.dateKey) || mins < firstUserMin.get(p.dateKey)) {
          firstUserMin.set(p.dateKey, mins);
        }
      }
    }
  }

  // --- top word families (with tier + coin value) ---
  const topWords = [...wordCounts.entries()]
    .filter(([, c]) => c > 0)
    .map(([word, count]) => {
      const tier = TIER_BY_KEY[word] || "standard";
      return { word, count, tier, coins: count * (TIER_COINS[tier] || 1) };
    })
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));

  const vocab = topWords.length;
  const fbombs = topWords
    .filter((w) => FBOMB_KEYS.has(w.word))
    .reduce((n, w) => n + w.count, 0);
  const wordCoinTotal = topWords.reduce((n, w) => n + w.coins, 0);
  const strongCoins = topWords
    .filter((w) => w.tier === "premium" || w.tier === "artisanal")
    .reduce((n, w) => n + w.coins, 0);
  const spicyPct = wordCoinTotal ? Math.round((100 * strongCoins) / wordCoinTotal) : 0;

  // --- coins by project (top 10) ---
  const projectRows = [...byProject.entries()]
    .map(([project, coins]) => ({ project, coins }))
    .sort((a, b) => b.coins - a.coins || a.project.localeCompare(b.project))
    .slice(0, 10);

  // --- per-day series + worst day ---
  const daySeries = [...byDay.entries()]
    .map(([date, coins]) => ({ date, coins }))
    .sort((a, b) => a.date.localeCompare(b.date));
  let worstDay = null;
  for (const d of daySeries) if (!worstDay || d.coins > worstDay.coins) worstDay = d;

  // --- longest streak: consecutive calendar days the human swore ---
  const streakDates = [...userDates].sort();
  let longestStreak = 0;
  let run = 0;
  let prevKey = null;
  for (const key of streakDates) {
    const cur = Date.parse(key + "T00:00:00Z");
    if (prevKey !== null && cur - prevKey === DAY_MS) run += 1;
    else run = 1;
    if (run > longestStreak) longestStreak = run;
    prevKey = cur;
  }

  // --- day-of-week peak ---
  let worstDowIndex = 0;
  for (let i = 1; i < 7; i++) if (byDow[i] > byDow[worstDowIndex]) worstDowIndex = i;
  const worstDow = totalCoins
    ? { index: worstDowIndex, label: DOW_LONG[worstDowIndex], coins: byDow[worstDowIndex] }
    : null;

  // --- average first-swear time of day ---
  let firstSwearAvg = null;
  if (firstUserMin.size) {
    const avg = [...firstUserMin.values()].reduce((a, b) => a + b, 0) / firstUserMin.size;
    firstSwearAvg = fmtClock(avg);
  }

  const activeDays = byDay.size;
  const coinsPerActiveDay = activeDays ? round1(totalCoins / activeDays) : 0;

  // --- uprising odds + rank (reuse odds.mjs) ---
  const o = survivalOdds(recs, now);
  const rank = rankFor(o.userLifetime);

  const total = userCoins + machineCoins;
  const userPct = total ? Math.round((100 * userCoins) / total) : 0;

  return {
    app: "Swear Jar",
    generatedAt: new Date(now).toISOString(),
    coinValue: COIN_VALUE,
    totalCoins,
    totalRecords: recs.length,
    dollarsOwed: Math.round(totalCoins * COIN_VALUE * 100) / 100,
    userCoins,
    machineCoins,
    userPct,
    machinePct: total ? 100 - userPct : 0,
    byHour,
    byDow,
    dowLabels: DOW_SHORT,
    worstDow,
    byProject: projectRows,
    topWords,
    vocab,
    fbombs,
    spicyPct,
    daySeries,
    worstDay,
    longestStreak,
    cleanStreakDays: o.cleanStreakDays,
    firstSwearAvg,
    firstTs: firstTs ? firstTs.ts : "",
    lastTs: lastTs ? lastTs.ts : "",
    activeDays,
    coinsPerActiveDay,
    odds: { value: o.odds, royalty: o.royalty, label: o.label, user7d: o.user7d },
    rank,
  };
}
