import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/swear-jar.mjs", import.meta.url));

function seededHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swear-jar-cli-"));
  const rec = (uuid, coins, words, agent = "claude") => ({
    v: 1, uuid, ts: "2026-07-10T09:00:00.000Z", session: "s",
    source: "user", agent, event: "test", project: "example-app",
    cwd: "/Users/dev/Code/example-app", transcript: "", words, coins,
  });
  fs.writeFileSync(
    path.join(dir, "ledger.jsonl"),
    [rec("u1", 3, { fuck: 1 }), rec("u2", 2, { shit: 1 }, "codex")]
      .map((r) => JSON.stringify(r)).join("\n") + "\n"
  );
  return dir;
}

function run(home, args) {
  return execFileSync("node", [BIN, ...args], {
    env: { ...process.env, SWEAR_JAR_HOME: home, SWEAR_JAR_SUBMIT_URL: "https://example.test/submit" },
    encoding: "utf8",
  });
}

test("wrapped --submit builds a URL with censored top word + provenance, no raw text", () => {
  const home = seededHome();
  const out = run(home, ["wrapped", "--submit"]);
  const url = out.split("\n").find((l) => l.includes("https://example.test/submit"));
  assert.ok(url, "a submit URL is printed");
  const q = new URL(url.trim()).searchParams;
  assert.equal(q.get("total_coins"), "5");
  assert.equal(q.get("agent"), "other"); // mixed claude+codex
  assert.equal(q.get("top_word"), "f**k"); // censored, never the raw word
  assert.ok(!url.includes("fuck"), "no uncensored swear in the URL");
  assert.ok(q.get("app_version"), "carries app_version");
  assert.equal(q.get("release_hash")?.length >= 7, true);
});

test("verify-ledger reports intact on an untampered ledger, breaks on a hand-edit", () => {
  const home = seededHome();
  // seeded ledger has no hash chain (legacy) -> intact
  assert.match(run(home, ["verify-ledger"]), /intact/i);

  // append a real chained record, then tamper it
  run(home, ["confess", "--coins", "1"]);
  const lp = path.join(home, "ledger.jsonl");
  const lines = fs.readFileSync(lp, "utf8").trim().split("\n");
  const last = JSON.parse(lines.at(-1));
  last.coins = 999;
  lines[lines.length - 1] = JSON.stringify(last);
  fs.writeFileSync(lp, lines.join("\n") + "\n");
  assert.throws(() => run(home, ["verify-ledger"]), /./); // exits non-zero on break
});
