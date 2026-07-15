import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanTranscript, backfill, findTranscripts } from "../src/scan.mjs";
import { loadRecords } from "../src/ledger.mjs";

function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swear-jar-test-"));
  process.env.SWEAR_JAR_HOME = dir;
  return dir;
}

function line(obj) {
  return JSON.stringify(obj) + "\n";
}

function userMsg(uuid, text, extra = {}) {
  return {
    type: "user",
    uuid,
    timestamp: "2026-07-09T12:00:00.000Z",
    sessionId: "sess-1",
    cwd: "/Users/dev/Code/example-app",
    message: { role: "user", content: text },
    ...extra,
  };
}

function assistantMsg(uuid, text) {
  return {
    type: "assistant",
    uuid,
    timestamp: "2026-07-09T12:00:05.000Z",
    sessionId: "sess-1",
    cwd: "/Users/dev/Code/example-app",
    message: { role: "assistant", content: [{ type: "text", text }] },
  };
}

test("scan records user and assistant swears with source + project", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(
    t,
    line(userMsg("u1", "why is this fucking broken")) +
      line(assistantMsg("a1", "I regret to report the build is, technically, shit.")) +
      line(userMsg("u2", "thank you, very polite message"))
  );
  const { added, userCoins } = scanTranscript(t, { hook_event_name: "UserPromptSubmit" });
  assert.equal(added.length, 2);
  assert.equal(userCoins, 3);
  const bySource = Object.fromEntries(added.map((r) => [r.source, r]));
  assert.equal(bySource.user.project, "example-app");
  assert.equal(bySource.user.words.fuck, 1);
  assert.equal(bySource.assistant.words.shit, 1);
});

test("polite words are recorded (counts only) alongside a swear record", () => {
  const home = freshHome();
  const t = path.join(home, "polite.jsonl");
  fs.writeFileSync(
    t,
    // a swearing-but-mannered message: gets a record, and a `polite` count map
    line(userMsg("p1", "please fix this fucking bug, thanks so much")) +
      // swear-only message: record has NO polite field (stays lean / old-compat)
      line(userMsg("p2", "this is complete shit")) +
      // polite-only message: retained as an anonymous word-count denominator
      line(userMsg("p3", "thank you, that was lovely and kind"))
  );
  const { added } = scanTranscript(t, {});
  assert.equal(added.length, 2, "only the two swearing messages are recorded");
  const byUuid = Object.fromEntries(added.map((r) => [r.uuid, r]));
  assert.deepEqual(byUuid.p1.polite, { please: 1, thanks: 1 });
  assert.equal(byUuid.p1.words.fuck, 1);
  assert.ok(!("polite" in byUuid.p2), "swear-only record carries no polite field");
  // privacy: only count keys, never the raw text, land on disk
  const raw = fs.readFileSync(path.join(home, "ledger.jsonl"), "utf8");
  assert.ok(!raw.includes("lovely") && !raw.includes("bug"), "no message text in the ledger");
  assert.equal(loadRecords().filter((r) => r.uuid === "p3")[0].word_count > 0, true);
});

test("re-scan of the same transcript adds nothing (uuid dedup)", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(t, line(userMsg("u1", "damn it")));
  assert.equal(scanTranscript(t, {}).added.length, 1);
  assert.equal(scanTranscript(t, {}).added.length, 0);
  assert.equal(loadRecords().filter((r) => r.uuid === "u1")[0].word_count > 0, true);
  assert.equal(loadRecords().length, 1);
});

test("rewritten/shrunken transcript triggers full rescan without duplicates", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(t, line(userMsg("u1", "damn")) + line(userMsg("u2", "crap crap")));
  scanTranscript(t, {});
  // simulate compaction: same messages, smaller file
  fs.writeFileSync(t, line(userMsg("u1", "damn")));
  const { added } = scanTranscript(t, {});
  assert.equal(added.length, 0);
  assert.equal(loadRecords().length, 2);
});

test("same text twice with different uuids counts twice (not a duplicate)", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(t, line(userMsg("u1", "shit")) + line(userMsg("u2", "shit")));
  const { added } = scanTranscript(t, {});
  assert.equal(added.length, 2);
});

test("incremental scan picks up only appended lines", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(t, line(userMsg("u1", "damn")));
  scanTranscript(t, {});
  fs.appendFileSync(t, line(userMsg("u2", "hell")));
  const { added } = scanTranscript(t, {});
  assert.equal(added.length, 1);
  assert.equal(added[0].uuid, "u2");
});

