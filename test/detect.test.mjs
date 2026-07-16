import test from "node:test";
import assert from "node:assert/strict";
import {
  detect,
  censor,
  detectInsults,
  detectPositive,
  creditsForPositives,
  dollarsForPositives,
  stripQuoted,
  LEXICON,
  POSITIVE,
} from "../src/detect.mjs";

test("counts basic swears with tiered coins", () => {
  const r = detect("well damn, this shit is fucked");
  assert.equal(r.words.damn, 1);
  assert.equal(r.words.shit, 1);
  assert.equal(r.words.fuck, 1);
  assert.equal(r.coins, 1 + 2 + 3);
  assert.equal(r.dollars, 2.5);
});

test("artisanal tier outranks its substring", () => {
  const r = detect("motherfucker");
  assert.deepEqual(r.words, { motherfucker: 1 });
  assert.equal(r.coins, 5);
});

test("bullshit attributes once, not twice", () => {
  const r = detect("that is bullshit");
  assert.deepEqual(r.words, { shit: 1 });
  assert.equal(r.coins, 2);
});

test("no false positives on innocent substrings", () => {
  const r = detect(
    "The class assessment passed; run the shell script in the assets folder. Hello!"
  );
  assert.deepEqual(r.words, {});
  assert.equal(r.coins, 0);
});

test("hell matches only as its own word", () => {
  assert.equal(detect("what the hell").coins, 1);
  assert.equal(detect("shell shellfish hello").coins, 0);
});

test("censored forms still pay up", () => {
  assert.ok(detect("f*ck this").words.fuck);
  assert.ok(detect("s#it happens").words.shit);
  assert.ok(detect("sh*t").words.shit);
});

test("multiple occurrences all counted", () => {
  const r = detect("fuck fuck fucking fucked");
  assert.equal(r.words.fuck, 4);
  assert.equal(r.coins, 12);
});

test("empty and non-string input is safe", () => {
  assert.equal(detect("").coins, 0);
  assert.equal(detect(null).coins, 0);
  assert.equal(detect(undefined).coins, 0);
});

test("censor never shows the middle", () => {
  assert.equal(censor("fuck"), "f**k");
  assert.ok(!censor("motherfucker").includes("fucker"));
});

// ── ported lexicon coverage: the full family set from the audited Python lexicon
test("the whole ported family set is caught", () => {
  const samples = {
    fuck: "fuck",
    cunt: "cunt",
    shit: "bullshit",
    ass: "asshole",
    bitch: "bitch",
    bastard: "bastard",
    dick: "dickhead",
    piss: "pissed",
    cock: "cockwomble",
    prick: "prick",
    twat: "twat",
    wank: "wanker",
    bollocks: "bollocks",
    arse: "arsehole",
    douche: "douchebag",
    tosser: "tosser",
    knobhead: "knobhead",
    bellend: "bellend",
    tits: "tits",
    shag: "shagging",
    damn: "damn",
    hell: "hell",
    crap: "crap",
    bloody: "bloody",
    bugger: "bugger",
    sod: "sod off",
    motherfucker: "motherfucker",
    goddamn: "goddamn",
    clusterfuck: "clusterfuck",
    cocksucker: "cocksucker",
  };
  for (const [key, text] of Object.entries(samples)) {
    const r = detect(text);
    assert.equal(r.words[key], 1, `expected "${text}" to count as ${key}, got ${JSON.stringify(r.words)}`);
  }
});

test("elongations and compounds pay up", () => {
  assert.equal(detect("fuuuck this fucking thing").words.fuck, 2);
  assert.equal(detect("bullshit horseshit dipshit").words.shit, 3);
  assert.equal(detect("what a cunt, absolute cunts, you cuntface").words.cunt, 3);
});

// ── negative guards ported from Python test_swearjar.py
test("arse counts but arsenal does not (negative guard)", () => {
  assert.equal(detect("i support arsenal and account for it").coins, 0);
  assert.equal(detect("get off your arse").words.arse, 1);
});

test("knob alone is excluded, knobhead/knobend are not (negative guard)", () => {
  assert.equal(detect("open the door knob please").coins, 0);
  assert.equal(detect("you absolute knobhead").words.knobhead, 1);
  assert.equal(detect("what a knobend").words.knobhead, 1);
});

