import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The rebuild rewrites the ledger, so every test here runs against a throwaway
// SWEAR_JAR_HOME and a fixture transcript root — never the real jar.
function freshHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "swear-rebuild-"));
  process.env.SWEAR_JAR_HOME = home;
  return home;
}

function transcriptRoot(messages) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "swear-rebuild-tx-"));
  const dir = path.join(root, "project-a");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "session.jsonl"),
    messages
      .map((m, i) =>
        JSON.stringify({
          type: "user",
          uuid: `r${i}`,
          timestamp: "2026-07-08T09:0" + i + ":00.000Z",
          sessionId: "s",
          cwd: "/tmp/project-a",
          message: { role: "user", content: m },
        })
      )
      .join("\n") + "\n"
  );
  return root;
}

const { rebuildLedger, isIrreplaceable } = await import("../src/rebuild.mjs");
const { loadRecords, appendRecords, verifyLedger } = await import("../src/ledger.mjs");

test("rebuild re-derives credits that uuid dedup had frozen out of an old ledger", async () => {
  const home = freshHome();
  const root = transcriptRoot(["thank you. perfect.", "this is fucked"]);

  // Simulate a ledger filled BEFORE credits existed: the swear is recorded,
  // the thank-you was never even seen as a positive.
  appendRecords([
    {
      v: 1,
      uuid: "r1",
      ts: "2026-07-08T09:01:00.000Z",
      source: "user",
      agent: "claude",
      event: "backfill",
      project: "project-a",
      words: { fuck: 1 },
      coins: 3,
      dollars: 1,
    },
  ]);
  assert.equal(loadRecords().length, 1);
  assert.ok(!loadRecords().some((r) => r.polite), "precondition: no credits in the old ledger");

  const r = rebuildLedger({ root, codex: false });
  const after = loadRecords();

  const nice = after.find((x) => x.uuid === "r0");
  assert.ok(nice, "the previously-unscanned nice message is now a record");
  assert.deepEqual(nice.polite, { thanks: 1, "standalone-praise": 1 }, "and it carries credits");
  // The swear is still exactly one swear — a rebuild must never double-charge.
  const swears = after.filter((x) => x.words?.fuck);
  assert.equal(swears.length, 1, "rebuild does not double-count the swear");
  assert.equal(r.before, 1);
  assert.ok(r.after >= 2);

  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test("rebuild archives the old ledger before touching anything", async () => {
  const home = freshHome();
  const root = transcriptRoot(["thanks"]);
  appendRecords([
    { v: 1, uuid: "old", ts: "2026-07-08T09:00:00.000Z", source: "user", agent: "claude", event: "backfill", words: { shit: 1 }, coins: 2 },
  ]);
  const r = rebuildLedger({ root, codex: false });
  assert.ok(fs.existsSync(r.backup), "the backup file exists");
  const archived = fs.readFileSync(r.backup, "utf8");
  assert.ok(archived.includes('"uuid":"old"'), "and it holds the pre-rebuild jar");
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test("rebuild carries across confessions, which no transcript can re-derive", async () => {
  const home = freshHome();
  const root = transcriptRoot(["thanks"]);
  appendRecords([
    { v: 1, uuid: "confession-1", ts: "2026-07-08T09:00:00.000Z", source: "user", agent: "human", event: "confession", words: { confessed: 4 }, coins: 4 },
    { v: 1, uuid: "derived", ts: "2026-07-08T09:00:00.000Z", source: "user", agent: "claude", event: "backfill", words: { shit: 1 }, coins: 2 },
  ]);
  const r = rebuildLedger({ root, codex: false });
  const after = loadRecords();
  assert.equal(r.kept, 1);
  assert.ok(after.some((x) => x.uuid === "confession-1"), "the confession survives");
  assert.ok(!after.some((x) => x.uuid === "derived"), "the stale derived record does not");
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test("the rebuilt ledger's hash chain verifies intact", async () => {
  const home = freshHome();
  const root = transcriptRoot(["thank you", "damn it"]);
  appendRecords([
    { v: 1, uuid: "confession-1", ts: "2026-07-08T09:00:00.000Z", source: "user", agent: "human", event: "confession", words: { confessed: 1 }, coins: 1 },
  ]);
  rebuildLedger({ root, codex: false });
  const v = verifyLedger(loadRecords());
  assert.equal(v.intact, true, "re-chaining from genesis leaves no break");
  assert.equal(v.legacy, 0, "and no unchained records");
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

test("isIrreplaceable keeps confessions and drops derived records", () => {
  assert.equal(isIrreplaceable({ event: "confession" }), true);
  assert.equal(isIrreplaceable({ agent: "human" }), true);
  assert.equal(isIrreplaceable({ agent: "claude", event: "backfill" }), false);
  assert.equal(isIrreplaceable({ agent: "codex", event: "codex-rollout" }), false);
  assert.equal(isIrreplaceable(null), false);
});
