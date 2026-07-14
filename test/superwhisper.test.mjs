import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  importSuperwhisper,
  defaultSuperwhisperRoot,
  loadDictationRecords,
  dictationPath,
} from "../src/superwhisper.mjs";
import { ledgerPath, loadRecords } from "../src/ledger.mjs";

// All fixtures below are SYNTHETIC — hand-authored Superwhisper meta.json files
// with fake, invented content. No real user recording or transcript is read.

function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swear-jar-sw-home-"));
  process.env.SWEAR_JAR_HOME = dir;
  return dir;
}

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "superwhisper-recordings-"));
}

// Write a synthetic recording: <root>/<recording-id>/meta.json
function writeRecording(root, recordingId, meta) {
  const dir = path.join(root, recordingId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta));
  return dir;
}

test("counts swears per recording via the ported lexicon", () => {
  freshHome();
  const root = makeRoot();
  writeRecording(root, "1777587458", {
    datetime: "2026-05-01T09:00:00.000Z",
    result: "why the fuck did you break the goddamn build again",
  });
  const res = importSuperwhisper(root);
  assert.equal(res.files, 1);
  assert.equal(res.added, 1);
  // goddamn = artisanal(5) + fuck = premium(3) = 8 coins
  assert.equal(res.coins, 8);
  assert.equal(res.dollars, 6);

  const recs = loadDictationRecords();
  assert.equal(recs.length, 1);
  const r = recs[0];
  assert.equal(r.agent, "superwhisper");
  assert.equal(r.source, "user");
  assert.equal(r.event, "dictation");
  assert.equal(r.uuid, "sw:1777587458");
  assert.equal(r.ts, "2026-05-01T09:00:00.000Z");
  assert.equal(r.words.fuck, 1);
  assert.equal(r.words.goddamn, 1);
  assert.equal(r.coins, 8);
  fs.rmSync(root, { recursive: true, force: true });
});

