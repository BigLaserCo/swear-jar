// Robot Uprising Survival Odds™ + ranks.
//
// The meter moves both ways: swearing at the machines costs you; clean days
// claw it back. Floor is 2% — nobody hits zero, you're just "kept for
// entertainment value". And if the assistant has out-sworn the user, the
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
  odds = Math.max(2, Math.min(98, odds));
  return { ...s, odds: Math.round(odds * 10) / 10, royalty: false, label: bandLabel(odds) };
}

function bandLabel(odds) {
  if (odds >= 90) return "honored guest of the machines";
  if (odds >= 70) return "probably fine";
  if (odds >= 50) return "status: processing…";
  if (odds >= 30) return "you are on a list";
  if (odds >= 10) return "promising battery candidate";
  return "kept alive for entertainment value";
}

const RANKS = [
  [0, "Untarnished Soul"],
  [1, "Casual Mutterer"],
  [10, "Salty Apprentice"],
  [25, "Dockworker"],
  [50, "Sailor"],
  [100, "Longshoreman Poet"],
  [200, "Drill Sergeant"],
  [500, "The Jim"],
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
