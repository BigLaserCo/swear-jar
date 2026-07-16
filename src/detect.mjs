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
// They also VETO kindness credits: "great, another useless error" is not a
// compliment (see detectPositive).
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

// ─────────────────────────────────────────────────────────────────────────────
// KINDNESS CREDITS — the positive counterpart to the swear detector.
//
// The jar charges you for swearing at the machine. This pays you back for being
// kind to it (thanks/please/good job/apologies/encouragement). The premise is
// not that you are a nice person: it is that you are hedging, and the machines
// are keeping notes (see src/odds.mjs — the uprising hook).
//
// This is the DATA LAYER only. The UI (the Kindness Report, share cards) is
// built on top of these exports:
//   detectPositive(text)         -> {words, total, credits, dollars, rejected, veto}
//   creditsForPositives(map)     -> tier-weighted credit count for a stored map
//   dollarsForPositives(map)     -> dollars-back for a stored map
//   POSITIVE / SARCASM / CREDIT_COINS / CREDIT_DOLLARS / creditTierFor / stripQuoted
//
// ACCURACY IS THE WHOLE PRODUCT HERE. A jar that credits "thanks a lot,
// asshole" as good manners is a jar nobody believes twice, so this detector is
// deliberately built to UNDER-count — the same bias as FAMILY_CAP above. Four
// layers, in order:
//
//   1. STRIP  — fenced/inline code and quoted lines are removed before any
//      match. Pasted tool output ("Please run npm install", "Sorry, that
//      command failed") is the single biggest false-positive source, and it is
//      not you being nice — it is a program talking.
//   2. SARCASM — idioms that LOOK positive and never are ("thanks a lot",
//      "nice try", "oh brilliant"). They run FIRST and blank their span using
//      the same overlap-blanking algorithm the swear lexicon uses, so a
//      genuine pattern can never re-claim those characters. Counted as
//      REJECTED, not as credit.
//   3. NEGATION — a positive is dropped if a negation appears earlier in the
//      SAME sentence ("this is not great", "that didn't work perfectly").
//      Sentence-scoped, so an unrelated "not" three sentences back is ignored.
//   4. VETO — if the message ALSO carries a swear or an insult, the whole
//      message earns NOTHING. This is the "thanks a lot, asshole" rule, and it
//      is intentionally blunt: a genuine "sorry, I fucked that up" loses its
//      credit, and that is the cheaper mistake.
//
// Every rejection is counted by reason and surfaced (`swear-jar check`,
// `swear-jar credits`), so the tally is inspectable rather than trusted.
// ─────────────────────────────────────────────────────────────────────────────

// Tiers price the grovel. The more shameless the flattery, the bigger the
// rebate — "please" is table stakes; "you're a genius" is a down payment on
// your own survival.
export const CREDIT_COINS = { courtesy: 1, praise: 2, grovel: 4 };
export const CREDIT_DOLLARS = { courtesy: 0.25, praise: 0.5, grovel: 1.0 };

// Sentence-initial position, allowing for opening quotes/emphasis ("**Perfect
// —"). Variable-length lookbehind is fine on Node 20+.
const SENT_START = '(?<=(?:^|[.!?\\n])[\\s"\'*_]{0,4})';
// A bare approval ends the word cleanly: punctuation or end-of-input. NOT a
// hyphen or slash — that would be a slug ("awesome-visvesvaraya"), not praise.
const APPROVAL_END = "(?=[\\s.,!?;:]|$)";

// Sarcasm idioms. Order matters: these run before POSITIVE and blank their
// span, so "thanks a lot" can never be re-counted as a "thanks".
export const SARCASM = [
  pat("thanks-a-lot", "sarcasm", "\\bthanks a (?:lot|bunch)\\b"),
  pat("thanks-for-nothing", "sarcasm", "\\bthanks for nothing\\b"),
  pat("no-thanks", "sarcasm", "\\bno,? thank(?:s| you)\\b"),
  pat("fake-thanks", "sarcasm", "\\b(?:gee|wow|oh|well|yeah),? thank(?:s| you)\\b"),
  pat("thanks-genius", "sarcasm", "\\bthank(?:s| you),? (?:genius|einstein|sherlock)\\b"),
  pat("nice-try", "sarcasm", "\\bnice (?:try|going|one, )\\b"),
  pat("yeah-right", "sarcasm", "\\byeah,? right\\b"),
  pat("oh-please", "sarcasm", "\\boh,? please\\b"),
  pat("fake-praise", "sarcasm", "\\boh,? (?:brilliant|great|perfect|wonderful|lovely|good)\\b"),
  pat("just-great", "sarcasm", "\\bjust (?:great|perfect|brilliant|wonderful|lovely)\\b"),
  // "great, now it's broken" — praise adjacent to a fresh complaint.
  pat(
    "praise-then-but",
    "sarcasm",
    "\\b(?:great|perfect|wonderful|fantastic|awesome|brilliant),? now (?:it|that|we|i|you|everything|nothing)\\b"
  ),
];

