import test from "node:test";
import assert from "node:assert/strict";
import {
  detect,
  censor,
  detectInsults,
  detectPolite,
  LEXICON,
} from "../src/detect.mjs";

test("counts basic swears with tiered coins", () => {
  const r = detect("well damn, this shit is fucked");
  assert.equal(r.words.damn, 1);
  assert.equal(r.words.shit, 1);
  assert.equal(r.words.fuck, 1);
  assert.equal(r.coins, 1 + 2 + 3);
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

test("polite words are counted separately and never as swears", () => {
  assert.equal(detectPolite("please and thank you and sorry").total, 3);
  assert.equal(detect("please and thank you").coins, 0);
  assert.equal(detectPolite("i really appreciate it").total, 1);
});

test("insult and polite detectors are safe on empty/non-string input", () => {
  assert.equal(detectInsults("").total, 0);
  assert.equal(detectInsults(null).total, 0);
  assert.equal(detectPolite(undefined).total, 0);
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