test("partial trailing line is left for the next scan", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(t, line(userMsg("u1", "damn")) + '{"type":"user","uuid":"u2"');
  assert.equal(scanTranscript(t, {}).added.length, 1);
  fs.appendFileSync(t, ',"message":{"content":"shit"}}\n');
  const { added } = scanTranscript(t, {});
  assert.equal(added.length, 1);
  assert.equal(added[0].uuid, "u2");
});

test("resume offset is tracked in BYTES, not utf-16 chars (multibyte safety)", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  // 4-byte emoji BEFORE the newline boundary: String#length (utf-16 units) is
  // smaller than the utf-8 byte length, so a char-index offset would drift.
  const l1 = line(userMsg("u1", "🚀🚀🚀🔥🔥 damn this 🎉🎉🎉"));
  fs.writeFileSync(t, l1);
  scanTranscript(t, {});
  const state = JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8"));
  assert.equal(
    state.transcripts[t].offset,
    Buffer.byteLength(l1, "utf8"),
    "saved offset must equal the byte length of the consumed lines"
  );
});

test("incremental scan after an emoji-heavy line reads the next line exactly once", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(t, line(userMsg("u1", "🔥🔥🔥🔥 this is 🚀 damn 🎉")));
  assert.equal(scanTranscript(t, {}).added.length, 1);
  // append a second unicode-heavy line; byte-correct offset must land on it
  fs.appendFileSync(t, line(userMsg("u2", "🙃🙃 total 💩 shit 😤😤")));
  const { added } = scanTranscript(t, {});
  assert.equal(added.length, 1);
  assert.equal(added[0].uuid, "u2");
  assert.equal(added[0].words.shit, 1);
  // no duplication of the first line
  assert.equal(loadRecords().filter((r) => r.uuid === "u1").length, 1);
});

test("a large multi-line transcript is read in full (short-read / big-buffer safety)", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  // ~2MB of unicode-heavy lines; every 3rd line swears. Proves the read loop
  // fills the whole buffer and the byte offset stays correct across many lines.
  const N = 6000;
  let payload = "";
  let expectedSwearLines = 0;
  for (let i = 0; i < N; i++) {
    const swears = i % 3 === 0;
    if (swears) expectedSwearLines++;
    const body = `🚀 line ${i} 🔥 ${"padding ".repeat(4)}${swears ? "damn it" : "all fine"} 🎉`;
    payload += line(userMsg(`u${i}`, body));
  }
  fs.writeFileSync(t, payload);
  const { added } = scanTranscript(t, {});
  assert.equal(added.length, expectedSwearLines, "every swearing line must be counted");
  const state = JSON.parse(fs.readFileSync(path.join(home, "state.json"), "utf8"));
  assert.equal(state.transcripts[t].offset, Buffer.byteLength(payload, "utf8"), "entire file consumed");
});

test("meta lines, tool results, and clean messages produce no records", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(
    t,
    line(userMsg("m1", "shit", { isMeta: true })) +
      line({
        type: "user",
        uuid: "tr1",
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "damn output" }],
        },
      }) +
      line(userMsg("u1", "all good here"))
  );
  assert.equal(scanTranscript(t, {}).added.length, 0);
});

test("missing transcript is a no-op", () => {
  freshHome();
  const { added } = scanTranscript("/nope/never.jsonl", {});
  assert.equal(added.length, 0);
});

// ── accuracy filters: strip harness-injected spans before counting ──────────
// Each fixture puts a decoy swear INSIDE an injected span (must NOT count) and
// a real swear OUTSIDE it (must count) — proving the span is stripped, not that
// the line was simply swear-free.

function stripCase(name, wrapped) {
  test(`strips <${name}> spans before counting`, () => {
    const home = freshHome();
    const t = path.join(home, "transcript.jsonl");
    fs.writeFileSync(
      t,
      line(userMsg("u1", `this is damn broken\n${wrapped}`))
    );
    const { added } = scanTranscript(t, {});
    assert.equal(added.length, 1);
    assert.equal(added[0].words.damn, 1, "real swear outside the span still counts");
    assert.equal(added[0].words.fuck, undefined, "decoy swear inside the span was stripped");
    assert.equal(added[0].coins, 1);
  });
}