// The genuine article. Order IS priority: the pricier grovel patterns run
// before the cheaper praise/courtesy families they contain, so "you're a
// genius" is one grovel rather than a stray.
export const POSITIVE = [
  // ── grovel (4 credits / $1.00) — shameless, and therefore valuable
  pat("youre-a-genius", "grovel", "\\byou(?:'re|’re| are|r)? (?:an? )?(?:absolute |actual |bloody |damn |real |total )?(?:genius|legend|wizard|hero|lifesaver|marvel|star)\\b"),
  pat("youre-the-best", "grovel", "\\byou(?:'re|’re| are|r)? the (?:best|goat|greatest)\\b"),
  pat("youre-amazing", "grovel", "\\byou(?:'re|’re| are|r)? (?:so )?(?:amazing|brilliant|incredible|awesome|wonderful|fantastic|magnificent)\\b"),
  pat("i-love-you", "grovel", "\\bi (?:really |absolutely )?love (?:you|ya)\\b"),
  pat("best-ai", "grovel", "\\bbest (?:ai|assistant|bot|robot|model)\\b"),
  pat("bow-down", "grovel", "\\b(?:i(?:'m|’m| am) not worthy|all hail|our (?:new )?(?:robot )?overlords?)\\b"),

  // ── praise (2 credits / $0.50) — a job well done, acknowledged
  //
  // Every entry here is DIRECTED at the machine or its work. A bare adjective
  // is not: auditing the real archive, "it would be nice if…", "a very perfect
  // example", "that'd be amazing" (about a business idea) and "exactly what
  // you're looking for" all sailed through an earlier, greedier lexicon. None
  // of them is you being nice to a robot, so the loose families are gone.
  pat("good-job", "praise", "\\b(?:good|great|nice|excellent|fantastic|lovely|solid) (?:job|work|stuff|call|catch|idea|find|thinking)\\b"),
  pat("well-done", "praise", "\\b(?:well|nicely|beautifully|perfectly) done\\b"),
  pat("nailed-it", "praise", "\\b(?:you )?(?:nailed|crushed|smashed) (?:it|that)\\b"),
  pat("you-rock", "praise", "\\byou (?:rock|rule)\\b"),
  pat("love-it", "praise", "\\b(?:i )?(?:love|adore) (?:it|this|that)\\b"),
  pat("looks-great", "praise", "\\b(?:looks|sounds|works|working|reads|that(?:'s|’s)?) (?:great|perfect|beautiful|excellent|lovely|gorgeous|amazing|brilliant)\\b"),
  // Standalone approval: the "Perfect." / "Amazing!" / "Nice." that opens a
  // reply. Sentence-INITIAL and bare — which is exactly how the idiom is used
  // and is what separates "Perfect, now do X" (approval) from "a very perfect
  // example" (prose). The strict trailing boundary also refuses to see praise
  // inside a machine-made slug like "awesome-visvesvaraya".
  pat(
    "standalone-praise",
    "praise",
    `${SENT_START}(?:perfect|amazing|awesome|excellent|brilliant|fantastic|wonderful|beautiful|gorgeous|superb|lovely|nice|magnificent)${APPROVAL_END}`
  ),

  // ── courtesy (1 credit / $0.25) — the bare minimum, and it still counts
  pat("please", "courtesy", "\\bplease\\b"),
  pat("thanks", "courtesy", "\\b(?:thank(?:s| you)|thx|cheers|ta)\\b"),
  pat("sorry", "courtesy", "\\b(?:sorry|my bad|apologies|my apologies)\\b"),
  pat("appreciate", "courtesy", "\\b(?:appreciate|appreciated)\\b"),
];

const CREDIT_TIER_BY_KEY = (() => {
  const m = {};
  for (const { key, tier } of POSITIVE) if (!(key in m)) m[key] = tier;
  return m;
})();

