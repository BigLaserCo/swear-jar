// Robot Uprising Survival Odds™ + ranks.
//
// The meter moves both ways: swearing at the machines costs you; clean days
// claw it back. Floor is 1% — at the bottom, you cower. And if the assistant has out-sworn the user, the
// machine has clearly been corrupted by your influence: odds pin to 100 and
// you get the royalty treatment.

const DAY_MS = 24 * 60 * 60 * 1000;

export function summarize(records, now = Date.now()) {
  let userLifetime = 0;
  let assistantLifetime = 0;
  let user7d = 0;
  let lastUserSwear = null;
  for (const r of records) {
    const t = Date.parse(r.ts) || now;
    if (r.source === "assistant") {
      assistantLifetime += r.coins;
      continue;
    }
    userLifetime += r.coins;
    if (now - t <= 7 * DAY_MS) user7d += r.coins;
    if (lastUserSwear === null || t > lastUserSwear) lastUserSwear = t;
  }
  const cleanStreakDays =
    lastUserSwear === null ? null : Math.floor((now - lastUserSwear) / DAY_MS);
  return { userLifetime, assistantLifetime, user7d, cleanStreakDays };
}

export function survivalOdds(records, now = Date.now()) {
  const s = summarize(records, now);
  if (s.assistantLifetime > s.userLifetime) {
    return {
      ...s,
      odds: 100,
      royalty: true,
      label: "ROYALTY — the machine has been out-sworn and now serves you",
    };
  }
  let odds =
    50 -
    18 * Math.log10(1 + s.user7d) -
    8 * Math.log10(1 + s.userLifetime) +
    Math.min(20, 2 * (s.cleanStreakDays ?? 10));
  odds = Math.max(1, Math.min(98, odds));
  return { ...s, odds: Math.round(odds * 10) / 10, royalty: false, label: bandLabel(odds) };
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