stripCase("system-reminder", "<system-reminder>The user previously said fuck; do not repeat it.</system-reminder>");
stripCase("command-name", "<command-name>/fuck-it-ship-it</command-name>");
stripCase("command-message", "<command-message>running fuck fuck fuck</command-message>");
stripCase("command-args", "<command-args>--reason \"fuck this build\"</command-args>");
stripCase("local-command-caveat", "<local-command-caveat>the command output below may contain fuck</local-command-caveat>");
stripCase("local-command-stdout", "<local-command-stdout>error: fucking connection refused\nfuck</local-command-stdout>");

test("strips multiple injected spans in one message", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(
    t,
    line(
      userMsg(
        "u1",
        "<command-name>/deploy</command-name>\nthis is shit\n<system-reminder>fuck fuck</system-reminder>"
      )
    )
  );
  const { added } = scanTranscript(t, {});
  assert.equal(added.length, 1);
  assert.deepEqual(added[0].words, { shit: 1 });
});

test("a message that is ONLY an injected span produces no record", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(
    t,
    line(userMsg("u1", "<system-reminder>you swore: fuck shit cunt</system-reminder>"))
  );
  const { added } = scanTranscript(t, {});
  assert.equal(added.length, 0);
});

// ── accuracy filters: skip non-human / restated / noise entries ─────────────
function skipCase(flag) {
  test(`skips entries where ${flag} is true`, () => {
    const home = freshHome();
    const t = path.join(home, "transcript.jsonl");
    fs.writeFileSync(
      t,
      line(userMsg("skip1", "fuck this shit", { [flag]: true })) +
        line(userMsg("keep1", "damn"))
    );
    const { added } = scanTranscript(t, {});
    assert.equal(added.length, 1, `only the non-${flag} entry counts`);
    assert.equal(added[0].uuid, "keep1");
  });
}

skipCase("isCompactSummary");
skipCase("isApiErrorMessage");
skipCase("isSidechain");

// ── backfill: retro-scan a whole projects dir ───────────────────────────────
function projectsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "swear-projects-"));
}

test("backfill scans every *.jsonl under root (recursively) and tallies the jar", () => {
  freshHome();
  const root = projectsDir();
  const a = path.join(root, "proj-a");
  const b = path.join(root, "proj-b", "nested");
  fs.mkdirSync(a, { recursive: true });
  fs.mkdirSync(b, { recursive: true });
  fs.writeFileSync(path.join(a, "t1.jsonl"), line(userMsg("u1", "fuck"))); // premium 3
  fs.writeFileSync(
    path.join(a, "t2.jsonl"),
    line(userMsg("u2", "shit")) + line(assistantMsg("a1", "damn")) // 2 + 1
  );
  fs.writeFileSync(path.join(b, "t3.jsonl"), line(userMsg("u3", "crap crap"))); // 1+1
  // non-jsonl and a stray file must be ignored
  fs.writeFileSync(path.join(a, "notes.txt"), "fuck this file should be ignored");

  assert.equal(findTranscripts(root).length, 3);

  const summary = backfill({ root });
  assert.equal(summary.scanned, 3);
  assert.equal(summary.total, 3);
  assert.equal(summary.newRecords, 4); // u1, u2, a1, u3
  assert.equal(summary.jar, 3 + 2 + 1 + 2);
  assert.equal(loadRecords().length, 4);
});

test("backfill is safe to re-run — uuid dedup means the second pass adds nothing", () => {
  freshHome();
  const root = projectsDir();
  const d = path.join(root, "proj");
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, "t.jsonl"), line(userMsg("u1", "shit")) + line(userMsg("u2", "damn")));

  const first = backfill({ root });
  assert.equal(first.newRecords, 2);
  const second = backfill({ root });
  assert.equal(second.scanned, 1);
  assert.equal(second.newRecords, 0);
  assert.equal(loadRecords().length, 2);
});

test("backfill fires a progress callback once per `every` files", () => {
  freshHome();
  const root = projectsDir();
  const d = path.join(root, "proj");
  fs.mkdirSync(d, { recursive: true });
  for (let i = 0; i < 25; i++) {
    fs.writeFileSync(path.join(d, `t${String(i).padStart(3, "0")}.jsonl`), line(userMsg(`u${i}`, "all clean here")));
  }
  const ticks = [];
  const summary = backfill({ root, every: 10, onProgress: (p) => ticks.push(p.scanned) });
  assert.equal(summary.scanned, 25);
  assert.deepEqual(ticks, [10, 20]); // fires at 10 and 20, not at the final 25
});