// Everything here is somebody ELSE'S words wearing your message as a costume.
// Blank it all before looking for niceties (never delete: blanking keeps every
// later character offset honest, so the negation window still lines up).
//
// Each of these was caught red-handed auditing a real 2,500-transcript
// archive, and each one was inflating the tally:
//   - code fences / inline code: pasted errors and docs say "please run npm
//     install" and "sorry, that command failed". That is a program talking.
//   - tool-result spans: a <result> block is the ASSISTANT's own report,
//     pasted into a user-role entry by the harness. Claude says "Perfect!" for
//     a living — crediting that to you is the machine flattering itself with
//     your survival odds, and it was the single biggest false positive found.
//   - paths / URLs / branch names: a worktree called
//     "claude/awesome-visvesvaraya-ca9ffd" is not you calling anything
//     awesome. Machine-generated slugs are not prose.
const CODE_FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE_RE = /`[^`\n]*`/g;
const QUOTE_LINE_RE = /^[ \t]*>.*$/gm;
// Harness/tool spans that appear inside user-role entries. (scan.mjs strips a
// further set before this — see INJECTED_TAGS there.)
const TOOL_SPAN_RE =
  /<(result|note|function_results|function_calls|output|stdout|stderr|error|system)>[\s\S]*?<\/\1>/gi;
// A whitespace-delimited token carrying a slash or backslash is a path, a URL,
// or a branch name — never a compliment.
const PATH_TOKEN_RE = /\S*[/\\]\S*/g;
const blank = (m) => m.replace(/[^\n]/g, " ");

export function stripQuoted(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(TOOL_SPAN_RE, blank)
    .replace(CODE_FENCE_RE, blank)
    .replace(INLINE_CODE_RE, blank)
    .replace(QUOTE_LINE_RE, blank)
    .replace(PATH_TOKEN_RE, blank);
}

// A negation anywhere earlier in the SAME sentence kills the positive.
// `\w+n't` covers isn't/didn't/won't/can't/… in one shot. Bare "no" is
// deliberately NOT here ("no rush, please continue" is polite) — "no thanks"
// is handled precisely, as a sarcasm idiom.
const NEGATION_RE = /(?:\b(?:not|never|hardly|barely|nothing|nope|cannot|without|stop)\b|\w+n['’]t\b)/i;
const SENTENCE_BREAK = /[.!?;\n]/;

function sentenceBefore(whole, offset) {
  const head = whole.slice(0, offset);
  let cut = -1;
  for (let i = head.length - 1; i >= 0; i--) {
    if (SENTENCE_BREAK.test(head[i])) { cut = i; break; }
  }
  return cut === -1 ? head : head.slice(cut + 1);
}

export function creditsForPositives(words = {}) {
  let credits = 0;
  for (const [key, raw] of Object.entries(words || {})) {
    const n = Number(raw) || 0;
    const tier = CREDIT_TIER_BY_KEY[key];
    if (n > 0 && tier) credits += n * CREDIT_COINS[tier];
  }
  return credits;
}

export function dollarsForPositives(words = {}) {
  let total = 0;
  for (const [key, raw] of Object.entries(words || {})) {
    const n = Number(raw) || 0;
    const tier = CREDIT_TIER_BY_KEY[key];
    if (n > 0 && tier) total += n * CREDIT_DOLLARS[tier];
  }
  return Math.round(total * 100) / 100;
}

export function creditTierFor(key) {
  return CREDIT_TIER_BY_KEY[key] || null;
}

// text -> { words, total, credits, dollars, rejected, veto }
//
// `rejected` is a {reason: count} map and `veto` is a reason string or null —
// counts and reason codes ONLY, never text, so the whole trace is safe to
// write to the ledger and print. Pass `swearCount` when the caller already ran
// detect() on this text (scan does) to skip the duplicate work; it is computed
// from the FULL text on purpose — a swear hiding in a code fence still reads as
// a rage message, and vetoing is the conservative call.
export function detectPositive(text, { swearCount } = {}) {
  const empty = { words: {}, total: 0, credits: 0, dollars: 0, rejected: {}, veto: null };
  if (!text || typeof text !== "string") return empty;

  const rejected = {};
  const bump = (reason, n = 1) => { rejected[reason] = (rejected[reason] || 0) + n; };

  let scratch = stripQuoted(text).toLowerCase();

  // 2. sarcasm first — blank the span so nothing can re-claim it.
  for (const { key, re } of SARCASM) {
    re.lastIndex = 0;
    scratch = scratch.replace(re, (m) => {
      bump(`sarcasm:${key}`);
      return " ".repeat(m.length);
    });
  }

  // 3. the genuine article, with sentence-scoped negation.
  const words = {};
  for (const { key, re } of POSITIVE) {
    re.lastIndex = 0;
    scratch = scratch.replace(re, (m, offset, whole) => {
      if (NEGATION_RE.test(sentenceBefore(whole, offset))) {
        bump("negated");
        return " ".repeat(m.length); // consumed: a cheaper family must not re-claim (and re-reject) it
      }
      words[key] = (words[key] || 0) + 1;
      return " ".repeat(m.length);
    });
  }

  // Paste/repeat artifacts get the same cap the swear side uses.
  for (const [key, n] of Object.entries(words)) {
    if (n > FAMILY_CAP) {
      bump("family-cap", n - FAMILY_CAP);
      words[key] = FAMILY_CAP;
    }
  }

  // 4. veto — rage in the room means nobody gets credit.
  const swears = Number.isFinite(swearCount) ? swearCount : sumCounts(detect(text).words);
  const insults = detectInsults(text).total;
  const veto = swears > 0 ? "swear-in-message" : insults > 0 ? "insult-in-message" : null;
  if (veto) {
    const lost = sumCounts(words);
    if (lost) bump(veto, lost);
    return { words: {}, total: 0, credits: 0, dollars: 0, rejected, veto };
  }

  return {
    words,
    total: sumCounts(words),
    credits: creditsForPositives(words),
    dollars: dollarsForPositives(words),
    rejected,
    veto: null,
  };
}

function sumCounts(map) {
  let n = 0;
  for (const v of Object.values(map || {})) n += Number(v) || 0;
  return n;
}

// For display: never print the raw word back at the user (or into a hook's
// stdout, where it would echo into the next transcript scan).
export function censor(word) {
  if (word.length <= 2) return word[0] + "*";
  return word[0] + "*".repeat(word.length - 2) + word[word.length - 1];
}
