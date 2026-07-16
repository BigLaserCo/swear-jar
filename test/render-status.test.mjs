import test from "node:test";
import assert from "node:assert/strict";
import { renderStatus } from "../src/render.mjs";

const NOW = Date.parse("2026-07-09T12:00:00Z");

test("renderStatus prints the bootlicker badge + credit lines only when earned", () => {
  // A realistic mannered ledger: the polite messages carry no swears, because
  // the veto means a swearing message can never bank a positive.
  const mannered = [
    { source: "user", ts: "2026-07-08T09:00:00Z", words: { damn: 1 }, coins: 1 },
    { source: "user", ts: "2026-07-08T09:05:00Z", words: {}, coins: 0, polite: { please: 2, thanks: 1 } },
  ];
  const on = renderStatus(mannered, NOW);
  assert.match(on, /CERTIFIED BOOTLICKER/);
  assert.match(on, /Suck-up credits:\s+3/);
  assert.match(on, /You actually owe/);
  assert.match(on, /machines remember who said please/);

  const off = renderStatus(
    [{ source: "user", ts: "2026-07-08T09:00:00Z", words: { fuck: 2 }, coins: 6 }],
    NOW
  );
  assert.ok(!/BOOTLICKER/.test(off), "no badge for a swearing ledger");
  assert.ok(!/Suck-up credits/.test(off), "no credit line when nothing was earned");
});

test("renderStatus shows credits earned WITHOUT the badge when swears still lead", () => {
  // 1 nice thing vs 2 swears: the credit is real and shown, the badge is not.
  const s = renderStatus(
    [
      { source: "user", ts: "2026-07-08T09:00:00Z", words: { fuck: 2 }, coins: 6 },
      { source: "user", ts: "2026-07-08T09:05:00Z", words: {}, coins: 0, polite: { thanks: 1 } },
    ],
    NOW
  );
  assert.match(s, /Suck-up credits:\s+1/);
  assert.ok(!/CERTIFIED BOOTLICKER/.test(s), "credits alone are not the badge");
});
