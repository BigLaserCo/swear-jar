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
// Their transcript-native replacements: coins-by-project, you-vs-machine,
// uprising odds + rank.

import { LEXICON, TIER_COINS, creditTierFor, creditsForPositives, dollarsForPositives, CREDIT_COINS } from "./detect.mjs";
import { survivalOdds, rankFor } from "./odds.mjs";
import { COIN_VALUE, recordDollars } from "./render.mjs";

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
  let totalDollars = 0;
  let userDollars = 0;
  let machineDollars = 0;

  // --- swear-instance counts (raw hits, not coin-weighted) ---
  let totalSwears = 0; // every swear instance, user + machine
  let userSwears = 0; // just the human's swear instances
  let userWords = 0;
  const userHistoryDates = new Set();

  // --- kindness credits: positive instances, by family, HUMAN records only ---
  const posCounts = new Map(); // family -> instances
  const rejectCounts = new Map(); // reason code -> count (the audit trail)
  let kindnessDollars = 0;
  // Backward-compat: the pre-kindness "manners" stat the current UI still reads
  // (goldStar banner). Sums ALL records' `polite` field, exactly as before.
  let politeTotal = 0;

  // --- distributions ---
  const byHour = new Array(24).fill(0);
  const byHourSwears = new Array(24).fill(0);
  const byHourRecords = new Array(24).fill(0);
  const byDow = new Array(7).fill(0);
  const byProject = new Map();
  const byDay = new Map(); // dateKey -> coins
  const wordCounts = new Map(); // family -> count
  const comboCounts = new Map(); // "famA famB" (sorted) -> co-occurrences in one USER record
  const firstUserMin = new Map(); // dateKey -> earliest user-swear minute-of-day
  const userDates = new Set(); // dates the human swore (for the streak)
  // kindness distributions — same wall-clock buckets as the rage side, but the
  // unit is tier-weighted CREDITS (a grovel counts more than a please), and only
  // HUMAN records earn them (matching the crediting rule above).
  const kindByHour = new Array(24).fill(0);
  const kindByDow = new Array(7).fill(0);
  const kindByDay = new Map(); // dateKey -> credits
  const firstKindMin = new Map(); // dateKey -> earliest kind minute-of-day
  const kindDates = new Set(); // dates the human was kind (for the kind streak)
  let firstTs = null;
  let lastTs = null;

  for (const r of recs) {
    const coins = Number(r?.coins) || 0;
    totalCoins += coins;
    const isMachine = r?.source === "assistant";
    const amount = recordDollars(r);
    totalDollars += amount;
    if (isMachine) machineCoins += coins;
    else userCoins += coins;
    if (isMachine) machineDollars += amount;
    else userDollars += amount;

    // project split (all coins — the jar total is user + machine)
    const proj = r?.project || "unknown";
    byProject.set(proj, (byProject.get(proj) || 0) + coins);

    // word families + swear-instance counts
    const famsInRec = []; // distinct families present in this record (for combos)
    for (const [w, n] of Object.entries(r?.words || {})) {
      const cnt = Number(n) || 0;
      wordCounts.set(w, (wordCounts.get(w) || 0) + cnt);
      totalSwears += cnt;
      if (!isMachine) userSwears += cnt;
      if (cnt > 0) famsInRec.push(w);
    }
    if (!isMachine && Number(r?.word_count) > 0) {
      userWords += Number(r.word_count);
      const wordParts = parseParts(r?.ts);
      if (wordParts) userHistoryDates.add(wordParts.dateKey);
    }
    // backward-compat manners tally (ALL records, matches the old goldStar).
    for (const n of Object.values(r?.polite || {})) politeTotal += Number(n) || 0;
    // kindness tally — records predating the kindness system have no `polite`
    // field (→ 0), so old ledgers keep working. Counts only; never any text.
    // HUMAN records only: the assistant says "please" for a living, and paying
    // it credit would just be the machine flattering itself.
    if (!isMachine) {
      for (const [k, n] of Object.entries(r?.polite || {})) {
        posCounts.set(k, (posCounts.get(k) || 0) + (Number(n) || 0));
      }
      kindnessDollars += dollarsForPositives(r?.polite);
      for (const [reason, n] of Object.entries(r?.rejects || {})) {
        rejectCounts.set(reason, (rejectCounts.get(reason) || 0) + (Number(n) || 0));
      }
      // kindness time buckets (credit-weighted, human-only)
      const recCredits = creditsForPositives(r?.polite);
      if (recCredits > 0) {
        const kp = parseParts(r?.ts);
        if (kp) {
          kindByHour[kp.hh] += recCredits;
          kindByDow[kp.dow] += recCredits;
          kindByDay.set(kp.dateKey, (kindByDay.get(kp.dateKey) || 0) + recCredits);
          kindDates.add(kp.dateKey);
          const kmins = kp.hh * 60 + kp.mm;
          if (!firstKindMin.has(kp.dateKey) || kmins < firstKindMin.get(kp.dateKey)) {
            firstKindMin.set(kp.dateKey, kmins);
          }
        }
      }
    }

    // signature combo: which two families the HUMAN lands in the same message.
    // We only have per-record family sets (no ordering), so this is honestly a
    // "most common pairing", not a literal back-to-back sequence.
    if (!isMachine && famsInRec.length >= 2) {
      const uniq = [...new Set(famsInRec)].sort();
      for (let i = 0; i < uniq.length; i++) {
        for (let j = i + 1; j < uniq.length; j++) {
          const key = `${uniq[i]} ${uniq[j]}`;
          comboCounts.set(key, (comboCounts.get(key) || 0) + 1);
        }
      }
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
      byHourSwears[p.hh] += Object.values(r?.words || {}).reduce((n, v) => n + (Number(v) || 0), 0);
      byHourRecords[p.hh] += 1;
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

  // --- kindness derived series (mirrors of the rage side, credit-weighted) ---
  const kindDaySeries = [...kindByDay.entries()]
    .map(([date, credits]) => ({ date, credits }))
    .sort((a, b) => a.date.localeCompare(b.date));
  let bestKindDay = null;
  for (const d of kindDaySeries) if (!bestKindDay || d.credits > bestKindDay.credits) bestKindDay = d;
  // longest run of consecutive calendar days with at least one credited kindness
  let kindStreak = 0;
  {
    let run2 = 0;
    let prev2 = null;
    for (const key of [...kindDates].sort()) {
      const cur = Date.parse(key + "T00:00:00Z");
      if (prev2 !== null && cur - prev2 === DAY_MS) run2 += 1;
      else run2 = 1;
      if (run2 > kindStreak) kindStreak = run2;
      prev2 = cur;
    }
  }
  let firstThanksAvg = null;
  if (firstKindMin.size) {
    const avg = [...firstKindMin.values()].reduce((a, b) => a + b, 0) / firstKindMin.size;
    firstThanksAvg = fmtClock(avg);
  }

  const activeDays = byDay.size;
  const coinsPerActiveDay = activeDays ? round1(totalCoins / activeDays) : 0;

  const swearsPerDay = activeDays ? round1(userSwears / activeDays) : 0;
  const userHistoryDays = userHistoryDates.size;
  const swearsPer100Words = userHistoryDays >= 60 && userWords > 0 ? round1((userSwears / userWords) * 100) : null;

  // --- % of the f-tier (f-bomb share of all swears) ---
  const fbombPct = totalSwears ? Math.round((100 * fbombs) / totalSwears) : 0;

  // --- signature combo: the human's most common family pairing in one message ---
  let signatureCombo = null;
  {
    let best = null;
    for (const [key, c] of comboCounts.entries()) {
      if (!best || c > best.count || (c === best.count && key < best.key)) {
        best = { key, count: c };
      }
    }
    if (best) {
      const [a, b] = best.key.split(" ");
      signatureCombo = { a, b, count: best.count };
    }
  }

  // --- % clean days: over the coin span (first→last active day), the share of
  // calendar days with ZERO coins. Honest denominator = the whole span. ---
  let cleanDaysPct = 0;
  let spanDays = 0;
  if (byDay.size) {
    const dayKeys = [...byDay.keys()].sort();
    const firstDay = Date.parse(dayKeys[0] + "T00:00:00Z");
    const lastDay = Date.parse(dayKeys[dayKeys.length - 1] + "T00:00:00Z");
    spanDays = Math.round((lastDay - firstDay) / DAY_MS) + 1;
    const clean = Math.max(0, spanDays - activeDays);
    cleanDaysPct = spanDays > 0 ? Math.round((100 * clean) / spanDays) : 0;
  }

  // --- uprising odds + rank (reuse odds.mjs) ---
  const o = survivalOdds(recs, now);
  const rank = rankFor(o.userLifetime);

  const total = userCoins + machineCoins;
  const userPct = total ? Math.round((100 * userCoins) / total) : 0;

  // --- KINDNESS CREDITS. o.kindActs / o.kindnessCredits / o.kind come from
  // odds.mjs summarize(), the ONE place the verdict rule lives — so every
  // surface built on this data agrees on whether the user qualifies as kind.
  // topPositives + rejects are the audit trail the design/CLI render. ---
  const goldStar = politeTotal > 0 && politeTotal > totalSwears; // backward-compat
  const topPositives = [...posCounts.entries()]
    .filter(([, c]) => c > 0)
    .map(([word, count]) => {
      const tier = creditTierFor(word) || "courtesy";
      return { word, count, tier, credits: count * (CREDIT_COINS[tier] || 1) };
    })
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
  const rejects = [...rejectCounts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  const rejectedTotal = rejects.reduce((n, r) => n + r.count, 0);

  return {
    app: "Swear Jar",
    generatedAt: new Date(now).toISOString(),
    coinValue: COIN_VALUE,
    totalCoins,
    totalRecords: recs.length,
    dollarsOwed: Math.round(totalDollars * 100) / 100,
    userDollars: Math.round(userDollars * 100) / 100,
    machineDollars: Math.round(machineDollars * 100) / 100,
    userCoins,
    machineCoins,
    userPct,
    machinePct: total ? 100 - userPct : 0,
    totalSwears,
    userSwears,
    userWords,
    userHistoryDays,
    swearsPer100Words,
    // Kindness credits — the jar's counterweight (the design reads these).
    kindActs: o.kindActs, // positive INSTANCES (the verdict's unit)
    kindnessCredits: o.kindnessCredits, // tier-weighted credits (the odds' unit)
    kindnessDollars: Math.round(kindnessDollars * 100) / 100, // data only — NEVER shown as money back (Jim: karma, not credit)
    netDollars: Math.round((totalDollars - kindnessDollars) * 100) / 100,
    kind: o.kind, // qualifies as kind: more kind acts than swears
    topPositives, // [{word,count,tier,credits}] — credited, by family
    rejects, // [{reason,count}] — the audit trail of what did NOT count
    rejectedTotal,
    // kindness time distributions (credit-weighted, human-only)
    kindByHour,
    kindByDow,
    kindDaySeries, // [{date,credits}]
    bestKindDay,
    kindStreak,
    firstThanksAvg,
    politeTotal, // backward-compat: total manners instances (old goldStar input)
    goldStar, // backward-compat: the pre-kindness banner flag the current UI reads
    swearsPerDay,
    fbombPct,
    signatureCombo,
    spanDays,
    cleanDaysPct,
    byHour,
    byHourSwears,
    byHourRecords,
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
    odds: {
      value: o.odds,
      royalty: o.royalty,
      label: o.label,
      user7d: o.user7d,
      kindnessBonus: o.kindnessBonus, // survival-odds points bought with kindness
    },
    rank,
  };
}
