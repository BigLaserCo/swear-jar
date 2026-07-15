// Swear detection. The word lists and the counting logic — the part most worth
// reading, because it says exactly what the jar charges for.
//
// Ported from the audited Python lexicon (25+ families: elongations `f+u+c+k`,
// compounds, British slang, and the hard-won negative guards — no god/jesus/
// suck, arse-not-arsenal, knob-alone excluded, sod-alone excluded). On top of
// the Python families this build keeps:
//   - an "artisanal" tier (5 coins) for the choicest compounds
//     (motherfucker / goddamn / clusterfuck / cocksucker), which run FIRST and
//     take the attribution off the cheaper base family they contain;
//   - censored-form patterns (f*ck, s#it) so a coy asterisk doesn't dodge the jar;
//   - the overlap-blanking algorithm, so an overlapping match (bullshit vs shit,
//     motherfucker vs fuck) is attributed exactly once.
//
// Tiers set the damage-point price. Python's tier mapping is preserved:
//   strong  -> premium  (3 coins)
//   medium  -> standard (2 coins)
//   mild    -> mild     (1 coin)
// and the artisanal overlaps stay at 5. General profanity ONLY — deliberately
// no slurs.

const CENSOR = "[*@#$%!]";

export const TIER_COINS = { mild: 1, standard: 2, premium: 3, artisanal: 5 };
// Money is deliberately simpler than damage points: mild words are 50 cents,
// ordinary swears are a dollar, and the truly bad words/compounds are $5.
export const TIER_DOLLARS = { mild: 0.50, standard: 1.00, premium: 1.00, artisanal: 5.00 };
export const WORD_DOLLARS = { cunt: 5.00, "user-specific": 1.00 };

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// key -> attribution family, tier -> coin price, re -> global/ignore-case match.
function pat(key, tier, source) {
  return { key, tier, re: new RegExp(source, "gi") };
}

// Order IS the priority: earlier patterns match and blank first, so the
// artisanal compounds claim their word before the base family can, and a
// compound like "bullshit" is counted as one "shit" rather than shit + a stray.
export const LEXICON = [
  // ── artisanal (5) — run first so they out-rank the base family they contain
  pat("motherfucker", "artisanal", "\\bmotherfuck\\w*\\b"),
  pat("clusterfuck", "artisanal", "\\bclusterfuck\\w*\\b"),
  pat("cocksucker", "artisanal", "\\bcocksucker\\w*\\b"),
  pat("goddamn", "artisanal", "\\bgod ?dam(?:n|mit)\\w*\\b"),

  // ── premium (3) — strong tier in Python
  pat("fuck", "premium", "\\b\\w*f+u+c+k+\\w*\\b"), // fuck, fucking, unfuck, elongations
  pat("fuck", "premium", `\\bf${CENSOR}+(?:ck|k)\\w*\\b`), // f*ck / f#k
  pat("fuck", "premium", `\\bfu${CENSOR}+k\\w*\\b`), // fu**k
  pat("cunt", "premium", "\\bc+u+n+t+\\w*\\b"),

  // ── standard (2) — medium tier in Python
  pat("shit", "standard", "\\b(?:bull|horse|dog|dip|ape|bat|jack|cow|no|gob)?s+h+i+t+\\w*\\b"),
  pat("shit", "standard", `\\bs(?:h)?${CENSOR}+(?:it|t)\\w*\\b`), // s#it / sh*t
  pat("ass", "standard", "\\b(?:dumb|jack|smart|fat|wise|hard|half)?ass(?:hole|holes|hat|es|clown|wipe)?\\b"),
  pat("ass", "standard", `\\ba${CENSOR}+(?:s|hole)\\w*\\b`), // a**hole / a#s
  pat("bitch", "standard", "\\bb+i+t+c+h+\\w*\\b"),
  pat("bastard", "standard", "\\bbastard\\w*\\b"),
  pat("dick", "standard", "\\bdick(?:head|heads|wad|face|s)?\\b"),
  pat("piss", "standard", "\\bpiss\\w*\\b"),
  pat("cock", "standard", "\\bcock(?:sucker|head|womble|s)?\\b"),
  pat("prick", "standard", "\\bprick\\w*\\b"),
  pat("twat", "standard", "\\btwat\\w*\\b"),
  pat("wank", "standard", "\\bwank\\w*\\b"),
  pat("bollocks", "standard", "\\bbollock\\w*\\b"),
  pat("arse", "standard", "\\barse(?:hole|holes|d)?\\b"), // arse/arsehole — NOT "arsenal"
  pat("douche", "standard", "\\bdouche(?:bag|s)?\\b"),
  pat("tosser", "standard", "\\btosser\\w*\\b"),
  pat("knobhead", "standard", "\\bknob(?:head|end)\\b"), // "knob" alone excluded (door knob)
  pat("bellend", "standard", "\\bbell ?end\\b"),
  pat("tits", "standard", "\\btits\\b|\\btitties\\b"),
  pat("shag", "standard", "\\bshag(?:ged|ging|s)?\\b"),

  // ── mild (1)
  pat("damn", "mild", "\\bdamn(?:ed|it)?\\b|\\bdammit\\b"),
  pat("hell", "mild", "\\bhell\\b"),
  pat("crap", "mild", "\\bcrap\\w*\\b"),
  pat("bloody", "mild", "\\bbloody\\b"),
  pat("bugger", "mild", "\\bbugger\\w*\\b"),
  pat("sod", "mild", "\\bsod(?:ding|\\s+off|\\s+it)\\b"), // "sod" alone excluded (soil)
  pat("feck", "mild", "\\bfeck(?:ing|in|ed|er|s)?\\b"), // Irish — NOT "feckless" (no boundary after feck)
  pat("darn", "mild", "\\bdarn\\w*\\b"),
  pat("heck", "mild", "\\bheck\\b"),

];