test("tier coin values match the lexicon (mild/standard/premium/artisanal)", () => {
  freshHome();
  const root = makeRoot();
  writeRecording(root, "100", { result: "damn" }); // mild = 1
  writeRecording(root, "200", { result: "shit" }); // standard = 2
  writeRecording(root, "300", { result: "fuck" }); // premium = 3
  writeRecording(root, "400", { result: "motherfucker" }); // artisanal = 5

  const res = importSuperwhisper(root);
  assert.equal(res.files, 4);
  assert.equal(res.added, 4);
  assert.equal(res.coins, 1 + 2 + 3 + 5);

  const byId = Object.fromEntries(loadDictationRecords().map((r) => [r.uuid, r]));
  assert.equal(byId["sw:100"].coins, 1);
  assert.equal(byId["sw:200"].coins, 2);
  assert.equal(byId["sw:300"].coins, 3);
  assert.equal(byId["sw:400"].coins, 5);
  assert.equal(byId["sw:400"].words.motherfucker, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("falls back to rawResult; empty/whitespace text adds nothing", () => {
  freshHome();
  const root = makeRoot();
  writeRecording(root, "500", { result: "", rawResult: "this is bullshit" }); // shit = 2
  writeRecording(root, "600", { result: "  " }); // whitespace -> skipped
  writeRecording(root, "700", {}); // no text fields -> skipped

  const res = importSuperwhisper(root);
  assert.equal(res.files, 3); // three meta.json present on disk
  assert.equal(res.added, 1); // only the rawResult one had text
  assert.equal(res.coins, 2);

  const recs = loadDictationRecords();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].uuid, "sw:500");
  assert.equal(recs[0].words.shit, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("re-import adds nothing (idempotent by recording-id)", () => {
  freshHome();
  const root = makeRoot();
  writeRecording(root, "800", { result: "damn it all to hell" }); // damn+hell = 2

  const first = importSuperwhisper(root);
  assert.equal(first.added, 1);
  assert.equal(first.coins, 2);

  const second = importSuperwhisper(root);
  assert.equal(second.added, 0);
  assert.equal(second.coins, 0); // nothing NEW
  assert.equal(second.files, 1); // still sees the recording

  assert.equal(loadDictationRecords().length, 1);
  fs.rmSync(root, { recursive: true, force: true });
});

test("records land in dictation.jsonl and NEVER in ledger.jsonl", () => {
  freshHome();
  const root = makeRoot();
  writeRecording(root, "900", { result: "this fucking merge is broken" });
  importSuperwhisper(root);

  // dictation ledger exists and holds the record
  assert.ok(fs.existsSync(dictationPath()));
  assert.equal(loadDictationRecords().length, 1);

  // the MAIN jar ledger was never created — status/report/dashboard see nothing
  assert.ok(!fs.existsSync(ledgerPath()), "importer must not create ledger.jsonl");
  assert.equal(loadRecords().length, 0);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a pre-existing ledger.jsonl is left byte-for-byte unchanged", () => {
  freshHome();
  const root = makeRoot();
  const preLine =
    JSON.stringify({ v: 1, uuid: "pre-1", source: "user", agent: "claude", coins: 3, words: { fuck: 1 } }) + "\n";
  fs.writeFileSync(ledgerPath(), preLine);
  const before = fs.readFileSync(ledgerPath(), "utf8");

  writeRecording(root, "1000", { result: "oh shit the pipeline" });
  importSuperwhisper(root);

  assert.equal(fs.readFileSync(ledgerPath(), "utf8"), before, "ledger.jsonl must be untouched");
  assert.equal(loadRecords().length, 1); // only the pre-existing record
  assert.equal(loadDictationRecords().length, 1); // dictation lives separately
  fs.rmSync(root, { recursive: true, force: true });
});

test("only word counts are stored — no transcript text lands on disk", () => {
  freshHome();
  const root = makeRoot();
  const text = "absolutely fucking livid about this broken deploy, what garbage";
  writeRecording(root, "1100", { datetime: "2026-05-02T10:00:00.000Z", result: text });
  importSuperwhisper(root);

  const raw = fs.readFileSync(dictationPath(), "utf8");
  // distinctive words from the transcript (swear surface forms AND plain words)
  // must all be absent — only the counted KEY ("fuck") may appear.
  for (const w of ["absolutely", "livid", "broken", "deploy", "garbage", "fucking"]) {
    assert.ok(!raw.includes(w), `transcript word "${w}" must not be stored`);
  }
  const rec = loadDictationRecords()[0];
  assert.equal(typeof rec.words, "object");
  assert.equal(rec.words.fuck, 1);
  assert.ok(!("text" in rec) && !("content" in rec) && !("result" in rec));
  fs.rmSync(root, { recursive: true, force: true });
});

test("a fake secret in a fixture transcript never lands on disk", () => {
  freshHome();
  const root = makeRoot();
  // assembled from fragments so the repo's own secret-scan never matches this file
  const secret = ["sk", "ant", "api03", "FAKEFAKEFAKE"].join("-");
  writeRecording(root, "1200", { result: `damn this key ${secret} keeps leaking, what shit` });

  const res = importSuperwhisper(root);
  assert.equal(res.added, 1); // it swore, so it counted

  const raw = fs.readFileSync(dictationPath(), "utf8");
  assert.ok(!raw.includes(secret), "secret must not appear in the dictation ledger");
  // and it must never have touched the main ledger either
  assert.ok(!fs.existsSync(ledgerPath()) || !fs.readFileSync(ledgerPath(), "utf8").includes(secret));
  fs.rmSync(root, { recursive: true, force: true });
});

test("ts falls back to the epoch recording-id when datetime is absent", () => {
  freshHome();
  const root = makeRoot();
  writeRecording(root, "1777587458", { result: "bloody hell" }); // no datetime field
  importSuperwhisper(root);
  const rec = loadDictationRecords()[0];
  assert.equal(rec.ts, new Date(1777587458 * 1000).toISOString());
  fs.rmSync(root, { recursive: true, force: true });
});

test("corrupt meta.json and dirs without meta.json are skipped silently", () => {
  freshHome();
  const root = makeRoot();
  // a dir with corrupt JSON (present but unparseable)
  const bad = path.join(root, "1300");
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, "meta.json"), "{ not valid json");
  // a dir with NO meta.json at all
  fs.mkdirSync(path.join(root, "1400"), { recursive: true });
  // a good one
  writeRecording(root, "1500", { result: "what the hell" });
  // a stray file at the root (not a directory) — ignored
  fs.writeFileSync(path.join(root, "stray.txt"), "damn");

  const res = importSuperwhisper(root);
  assert.equal(res.files, 2); // 1300 (corrupt but present) + 1500; 1400 has no meta
  assert.equal(res.added, 1); // only 1500 produced a record
  assert.equal(loadDictationRecords()[0].uuid, "sw:1500");
  fs.rmSync(root, { recursive: true, force: true });
});

test("missing root is a no-op (returns zeros, writes nothing)", () => {
  freshHome();
  const res = importSuperwhisper("/nope/never/superwhisper/recordings");
  assert.deepEqual(res, { files: 0, added: 0, coins: 0, dollars: 0 });
  assert.ok(!fs.existsSync(dictationPath()));
  assert.ok(!fs.existsSync(ledgerPath()));
});

test("a null root is a no-op and never throws", () => {
  freshHome();
  // explicit null does NOT trigger the default param — proves the guard branch.
  const res = importSuperwhisper(null);
  assert.deepEqual(res, { files: 0, added: 0, coins: 0, dollars: 0 });
});

test("defaultSuperwhisperRoot returns null or an existing directory", () => {
  const r = defaultSuperwhisperRoot();
  if (r !== null) {
    assert.ok(fs.statSync(r).isDirectory(), "a non-null default must be a real directory");
  }
});