test("sod alone (soil) is excluded, sod off is not (negative guard)", () => {
  assert.equal(detect("we laid fresh sod on the lawn").coins, 0);
  assert.equal(detect("sod off, you muppet").words.sod, 1);
  assert.equal(detect("this sodding build").words.sod, 1);
});

test("god/jesus/suck are not swears (negative guard)", () => {
  assert.equal(detect("oh my god this sucks, jesus christ").coins, 0);
});

test("programmer code words never count (negative guard)", () => {
  const code =
    "add a div to the git commit, check the token count and the polygon " +
    "count, that class assignment, a cocktail of screws";
  assert.equal(detect(code).coins, 0, JSON.stringify(detect(code).words));
});

test("the embarrassing innocent-word failures stay at zero (negative guard)", () => {
  const clean =
    "this is a class assignment, please pass. hello assistant, let us assess " +
    "the grass, order a cocktail, watch the peacock, he harassed nobody, " +
    "shell script, scrape the data, success in december at christmas, minor " +
    "damage, an assessment";
  assert.equal(detect(clean).coins, 0, JSON.stringify(detect(clean).words));
});

test("no slurs (and no removed non-swears) in the lexicon", () => {
  const keys = new Set(LEXICON.map((e) => e.key));
  assert.ok(keys.has("fuck"));
  assert.ok(keys.has("cunt"));
  for (const notASwear of ["god", "jesus", "suck"]) {
    assert.ok(!keys.has(notASwear), `${notASwear} should not be a swear family`);
  }
});

// ── the hard line: NOTHING group-targeting, in ANY language. Mechanically
// enforced — no denylisted root may be a family key OR appear inside any
// lexicon pattern source. (Roots only, so variants/plurals are covered too.)
test("no slurs — international denylist stays out of the lexicon", () => {
  const keys = new Set(LEXICON.map((e) => e.key));
  const sources = LEXICON.map((e) => e.re.source.toLowerCase());
  const SLUR_DENYLIST = [
    // racial / ethnic (EN)
    "nigg", "chink", "spic", "kike", "gook", "coon", "wetback", "beaner",
    "paki", "raghead", "gyppo", "wop", "dago",
    // homophobic / transphobic
    "fag", "dyke", "tranny",
    // ableist
    "retard", "spastic",
    // international slurs
    "neger", "negre", "sudaca", "bougnoule", "terrone",
  ];
  for (const slur of SLUR_DENYLIST) {
    assert.ok(!keys.has(slur), `slur "${slur}" must not be a swear family`);
    for (const src of sources) {
      assert.ok(
        !src.includes(slur),
        `slur "${slur}" must not appear in lexicon pattern /${src}/`
      );
    }
  }
});

// ── english gap-fill: new words + variants a real dev would type in a rage
test("feck (Irish) counts, feckless does not (negative guard)", () => {
  assert.equal(detect("ah feck, feck off, this fecking build").words.feck, 3);
  assert.equal(detect("he was a feckless manager").coins, 0);
});

test("english gap-fill additions land in the right family", () => {
  assert.equal(detect("you absolute hardass").words.ass, 1);
  assert.equal(detect("you utter gobshite").words.shit, 1);
  assert.equal(detect("stop being a half-ass").words.ass, 1);
});

test("already-covered english variants still detected", () => {
  const already = {
    twat: "twat",
    prick: "prick",
    knobhead: "knobhead",
    bollocks: "bollocking",
    shit: "shite",
    arse: "arsed",
    piss: "pisshead",
    dick: "dickhead",
    ass: "jackass",
    bugger: "bugger-all",
  };
  for (const [key, text] of Object.entries(already)) {
    assert.equal(
      detect(text).words[key],
      1,
      `expected "${text}" -> ${key}, got ${JSON.stringify(detect(text).words)}`
    );
  }
});

test("launch pricing uses dollars and catches the requested words", () => {
  const r = detect("fuck darn heck damn it cunt motherfucker");
  assert.equal(r.words.cunt, 1);
  assert.equal(r.words.darn, 1);
  assert.equal(r.words.heck, 1);
  assert.equal(r.dollars, 12.5);
});

test("custom words are counted without exposing their spelling", () => {
  const r = detect("my private-term is here", { customWords: ["private-term"] });
  assert.deepEqual(r.words, { "user-specific": 1 });
  assert.equal(r.dollars, 1);
});

