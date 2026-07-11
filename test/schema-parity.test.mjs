import test from "node:test";
import assert from "node:assert/strict";
import { AGENTS as FUNNEL_AGENTS, CAPS as FUNNEL_CAPS } from "../funnel/schema.mjs";
import { AGENTS as BOARD_AGENTS, CAPS as BOARD_CAPS } from "../scripts/leaderboard/schema.mjs";

// The hosted funnel is the submission intake; the leaderboard core renders the
// funnel's confirmed rows. If their contracts drift, a row the funnel accepts
// could be rejected by the board renderer (or vice-versa). These guard against
// that — the two schemas MUST agree on the agent enum and shared field caps.

test("funnel and leaderboard schemas share the same agent enum", () => {
  assert.deepEqual([...FUNNEL_AGENTS].sort(), [...BOARD_AGENTS].sort());
});

test("the canonical agent enum is exactly the expected set", () => {
  assert.deepEqual([...FUNNEL_AGENTS].sort(), ["both", "claude", "codex", "dictation", "other"]);
});

test("shared numeric field caps agree across both schemas", () => {
  for (const k of ["total_coins", "dollars", "swears_per_day", "fbomb_pct", "active_days"]) {
    assert.equal(FUNNEL_CAPS[k], BOARD_CAPS[k], `cap mismatch on ${k}`);
  }
});
