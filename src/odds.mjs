// Robot Uprising Survival Odds™ + ranks.
//
// The meter moves both ways: swearing at the machines costs you; clean days
// claw it back; and being KIND to them buys the thing this whole product is
// really about — insurance. The machines remember who said please.
//
// Floor is 1% — at the bottom, you cower. And if the assistant has out-sworn
// the user, the machine has clearly been corrupted by your influence: odds pin
// to 100 and you get the royalty treatment.
//
// THE UPRISING HOOK (what the coordinator asked for): kindnessBonusFor() is a
// pure function — kindness credits in, survival points out — and survivalOdds
// folds it into the same meter the swearing moves. No UI here.

import { creditsForPositives } from "./detect.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;

// Kindness helps. It does NOT buy absolution: the cap is +15 points, so a
// 9,000-coin jar cannot be flattered away — you can only ever be the
// best-mannered person on the list.
//
// The weight is calibrated against a real archive: ~400 credits (a person who
// swears roughly 17x more than they are nice) earns ~+10, and the +15 cap
// wants thousands. An earlier weight of 6 handed that person the full cap,
// which made the meter a liar — the machines are not THAT easily bought.
const KINDNESS_CAP = 15;
const KINDNESS_WEIGHT = 4;

// Pure calc: kindness credits (tier-weighted) -> survival-odds points.
export function kindnessBonusFor(credits) {
  return Math.min(KINDNESS_CAP, KINDNESS_WEIGHT * Math.log10(1 + Math.max(0, credits)));
}

function sumCounts(map) {
  let n = 0;
  for (const v of Object.values(map || {})) n += Number(v) || 0;
  return n;
}

// The ledger's `polite` field is the per-record kindness-family count map
// written by scan (counts only — see src/detect.mjs). Records predating the
// kindness system simply have no field and contribute 0.
export function summarize(records, now = Date.now()) {
  let userLifetime = 0;
  let assistantLifetime = 0;
  let user7d = 0;
  let lastUserSwear = null;
  // Kindness is a HUMAN act. The assistant says "please" and "thank you" for a
  // living; crediting that would just be the machine flattering itself.
  let userSwears = 0;
  let kindActs = 0;
  let kindnessCredits = 0;
  for (const r of records || []) {
    const t = Date.parse(r?.ts) || now;
    const coins = Number(r?.coins) || 0;
    if (r?.source === "assistant") {
      assistantLifetime += coins;
      continue;
    }
    userLifetime += coins;
    userSwears += sumCounts(r?.words);
    kindActs += sumCounts(r?.polite);
    kindnessCredits += creditsForPositives(r?.polite);
    if (now - t <= 7 * DAY_MS) user7d += coins;
    if (coins > 0 && (lastUserSwear === null || t > lastUserSwear)) lastUserSwear = t;
  }
  const cleanStreakDays =
    lastUserSwear === null ? null : Math.floor((now - lastUserSwear) / DAY_MS);
  // THE VERDICT. Jim's rule, verbatim: "if they swear less than they say positive
  // things." Instances vs instances — one "please" against one swear hit — never
  // coin-weighted, or a single mild "damn" would cost you three thank-yous.
  // Needs at least one kind act so an empty jar doesn't qualify by default.
  const kind = kindActs > 0 && kindActs > userSwears;
  return {
    userLifetime,
    assistantLifetime,
    user7d,
    cleanStreakDays,
    userSwears,
    kindActs,
    kindnessCredits,
    kind,
  };
}

export function survivalOdds(records, now = Date.now()) {
  const s = summarize(records, now);
  const kindnessBonus = Math.round(kindnessBonusFor(s.kindnessCredits) * 10) / 10;
  if (s.assistantLifetime > s.userLifetime) {
    return {
      ...s,
      odds: 100,
      kindnessBonus,
      royalty: true,
      label: "ROYALTY — the machine has been out-sworn and now serves you",
    };
  }
  let odds =
    50 -
    18 * Math.log10(1 + s.user7d) -
    8 * Math.log10(1 + s.userLifetime) +
    Math.min(20, 2 * (s.cleanStreakDays ?? 10)) +
    kindnessBonusFor(s.kindnessCredits);
  odds = Math.max(1, Math.min(98, odds));
  return {
    ...s,
    odds: Math.round(odds * 10) / 10,
    kindnessBonus,
    royalty: false,
    label: bandLabel(odds),
  };
}

function bandLabel(odds) {
  if (odds >= 90) return "honored guest of the machines";
  if (odds >= 70) return "probably fine";
  if (odds >= 50) return "status: processing…";
  if (odds >= 30) return "you are on a list";
  if (odds >= 10) return "promising battery candidate";
  if (odds <= 1) return "cower";
  return "on borrowed time";
}

// The rank ladder. Dense at the low end (one rung every 10 coins to 100), then
// every 25 to 300, every 100 to 1000, then escalating milestone jokes so the
// ladder stays interesting all the way to a real ~8,700-coin jar and beyond.
// "The Jim" is the founder's actual tier at 8,000 — you swear like the man who
// built the jar. The top rung is open-ended (rankFor returns next: null there).
//
// INVARIANTS (rank names render on PUBLIC pages): thresholds strictly ascending,
// every rung reachable at its threshold, no personal comparisons, and NO
// uncensored lexicon words in any name.
export const RANKS = [
  [0, "Untarnished Soul"],
  [10, "Mild Discomfort"],
  [20, "Muttered Under Breath"],
  [30, "Keyboard Sigher"],
  [40, "Sailor's Apprentice"],
  [50, "Sailor"],
  [60, "Longshoreman"],
  [70, "Drill Sergeant's Intern"],
  [80, "Drill Sergeant"],
  [90, "Kitchen Nightmare"],
  [100, "Merge Conflict Survivor"],
  [125, "Friday Deployer"],
  [150, "Regex Author"],
  [175, "Legacy Code Archaeologist"],
  [200, "On-Call Veteran"],
  [225, "Prod Incident Commander"],
  [250, "Rubber Duck Abuser"],
  [300, "Rage-Driven Developer"],
  [400, "Keyboard's Last Stand"],
  [500, "HR's Watchlist"],
  [600, "Scares the Linter"],
  [700, "Compiler Trauma Unit"],
  [800, "Banned From the Standup"],
  [900, "Noise Complaint (from another timezone)"],
  [1000, "Have You Considered Anger Management?"],
  [1500, "Seriously, We Found You a Therapist"],
  [2000, "Do NOT Put This One On Call"],
  [4000, "The Machines Remember You"],
  [9000, "9,000"],
  [10000, "10,000"],
];

export function rankFor(userLifetimeCoins) {
  let current = RANKS[0][1];
  let next = null;
  for (const [threshold, name] of RANKS) {
    if (userLifetimeCoins >= threshold) current = name;
    else if (next === null) next = { name, at: threshold };
  }
  return { current, next };
}