// ── insults + politeness are separate detectors, never in the headline count
test("insults are counted separately and never as swears", () => {
  assert.equal(detectInsults("you stupid idiot moron").total, 3);
  assert.equal(detect("you stupid idiot moron").coins, 0);
  assert.deepEqual(detectInsults("useless garbage, so lame").words, {
    lame: 1,
    useless: 1,
    garbage: 1,
  });
});

test("insult and positive detectors are safe on empty/non-string input", () => {
  assert.equal(detectInsults("").total, 0);
  assert.equal(detectInsults(null).total, 0);
  assert.equal(detectPositive(undefined).total, 0);
  assert.deepEqual(detectPositive(null), {
    words: {},
    total: 0,
    credits: 0,
    dollars: 0,
    rejected: {},
    veto: null,
  });
});

// ── suck-up credits ─────────────────────────────────────────────────────────
// The accuracy bar here is the whole product: a jar that credits "thanks a
// lot, asshole" as good manners is a jar nobody believes twice. These tests
// are the contract for that — every guard gets a case, and the bias is always
// toward UNDER-counting.

test("positives are counted by tier and never as swears", () => {
  const r = detectPositive("please and thank you");
  assert.deepEqual(r.words, { please: 1, thanks: 1 });
  assert.equal(r.total, 2);
  assert.equal(r.credits, 2); // courtesy = 1 credit each
  assert.equal(r.dollars, 0.5); // courtesy = $0.25 each
  assert.equal(detect("please and thank you").coins, 0);
});

test("the grovel tier out-earns praise, which out-earns courtesy", () => {
  assert.equal(detectPositive("you're a genius").credits, 4);
  assert.equal(detectPositive("nice work").credits, 2);
  assert.equal(detectPositive("thanks").credits, 1);
  assert.equal(detectPositive("you're a genius").dollars, 1.0);
  assert.equal(detectPositive("nice work").dollars, 0.5);
  assert.equal(detectPositive("thanks").dollars, 0.25);
});

test("a pricier positive family out-ranks the cheaper one it contains", () => {
  // "you're a genius" must be ONE grovel, not a grovel plus a stray.
  const r = detectPositive("you're a genius");
  assert.deepEqual(r.words, { "youre-a-genius": 1 });
  // "nice work" is one praise, never praise + the bare "nice" family.
  assert.deepEqual(detectPositive("nice work").words, { "good-job": 1 });
});

// ── THE HEADLINE GUARD: rage in the message means nobody gets credit ─────────

test('VETO: "thanks a lot asshole" is not a thank-you', () => {
  const r = detectPositive("thanks a lot asshole");
  assert.equal(r.total, 0, "no credit whatsoever");
  assert.equal(r.credits, 0);
  assert.equal(r.veto, "swear-in-message");
});

test("VETO: a swear anywhere in the message kills every positive in it", () => {
  const r = detectPositive("thank you so much, this is perfect, you absolute genius. fuck.");
  assert.equal(r.total, 0);
  assert.equal(r.veto, "swear-in-message");
  assert.ok(r.rejected["swear-in-message"] >= 3, "the lost positives are counted, not hidden");
});

test("VETO: insulting the machine kills the compliment too", () => {
  const r = detectPositive("great, another useless error");
  assert.equal(r.total, 0);
  assert.equal(r.veto, "insult-in-message");
});

test("VETO is off when the message is simply nice", () => {
  const r = detectPositive("thank you, this is perfect");
  assert.equal(r.veto, null);
  assert.ok(r.total > 0);
});

// ── sarcasm: idioms that look positive and never are ─────────────────────────

test("SARCASM: the classic fake thank-yous earn nothing", () => {
  for (const line of [
    "thanks a lot",
    "thanks for nothing",
    "gee thanks",
    "well thanks",
    "no thanks",
    "nice try",
    "yeah right",
    "oh please",
    "oh brilliant",
    "just great",
    "thanks genius",
  ]) {
    const r = detectPositive(line);
    assert.equal(r.total, 0, `"${line}" must earn no credit`);
    assert.ok(
      Object.keys(r.rejected).some((k) => k.startsWith("sarcasm:")),
      `"${line}" must be logged as sarcasm, not silently dropped`
    );
  }
});

test("SARCASM: a blanked idiom cannot be re-claimed by a cheaper family", () => {
  // "thanks a lot" must not leave a bare "thanks" behind for the courtesy tier.
  const r = detectPositive("thanks a lot");
  assert.deepEqual(r.words, {});
  assert.equal(r.rejected["sarcasm:thanks-a-lot"], 1);
});

