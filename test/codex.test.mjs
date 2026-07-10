import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { scanCodexFile, scanCodexDir } from "../src/codex.mjs";
import { loadRecords, statePath } from "../src/ledger.mjs";

// All fixtures below are SYNTHETIC — hand-authored envelopes mirroring the real
// Codex rollout schema (session_meta / turn_context / event_msg / response_item)
// with fake innocuous content. No real rollout text is used anywhere.

function freshHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "swear-jar-codex-"));
  process.env.SWEAR_JAR_HOME = dir;
  return dir;
}

function line(obj) {
  return JSON.stringify(obj) + "\n";
}

const FAKE_UUID = "019de04a-24e4-7f40-95ca-5ee64de13b45";
function rolloutName(uuid = FAKE_UUID) {
  return `rollout-2026-07-09T12-00-00-${uuid}.jsonl`;
}

// ---- envelope builders (structure copied, content invented) ----
const meta = (cwd = "/Users/dev/Code/widgets") => ({
  timestamp: "2026-07-09T12:00:00.000Z",
  type: "session_meta",
  payload: { id: FAKE_UUID, cwd, cli_version: "0.0.0", source: "test" },
});
const turnCtx = (cwd = "/Users/dev/Code/widgets") => ({
  timestamp: "2026-07-09T12:00:01.000Z",
  type: "turn_context",
  payload: { cwd, current_date: "2026-07-09", model: "test", effort: "low" },
});
const userMsg = (text) => ({
  timestamp: "2026-07-09T12:00:02.000Z",
  type: "event_msg",
  payload: { type: "user_message", message: text, images: [], local_images: [], text_elements: [] },
});
const agentMsg = (text) => ({
  timestamp: "2026-07-09T12:00:03.000Z",
  type: "event_msg",
  payload: { type: "agent_message", message: text, phase: "final" },
});
// noise frames that MUST NOT be counted
const reasoning = (text) => ({
  timestamp: "2026-07-09T12:00:02.500Z",
  type: "response_item",
  payload: { type: "reasoning", content: [{ type: "reasoning_text", text }], summary: [] },
});
const respMessage = (role, text) => ({
  // the parallel model-transcript stream we deliberately ignore (dedup safety)
  timestamp: "2026-07-09T12:00:02.700Z",
  type: "response_item",
  payload: {
    type: "message",
    role,
    content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
  },
});
const execEnd = (text) => ({
  timestamp: "2026-07-09T12:00:02.800Z",
  type: "event_msg",
  payload: { type: "exec_command_end", command: ["sh", "-c", text], stdout: text, exit_code: 0, status: "success" },
});
const functionCall = (text) => ({
  timestamp: "2026-07-09T12:00:02.900Z",
  type: "response_item",
  payload: { type: "function_call", name: "shell", arguments: text, call_id: "c1" },
});
const developerMsg = (text) => ({
  timestamp: "2026-07-09T12:00:00.500Z",
  type: "response_item",
  payload: { type: "message", role: "developer", content: [{ type: "input_text", text }] },
});
const tokenCount = () => ({
  timestamp: "2026-07-09T12:00:04.000Z",
  type: "event_msg",
  payload: { type: "token_count", info: {}, rate_limits: {} },
});

function writeRollout(home, entries, name = rolloutName()) {
  const p = path.join(home, name);
  fs.writeFileSync(p, entries.map(line).join(""));
  return p;
}

test("records user + assistant swears with agent:codex and correct source", () => {
  const home = freshHome();
  const p = writeRollout(home, [
    meta(),
    turnCtx(),
    userMsg("why is this damn thing broken"),
    reasoning("the user seems upset, shit happens"), // noise: not counted
    agentMsg("I regret to report the build is, technically, shit."),
  ]);
  const { added, userCoins } = scanCodexFile(p);
  assert.equal(added.length, 2);
  assert.equal(userCoins, 1); // "damn" = mild = 1

  const bySource = Object.fromEntries(added.map((r) => [r.source, r]));
  assert.equal(bySource.user.agent, "codex");
  assert.equal(bySource.assistant.agent, "codex");
  assert.equal(bySource.user.event, "codex-rollout");
  assert.equal(bySource.user.words.damn, 1);
  assert.equal(bySource.assistant.words.shit, 1);
  assert.equal(bySource.user.project, "widgets"); // basename of cwd
  assert.equal(bySource.user.session, FAKE_UUID); // recovered from filename
  assert.ok(bySource.user.uuid.startsWith("codex:rollout-"));
});

test("re-scan of the same file adds nothing (synthetic-uuid dedup)", () => {
  const home = freshHome();
  const p = writeRollout(home, [meta(), turnCtx(), userMsg("what the hell")]);
  assert.equal(scanCodexFile(p).added.length, 1);
  assert.equal(scanCodexFile(p).added.length, 0);
  assert.equal(loadRecords().length, 1);
});

test("incremental scan picks up only appended messages", () => {
  const home = freshHome();
  const p = writeRollout(home, [meta(), turnCtx(), userMsg("first damn line")]);
  assert.equal(scanCodexFile(p).added.length, 1);
  fs.appendFileSync(p, line(agentMsg("second bloody-awful shit line")));
  const { added } = scanCodexFile(p);
  assert.equal(added.length, 1);
  assert.equal(added[0].source, "assistant");
  assert.equal(added[0].words.shit, 1);
  assert.equal(loadRecords().length, 2);
});

