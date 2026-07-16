import test from "node:test";
import assert from "node:assert/strict";
import { renderStatus, goldStarStatus } from "../src/render.mjs";

const NOW = Date.parse("2026-07-09T12:00:00Z");

test("goldStarStatus compares polite instances vs swear instances", () => {
  const mannered = [
    { source: "user", ts: "2026-07-08T09:00:00Z", words: { damn: 1 }, coins: 1, polite: { please: 2, thanks: 1 } },
  ];
  const gs = goldStarStatus(mannered);
  assert.deepEqual(gs, { polite: 3, swears: 1, goldStar: true });
  // legacy records (no polite field) never crash and are never a star
  assert.equal(goldStarStatus([{ source: "user", words: { fuck: 1 }, coins: 3 }]).goldStar, false);
  assert.equal(goldStarStatus([]).goldStar, false);
});

test("renderStatus prints the gold-star line + manners mention only when earned", () => {
  const mannered = [
    { source: "user", ts: "2026-07-08T09:00:00Z", words: { damn: 1 }, coins: 1, polite: { please: 2, thanks: 1 } },
  ];
  const on = renderStatus(mannered, NOW);
  assert.match(on, /GOLD STAR/);
  assert.match(on, /noted your manners/);

  const off = renderStatus(
    [{ source: "user", ts: "2026-07-08T09:00:00Z", words: { fuck: 2 }, coins: 6 }],
    NOW
  );
  assert.ok(!/GOLD STAR/.test(off), "no gold-star line for a swearing ledger");
  assert.ok(!/noted your manners/.test(off), "no manners mention when not a star");
});
