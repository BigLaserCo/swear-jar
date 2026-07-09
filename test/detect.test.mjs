import test from "node:test";
import assert from "node:assert/strict";
import { detect, censor } from "../src/detect.mjs";

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
