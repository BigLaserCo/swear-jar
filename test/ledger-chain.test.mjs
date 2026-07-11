import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { appendRecords, loadRecords, verifyLedger, ledgerPath } from "../src/ledger.mjs";

function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swear-jar-chain-"));
  process.env.SWEAR_JAR_HOME = dir;
  return dir;
}

function rec(uuid, coins = 1) {
  return {
    v: 1,
    uuid,
    ts: "2026-07-10T12:00:00.000Z",
    session: "s",
    source: "user",
    agent: "claude",
    event: "test",
    project: "example-app",
    cwd: "/Users/dev/Code/example-app",
    transcript: "",
    words: { damn: coins },
    coins,
  };
}

test("appended records are chained and verify intact", () => {
  freshHome();
  appendRecords([rec("u1"), rec("u2")]);
  appendRecords([rec("u3")]); // second batch must resume the chain
  const v = verifyLedger();
  assert.equal(v.intact, true);
  assert.equal(v.chained, 3);
  assert.equal(v.legacy, 0);
  assert.equal(v.brokenAt, null);
});

test("hand-editing a middle record breaks the chain at that index", () => {
  freshHome();
  appendRecords([rec("u1"), rec("u2"), rec("u3")]);
  const lines = fs.readFileSync(ledgerPath(), "utf8").trim().split("\n");
  const tampered = JSON.parse(lines[1]);
  tampered.coins = 999; // give yourself coins? the jar notices.
  lines[1] = JSON.stringify(tampered);
  fs.writeFileSync(ledgerPath(), lines.join("\n") + "\n");
  const v = verifyLedger();
  assert.equal(v.intact, false);
  assert.equal(v.brokenAt, 1);
});

test("deleting a record breaks the chain", () => {
  freshHome();
  appendRecords([rec("u1"), rec("u2"), rec("u3")]);
  const lines = fs.readFileSync(ledgerPath(), "utf8").trim().split("\n");
  lines.splice(1, 1);
  fs.writeFileSync(ledgerPath(), lines.join("\n") + "\n");
  assert.equal(verifyLedger().intact, false);
});

test("legacy pre-chain records stay valid; new appends chain after them", () => {
  freshHome();
  // simulate a ledger written before the chain existed (no h fields)
  fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
  fs.writeFileSync(
    ledgerPath(),
    JSON.stringify(rec("old1")) + "\n" + JSON.stringify(rec("old2")) + "\n"
  );
  appendRecords([rec("new1")]);
  const v = verifyLedger();
  assert.equal(v.intact, true);
  assert.equal(v.legacy, 2);
  assert.equal(v.chained, 1);
});

test("a legacy (h-less) record injected AFTER the chain started is flagged", () => {
  freshHome();
  appendRecords([rec("u1")]);
  fs.appendFileSync(ledgerPath(), JSON.stringify(rec("sneaky")) + "\n");
  const v = verifyLedger();
  assert.equal(v.intact, false);
  assert.equal(v.brokenAt, 1);
});

test("chain fields do not disturb existing consumers", () => {
  freshHome();
  appendRecords([rec("u1", 3)]);
  const r = loadRecords()[0];
  assert.equal(r.coins, 3);
  assert.equal(typeof r.h, "string");
  assert.equal(r.h.length, 64);
});
