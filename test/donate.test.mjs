import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { DONATE_URL, tipLine } from "../src/donate.mjs";

test("DONATE_URL defaults to the hosted tip page", () => {
  // The default is the indirection page — never a payment provider directly.
  assert.match(DONATE_URL, /^https:\/\/.+\/tip\.html$/);
});

test("tipLine carries DONATE_URL — the single source of truth", () => {
  assert.ok(tipLine().includes(DONATE_URL), "the tip line points at DONATE_URL");
  assert.match(tipLine(), /^🫙 /, "speaks in the jar's voice");
  assert.equal(tipLine().split("\n").length, 1, "exactly one line");
});

test("SWEAR_JAR_DONATE_URL overrides DONATE_URL (subprocess — env reads at import)", () => {
  const modUrl = new URL("../src/donate.mjs", import.meta.url).href;
  const out = execFileSync(
    process.execPath,
    ["--input-type=module", "-e", `const m = await import(${JSON.stringify(modUrl)}); console.log(m.DONATE_URL);`],
    { encoding: "utf8", env: { ...process.env, SWEAR_JAR_DONATE_URL: "https://example.test/tip" } }
  );
  assert.equal(out.trim(), "https://example.test/tip");
});
