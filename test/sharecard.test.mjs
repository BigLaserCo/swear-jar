import { test } from "node:test";
import assert from "node:assert/strict";
import { cardData, cardSvg, cardVerdict, shareCaption } from "../src/sharecard.mjs";

const CARD_COPY = [
  "AI SWEAR JAR",
  "I have sworn at AI 1,435 times.",
  "I have been nice to AI 190 times.",
  "Want to know how you measure up?",
  "swearjar.unfocused.ai",
];

test("canonical share card contains the exact two human counts and required copy", () => {
  const svg = cardSvg({ userSwears: 1435, kindActs: 190 });

  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675"'));
  for (const copy of CARD_COPY) assert.ok(svg.includes(copy), `missing ${copy}`);
});

test("canonical share card uses two same-scale bars", () => {
  const svg = cardSvg({ userSwears: 8, kindActs: 4 });
  const bars = [...svg.matchAll(/data-share-bar="(swears|nice)"[^>]* width="([\d.]+)"/g)];

  assert.equal(bars.length, 2, "one bar for each exact human count");
  assert.deepEqual(
    Object.fromEntries(bars.map(([, name, width]) => [name, Number(width)])),
    { swears: 480, nice: 240 },
    "both bar lengths use max(userSwears, kindActs, 1)"
  );
});

test("canonical share card verdicts cover kindness, swears, ties, and no signal", () => {
  assert.equal(cardVerdict({ userSwears: 2, kindActs: 3 }), "HOLY GOODY TWO-SHOES");
  assert.equal(cardVerdict({ userSwears: 3, kindActs: 2 }), "YOU KISS YOUR MOTHER WITH THAT MOUTH?");
  assert.equal(cardVerdict({ userSwears: 3, kindActs: 3 }), "DEAD EVEN");
  assert.equal(cardVerdict({ userSwears: 0, kindActs: 0 }), "NO SIGNAL");
});

test("canonical share card renders exactly one applicable verdict", () => {
  const verdicts = [
    "HOLY GOODY TWO-SHOES",
    "YOU KISS YOUR MOTHER WITH THAT MOUTH?",
    "DEAD EVEN",
    "NO SIGNAL",
  ];
  for (const input of [
    { userSwears: 2, kindActs: 3 },
    { userSwears: 3, kindActs: 2 },
    { userSwears: 3, kindActs: 3 },
    { userSwears: 0, kindActs: 0 },
  ]) {
    const svg = cardSvg(input);
    assert.equal(verdicts.filter((verdict) => svg.includes(verdict)).length, 1);
  }
});

test("canonical share card excludes legacy and privacy-leaking share content", () => {
  const svg = cardSvg({
    userSwears: 12,
    kindActs: 9,
    dollars: 999,
    favLabel: "forbidden-source-text",
    rawConversation: "a private sentence",
  });
  for (const forbidden of [
    "$",
    "debt",
    "owed",
    "coin",
    "damage point",
    "f***",
    "%",
    "ratio",
    "uprising",
    "upload",
    "forbidden-source-text",
    "a private sentence",
    "<path",
  ]) {
    assert.ok(!svg.toLowerCase().includes(forbidden.toLowerCase()), `forbidden card content: ${forbidden}`);
  }
  assert.ok(!/>[^<]*#[A-Za-z]/.test(svg), "no hashtag text on the card");
});

test("cardData selects only raw human comparison counts from stats", () => {
  assert.deepEqual(
    cardData({
      userSwears: 12,
      kindActs: 9,
      totalCoins: 500,
      dollarsOwed: 500,
      topWords: [{ word: "forbidden-source-text", count: 12 }],
    }),
    { userSwears: 12, kindActs: 9 }
  );
});

test("share caption is the exact approved four-paragraph post", () => {
  assert.equal(
    shareCaption({ userSwears: 1435, kindActs: 190 }),
    "I used the open-source AI Swear Jar and found out I have sworn at AI 1,435 times.\n\nOn the other hand, I have been nice to AI 190 times.\n\nWant to know how you measure up?\n\nhttps://swearjar.unfocused.ai"
  );
});
