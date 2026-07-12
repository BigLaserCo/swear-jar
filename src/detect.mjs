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
// Tiers set the coin price. Python's tier mapping is preserved:
//   strong  -> premium  (3 coins)
//   medium  -> standard (2 coins)
//   mild    -> mild     (1 coin)
// and the artisanal overlaps stay at 5. General profanity ONLY — deliberately
// no slurs.

const CENSOR = "[*@#$%!]";

export const TIER_COINS = { mild: 1, standard: 2, premium: 3, artisanal: 5 };

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

  // ── international lane — a dev's frustration swears in other tongues, each its
  // own family. General profanity ONLY (no slurs, any language). Every entry is
  // word-boundary-guarded, and any candidate that collides with an innocent
  // English word/substring (mist, skit, con, cul, java) is EXCLUDED — see tests.
  pat("scheisse", "standard", "\\bschei(?:s{1,2}|ß)e?\\w*\\b"), // DE scheiße/scheisse/scheiß
  pat("verdammt", "mild", "\\bverdammt\\w*\\b"), // DE (like "damned")
  pat("merde", "standard", "\\bmerd[ae]\\w*\\b"), // FR merde + IT/PT merda
  pat("putain", "standard", "\\bputain\\w*\\b"), // FR
  pat("mierda", "standard", "\\bmierda\\w*\\b"), // ES
  pat("joder", "standard", "\\bjoder\\w*\\b"), // ES
  pat("cono", "standard", "\\bcoño\\w*\\b"), // ES — ñ REQUIRED; bare "con/cono" excluded
  pat("cabron", "standard", "\\bcabr[oó]n\\w*\\b"), // ES cabrón/cabron
  pat("cazzo", "standard", "\\bcazzo\\w*\\b"), // IT
  pat("vaffanculo", "premium", "\\bvaffanculo\\w*\\b"), // IT (strong)
  pat("caralho", "standard", "\\bcaralho\\w*\\b"), // PT
  pat("kut", "standard", "\\bkut\\b"), // NL — whole word only (not "shortcut")
  pat("godverdomme", "standard", "\\bgodverdomme\\w*\\b"), // NL
  pat("javla", "standard", "\\bj(?:ä|a)vla\\w*\\b"), // SV jävla — NOT "java/javascript"
  pat("blyat", "standard", "\\bblya[dt]\\w*\\b"), // RU translit blyat/blyad
  pat("kurwa", "standard", "\\bkurwa\\w*\\b"), // PL
];

// A message that repeats one family more than this is a paste/key-repeat
// artifact ("grovel, bitch." ×104), not 104 swears. Real swearing rarely
// exceeds it; slight undercount beats overcount.
export const FAMILY_CAP = 10;

// Overlapping matches are attributed once: longer/pricier patterns (which run
// first) blank their match, so a cheaper pattern can't re-claim the same span.
export function detect(text) {
  if (!text || typeof text !== "string") return { words: {}, coins: 0 };
  let scratch = text.toLowerCase();
  const words = {};
  const tiers = {};
  let coins = 0;
  for (const { key, tier, re } of LEXICON) {
    re.lastIndex = 0;
    scratch = scratch.replace(re, (m) => {
      words[key] = (words[key] || 0) + 1;
      tiers[key] = tier;
      coins += TIER_COINS[tier];
      return " ".repeat(m.length); // blank so a cheaper pattern can't re-match
    });
  }
  for (const [key, n] of Object.entries(words)) {
    if (n > FAMILY_CAP) {
      coins -= (n - FAMILY_CAP) * TIER_COINS[tiers[key]];
      words[key] = FAMILY_CAP;
    }
  }
  return { words, coins };
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