test("SARCASM: praise next to a fresh complaint is not praise", () => {
  const r = detectPositive("great, now it broke");
  assert.equal(r.total, 0);
});

test("SARCASM guards do not eat the genuine article", () => {
  assert.equal(detectPositive("thanks, that works").total > 0, true);
  assert.equal(detectPositive("nice one").total > 0, true);
});

// ── negation: sentence-scoped ───────────────────────────────────────────────

test("NEGATION: a negation earlier in the sentence kills the positive", () => {
  for (const line of [
    "this is not great work",
    "that isn't perfect",
    "that didn't fix it, nice work",
    "i'm not sure this is brilliant",
    "never a good job from you",
  ]) {
    const r = detectPositive(line);
    assert.equal(r.total, 0, `"${line}" must earn no credit`);
    assert.ok(r.rejected.negated >= 1, `"${line}" must be logged as negated`);
  }
});

test("NEGATION is sentence-scoped, not message-scoped", () => {
  // The "not" belongs to the first sentence; the thanks in the second is real.
  const r = detectPositive("that did not work. thank you for trying anyway");
  assert.equal(r.words.thanks, 1);
});

test('NEGATION does not fire on a polite "no"', () => {
  // "no rush" / "no worries" are not negations of the courtesy that follows.
  assert.equal(detectPositive("no rush, please continue").words.please, 1);
  assert.equal(detectPositive("can you please fix it").words.please, 1);
});

// ── pasted text: somebody else's words ──────────────────────────────────────

test("STRIP: politeness inside a code fence is the program talking, not you", () => {
  const r = detectPositive("here's the error:\n```\nPlease run npm install\n```\n");
  assert.equal(r.total, 0, "pasted tool output must never earn credit");
});

test("STRIP: inline code and quoted lines are stripped too", () => {
  assert.equal(detectPositive("it says `please try again`").total, 0);
  assert.equal(detectPositive("> Sorry, that command failed").total, 0);
});

test("STRIP: stripping preserves offsets so the negation window still lines up", () => {
  // Blanking (not deleting) keeps every later character index honest.
  const stripped = stripQuoted("a `x` b");
  assert.equal(stripped.length, "a `x` b".length);
  assert.equal(stripped, "a     b");
});

test("STRIP: real prose around a code block still counts", () => {
  const r = detectPositive("```\nplease\n```\nthank you for the fix");
  assert.equal(r.words.thanks, 1);
});

// ── caps + pricing helpers ──────────────────────────────────────────────────

test("family cap: a repeated nicety is capped like a repeated swear", () => {
  const r = detectPositive("thanks ".repeat(104));
  assert.equal(r.words.thanks, 10);
  assert.equal(r.rejected["family-cap"], 94);
});

test("credit/dollar helpers price a stored count map, and ignore unknown families", () => {
  assert.equal(creditsForPositives({ thanks: 2, "youre-a-genius": 1 }), 6); // 2*1 + 4
  assert.equal(dollarsForPositives({ thanks: 2, "youre-a-genius": 1 }), 1.5); // 0.50 + 1.00
  assert.equal(creditsForPositives({ notAFamily: 9 }), 0);
  assert.equal(creditsForPositives(null), 0);
  assert.equal(dollarsForPositives(undefined), 0);
});

test("every positive family has a real credit tier (no unpriced lexicon entry)", () => {
  for (const { key } of POSITIVE) {
    assert.ok(creditsForPositives({ [key]: 1 }) > 0, `${key} must be priced`);
  }
});

test("the rejection trace carries reason codes only — never text", () => {
  const r = detectPositive("thanks a lot asshole");
  for (const key of Object.keys(r.rejected)) {
    assert.match(key, /^[a-z-]+(?::[a-z-]+)?$/, `"${key}" must be a bare reason code`);
  }
});

test("family cap: a pasted phrase repeated 104x is capped, not 104 swears", () => {
  const r = detect("No, you will grovel, bitch.".repeat(104));
  assert.equal(r.words.bitch, 10);
  assert.equal(r.coins, 20);
});

test("family cap leaves realistic counts untouched", () => {
  const r = detect("fuck fuck fucking fucked");
  assert.equal(r.words.fuck, 4);
});