test("rewritten/shrunken file triggers full rescan without duplicates", () => {
  const home = freshHome();
  const p = writeRollout(home, [meta(), turnCtx(), userMsg("damn"), agentMsg("crap crap")]);
  scanCodexFile(p);
  assert.equal(loadRecords().length, 2);
  // compaction: same leading messages, smaller file
  fs.writeFileSync(p, [meta(), turnCtx(), userMsg("damn")].map(line).join(""));
  const { added } = scanCodexFile(p);
  assert.equal(added.length, 0); // same line index -> same uuid -> deduped
  assert.equal(loadRecords().length, 2);
});

test("tool, reasoning, system and auto-generated frames produce no records", () => {
  const home = freshHome();
  const p = writeRollout(home, [
    meta(),
    developerMsg("you are a helpful damn assistant"), // system/instruction role
    turnCtx(),
    reasoning("thinking about this shit carefully"), // thinking
    execEnd("bash: damn: command not found"), // tool result
    functionCall("run the goddamn script"), // tool call
    respMessage("user", "this is fucking annoying"), // parallel stream (ignored)
    respMessage("assistant", "what a shit situation"), // parallel stream (ignored)
    tokenCount(), // auto-generated telemetry
  ]);
  const { added } = scanCodexFile(p);
  assert.equal(added.length, 0);
  assert.equal(loadRecords().length, 0);
});

test("clean messages (no swears) produce no records", () => {
  const home = freshHome();
  const p = writeRollout(home, [meta(), turnCtx(), userMsg("thank you, that was lovely"), agentMsg("happy to help")]);
  assert.equal(scanCodexFile(p).added.length, 0);
});

test("missing file is a no-op", () => {
  freshHome();
  const { added, userCoins } = scanCodexFile("/nope/never/rollout-x.jsonl");
  assert.equal(added.length, 0);
  assert.equal(userCoins, 0);
});

test("corrupt / garbage file is a no-op and never throws", () => {
  const home = freshHome();
  const p = path.join(home, rolloutName());
  fs.writeFileSync(p, "not json at all\n{ broken json\n\x00\x01\x02\n");
  const { added } = scanCodexFile(p);
  assert.equal(added.length, 0);
  assert.equal(loadRecords().length, 0);
});

test("a fake secret in a fixture never lands in the ledger or state", () => {
  const home = freshHome();
  const secret = "sk-ant-api03-FAKE";
  // secret embedded in a message that ALSO swears, so it goes through detect()
  const p = writeRollout(home, [
    meta(),
    turnCtx(),
    userMsg(`my damn key ${secret} keeps leaking`),
    agentMsg(`never paste ${secret} you shit`),
  ]);
  const { added } = scanCodexFile(p);
  assert.equal(added.length, 2); // both counted (they swore)

  const ledger = fs.readFileSync(path.join(home, "ledger.jsonl"), "utf8");
  const state = fs.readFileSync(statePath(), "utf8");
  assert.ok(!ledger.includes(secret), "secret must not appear in the ledger");
  assert.ok(!state.includes(secret), "secret must not appear in scan state");
  // only word COUNTS are stored, never the surrounding text
  for (const r of added) assert.equal(typeof r.words, "object");
});

test("scanCodexDir walks a nested YYYY/MM/DD tree and aggregates", () => {
  const home = freshHome();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-sessions-"));
  const day1 = path.join(root, "2026", "07", "08");
  const day2 = path.join(root, "2026", "07", "09");
  fs.mkdirSync(day1, { recursive: true });
  fs.mkdirSync(day2, { recursive: true });
  writeRollout(day1, [meta(), turnCtx(), userMsg("damn")], rolloutName("019de048-8701-7113-a76e-29c70fceae83"));
  writeRollout(day2, [meta(), turnCtx(), agentMsg("shit"), userMsg("hell")], rolloutName());
  // a non-rollout file must be ignored
  fs.writeFileSync(path.join(day2, "notes.txt"), "damn damn damn");

  const res = scanCodexDir(root);
  assert.equal(res.files, 2);
  assert.equal(res.added.length, 3);
  assert.equal(res.userCoins, 2); // "damn"(1) + "hell"(1); assistant "shit" excluded
  assert.equal(loadRecords().length, 3);
  assert.ok(loadRecords().every((r) => r.agent === "codex"));
  fs.rmSync(root, { recursive: true, force: true });
});

test("missing sessions root is a no-op", () => {
  freshHome();
  const res = scanCodexDir("/nope/never/sessions");
  assert.equal(res.files, 0);
  assert.equal(res.added.length, 0);
});

test("cwd is recovered on an incremental scan whose window starts past session_meta", () => {
  const home = freshHome();
  // first turn establishes offset past the meta line
  const p = writeRollout(home, [meta("/Users/dev/Code/alpha"), turnCtx("/Users/dev/Code/alpha"), userMsg("damn")]);
  scanCodexFile(p);
  // second turn: appended user_message WITHOUT a fresh turn_context in the window
  fs.appendFileSync(p, line(userMsg("hell")));
  const { added } = scanCodexFile(p);
  assert.equal(added.length, 1);
  // cwd seeded from the session_meta first line -> project resolves, not "unknown"
  assert.equal(added[0].project, "alpha");
});