const TIER_BY_KEY = (() => {
  const m = {};
  for (const { key, tier } of LEXICON) if (!(key in m)) m[key] = tier;
  return m;
})();

// Reprice old ledger records from their word-family counts so reports do not
// preserve a stale dollar amount calculated under an earlier pricing table.
export function dollarsForWords(words = {}) {
  let total = 0;
  for (const [key, rawCount] of Object.entries(words || {})) {
    const count = Number(rawCount) || 0;
    if (count <= 0) continue;
    const tier = TIER_BY_KEY[key] || (key === "user-specific" ? "premium" : null);
    if (!tier) continue;
    total += count * (WORD_DOLLARS[key] ?? TIER_DOLLARS[tier]);
  }
  return Math.round(total * 100) / 100;
}

// A message that repeats one family more than this is a paste/key-repeat
// artifact ("grovel, bitch." ×104), not 104 swears. Real swearing rarely
// exceeds it; slight undercount beats overcount.
export const FAMILY_CAP = 10;

// Overlapping matches are attributed once: longer/pricier patterns (which run
// first) blank their match, so a cheaper pattern can't re-claim the same span.
export function detect(text, { customWords = [] } = {}) {
  if (!text || typeof text !== "string") return { words: {}, coins: 0, dollars: 0 };
  let scratch = text.toLowerCase();
  const words = {};
  const tiers = {};
  let coins = 0;
  let dollars = 0;
  for (const { key, tier, re } of LEXICON) {
    re.lastIndex = 0;
    scratch = scratch.replace(re, (m) => {
      words[key] = (words[key] || 0) + 1;
      tiers[key] = tier;
      coins += TIER_COINS[tier];
      dollars += WORD_DOLLARS[key] ?? TIER_DOLLARS[tier];
      return " ".repeat(m.length); // blank so a cheaper pattern can't re-match
    });
  }
  for (const word of customWords) {
    const normalized = String(word || "").trim().toLowerCase();
    if (!normalized || normalized.length > 64) continue;
    const re = new RegExp(`(?<!\\w)${escapeRegExp(normalized)}(?!\\w)`, "gi");
    const matches = scratch.match(re) || [];
    if (matches.length) {
      const count = Math.min(FAMILY_CAP, matches.length);
      words["user-specific"] = (words["user-specific"] || 0) + count;
      tiers["user-specific"] = "premium";
      coins += count * TIER_COINS.premium;
      dollars += count * WORD_DOLLARS["user-specific"];
      scratch = scratch.replace(re, (m) => " ".repeat(m.length));
    }
  }
  for (const [key, n] of Object.entries(words)) {
    if (n > FAMILY_CAP) {
      coins -= (n - FAMILY_CAP) * TIER_COINS[tiers[key]];
      dollars -= (n - FAMILY_CAP) * (WORD_DOLLARS[key] ?? TIER_DOLLARS[tiers[key]]);
      words[key] = FAMILY_CAP;
    }
  }
  return { words, coins, dollars: Math.round(dollars * 100) / 100 };
}

// Put-downs — NOT profanity. Counted by a separate detector so the headline
// swear number stays honest; a caller folds them in only on request (--insults).
export const INSULTS = [
  pat("stupid", "insult", "\\bstupid\\w*\\b"),
  pat("idiot", "insult", "\\bidiot\\w*\\b"),
  pat("moron", "insult", "\\bmoron\\w*\\b"),
  pat("dumb", "insult", "\\bdumb\\b"),
  pat("lame", "insult", "\\blame\\b"),
  pat("useless", "insult", "\\buseless\\b"),
  pat("pathetic", "insult", "\\bpathetic\\b"),
  pat("garbage", "insult", "\\bgarbage\\b"),
];

// Manners — the other side of the ledger, for the "manners vs. rage" stat.
export const POLITE = [
  pat("please", "polite", "\\bplease\\b"),
  pat("thanks", "polite", "\\bthank(?:s| you)\\b"),
  pat("sorry", "polite", "\\bsorry\\b"),
  pat("appreciate", "polite", "\\bappreciate\\b"),
];

function tally(text, table) {
  if (!text || typeof text !== "string") return { words: {}, total: 0 };
  const lower = text.toLowerCase();
  const words = {};
  let total = 0;
  for (const { key, re } of table) {
    re.lastIndex = 0;
    const n = (lower.match(re) || []).length;
    if (n) {
      words[key] = (words[key] || 0) + n;
      total += n;
    }
  }
  return { words, total };
}

export function detectInsults(text) {
  return tally(text, INSULTS);
}

export function detectPolite(text) {
  return tally(text, POLITE);
}

// For display: never print the raw word back at the user (or into a hook's
// stdout, where it would echo into the next transcript scan).
export function censor(word) {
  if (word.length <= 2) return word[0] + "*";
  return word[0] + "*".repeat(word.length - 2) + word[word.length - 1];
}
