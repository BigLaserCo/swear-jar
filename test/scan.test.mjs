import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanTranscript } from "../src/scan.mjs";
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
    cwd: "/Users/jim/Code/signGen",
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
    cwd: "/Users/jim/Code/signGen",
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
  assert.equal(bySource.user.project, "signGen");
  assert.equal(bySource.user.words.fuck, 1);
  assert.equal(bySource.assistant.words.shit, 1);
});

test("re-scan of the same transcript adds nothing (uuid dedup)", () => {
  const home = freshHome();
  const t = path.join(home, "transcript.jsonl");
  fs.writeFileSync(t, line(userMsg("u1", "damn it")));
  assert.equal(scanTranscript(t, {}).added.length, 1);
  assert.equal(scanTranscript(t, {}).added.length, 0);
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
