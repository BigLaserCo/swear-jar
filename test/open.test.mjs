import test from "node:test";
import assert from "node:assert/strict";
import { openCommandFor, shouldAutoOpen } from "../src/open.mjs";

// Decision logic only — openInBrowser spawns a real OS opener, so tests never
// call it (a green suite must not pop a browser). The gate + command selection
// are the contracts; the spawn itself is a fire-and-forget courtesy.

test("openCommandFor picks the platform's opener", () => {
  assert.equal(openCommandFor("darwin"), "open");
  assert.equal(openCommandFor("win32"), "start");
  assert.equal(openCommandFor("linux"), "xdg-open");
  assert.equal(openCommandFor("freebsd"), "xdg-open"); // anything else → xdg-open
});

test("shouldAutoOpen: a real TTY with no opt-out opens", () => {
  assert.equal(shouldAutoOpen({ isTTY: true, noOpen: false, env: {} }), true);
});

test("shouldAutoOpen: non-TTY never opens (Claude skill runs, CI, pipes)", () => {
  assert.equal(shouldAutoOpen({ isTTY: false, env: {} }), false);
  assert.equal(shouldAutoOpen({ isTTY: undefined, env: {} }), false); // PassThrough streams
});

test("shouldAutoOpen: --no-open beats a TTY", () => {
  assert.equal(shouldAutoOpen({ isTTY: true, noOpen: true, env: {} }), false);
});

test("shouldAutoOpen: SWEAR_JAR_NO_OPEN=1 beats a TTY", () => {
  assert.equal(shouldAutoOpen({ isTTY: true, env: { SWEAR_JAR_NO_OPEN: "1" } }), false);
});
