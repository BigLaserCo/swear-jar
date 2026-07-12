import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { detectSources, runInit, expandTilde, validSuperwhisperDir } from "../src/init.mjs";
import { loadTotals } from "../src/scan.mjs";
import { loadRecords } from "../src/ledger.mjs";
import { loadDictationRecords } from "../src/superwhisper.mjs";

// All fixtures are SYNTHETIC — hand-authored transcripts/rollouts/recordings with
// fake content. No real user history is read, and every root is a temp dir so a
// test never touches the real home (~/.claude, ~/.codex, ~/Documents/superwhisper).

const BIN = fileURLToPath(new URL("../bin/swear-jar.mjs", import.meta.url));
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const tick = () => new Promise((r) => setImmediate(r));

// Isolate the two env-only roots (jar + hooks) that have no param override.
function freshHome() {
  const home = tmp("swear-jar-init-home-");
  process.env.SWEAR_JAR_HOME = home;
  process.env.SWEAR_JAR_CLAUDE_SETTINGS = path.join(tmp("swear-jar-init-settings-"), "settings.json");
  return home;
}

// A PassThrough that collects everything written to it (readline-compatible).
function collector() {
  const stream = new PassThrough();
  const chunks = [];
  stream.on("data", (c) => chunks.push(c.toString()));
  return { stream, text: () => chunks.join("") };
}

// ── fixture builders ─────────────────────────────────────────────────────────
function claudeFixture(n = 1) {
  const root = tmp("init-claude-");
  const proj = path.join(root, "proj-a");
  fs.mkdirSync(proj, { recursive: true });
  for (let i = 0; i < n; i++) {
    const line =
      JSON.stringify({
        type: "user",
        uuid: `cu${i}`,
        timestamp: "2026-07-01T09:00:00.000Z",
        sessionId: "s",
        cwd: "/tmp/proj",
        message: { role: "user", content: "why the fuck" }, // premium 3
      }) + "\n";
    fs.writeFileSync(path.join(proj, `t${i}.jsonl`), line);
  }
  return root;
}

function codexFixture() {
  const root = tmp("init-codex-");
  const day = path.join(root, "2026", "07", "01");
  fs.mkdirSync(day, { recursive: true });
  const lines =
    [
      { timestamp: "2026-07-01T10:00:00.000Z", type: "session_meta", payload: { id: "11111111-1111-1111-1111-111111111111", cwd: "/tmp/proj" } },
      { timestamp: "2026-07-01T10:00:01.000Z", type: "event_msg", payload: { type: "user_message", message: "this build is fucking broken" } }, // premium 3
    ]
      .map((o) => JSON.stringify(o))
      .join("\n") + "\n";
  fs.writeFileSync(path.join(day, "rollout-2026-07-01-22222222-2222-2222-2222-222222222222.jsonl"), lines);
  return root;
}

function superwhisperFixture(result = "oh shit") {
  const root = tmp("init-sw-");
  const rec = path.join(root, "1777587458");
  fs.mkdirSync(rec, { recursive: true });
  fs.writeFileSync(path.join(rec, "meta.json"), JSON.stringify({ datetime: "2026-05-01T09:00:00.000Z", result }));
  return root;
}

// ── detectSources ────────────────────────────────────────────────────────────
test("detectSources reports found + cheap counts against fixture roots", () => {
  freshHome();
  const claudeRoot = claudeFixture(3);
  const codexRoot = codexFixture();
  const superwhisperRoot = superwhisperFixture();

  const d = detectSources({ claudeRoot, codexRoot, superwhisperRoot });

  assert.equal(d.claude.found, true);
  assert.equal(d.claude.root, claudeRoot);
  assert.equal(d.claude.transcripts, 3);

  assert.equal(d.codex.found, true);
  assert.equal(d.codex.root, codexRoot);
  assert.equal(d.codex.rollouts, 1);

  assert.equal(d.superwhisper.found, true);
  assert.equal(d.superwhisper.root, superwhisperRoot);
  assert.equal(d.superwhisper.recordings, 1);
  assert.ok(Array.isArray(d.superwhisper.candidates) && d.superwhisper.candidates.length === 4);

  assert.equal(d.ledger.records, 0);
  assert.equal(d.ledger.coins, 0);
  assert.equal(typeof d.hooks.installed, "boolean");
});

test("detectSources marks missing roots not-found with zero counts (no throw)", () => {
  freshHome();
  const d = detectSources({
    claudeRoot: "/nope/claude",
    codexRoot: "/nope/codex",
    superwhisperRoot: "/nope/superwhisper",
  });
  assert.equal(d.claude.found, false);
  assert.equal(d.claude.transcripts, 0);
  assert.equal(d.codex.found, false);
  assert.equal(d.codex.rollouts, 0);
  assert.equal(d.superwhisper.found, false);
  assert.equal(d.superwhisper.root, null); // null when nothing was found
  assert.equal(d.superwhisper.recordings, 0);
});

test("detectSources shape is stable — exactly the documented keys (the skill's API)", () => {
  freshHome();
  const d = detectSources({ claudeRoot: "/nope", codexRoot: "/nope", superwhisperRoot: "/nope" });
  assert.deepEqual(Object.keys(d).sort(), ["claude", "codex", "hooks", "ledger", "superwhisper"]);
  assert.deepEqual(Object.keys(d.claude).sort(), ["found", "root", "transcripts"]);
  assert.deepEqual(Object.keys(d.codex).sort(), ["found", "rollouts", "root"]);
  assert.deepEqual(Object.keys(d.superwhisper).sort(), ["candidates", "found", "recordings", "root"]);
  assert.deepEqual(Object.keys(d.ledger).sort(), ["coins", "records"]);
  assert.deepEqual(Object.keys(d.hooks).sort(), ["installed"]);
});

test("detectSources reflects an installed hook", () => {
  freshHome();
  fs.mkdirSync(path.dirname(process.env.SWEAR_JAR_CLAUDE_SETTINGS), { recursive: true });
  fs.writeFileSync(
    process.env.SWEAR_JAR_CLAUDE_SETTINGS,
    JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: 'node "/x/bin/swear-jar.mjs" scan' }] }] } })
  );
  const d = detectSources({ claudeRoot: "/nope", codexRoot: "/nope", superwhisperRoot: "/nope" });
  assert.equal(d.hooks.installed, true);
});

// ── `init --detect` (subprocess: the machine-readable contract) ───────────────
test("init --detect prints valid JSON with correct counts and exits 0", () => {
  const home = tmp("init-detect-home-");
  const settings = path.join(tmp("init-detect-settings-"), "settings.json");
  const claudeRoot = claudeFixture(2);
  const codexRoot = codexFixture();
  const superwhisperRoot = superwhisperFixture();

  const out = execFileSync("node", [BIN, "init", "--detect"], {
    encoding: "utf8",
    env: {
      ...process.env,
      SWEAR_JAR_HOME: home,
      SWEAR_JAR_CLAUDE_SETTINGS: settings,
      CLAUDE_PROJECTS_ROOT: claudeRoot,
      CODEX_SESSIONS_ROOT: codexRoot,
      SWEAR_JAR_SUPERWHISPER_ROOT: superwhisperRoot,
    },
  });
  const d = JSON.parse(out.trim()); // JSON is the ONLY thing printed on --detect
  assert.equal(d.claude.found, true);
  assert.equal(d.claude.transcripts, 2);
  assert.equal(d.codex.found, true);
  assert.equal(d.codex.rollouts, 1);
  assert.equal(d.superwhisper.found, true);
  assert.equal(d.superwhisper.recordings, 1);
  assert.equal(d.ledger.records, 0);
  assert.equal(d.hooks.installed, false);
});

// ── non-interactive `--yes` ──────────────────────────────────────────────────
test("init --yes scans every found source, writes the report, and is idempotent", async () => {
  const home = freshHome();
  const claudeRoot = claudeFixture(1);
  const codexRoot = codexFixture();
  const superwhisperRoot = superwhisperFixture();
  const c1 = collector();

  const first = await runInit({
    yes: true,
    noHooks: true,
    claudeRoot,
    codexRoot,
    superwhisperRoot,
    output: c1.stream,
  });

  // jar = claude(3) + codex(3); dictation lives in its OWN ledger, never summed.
  const totals = loadTotals(loadRecords());
  assert.equal(totals.user + totals.assistant, 6);
  assert.equal(loadRecords().length, 2);
  assert.equal(loadDictationRecords().length, 1); // rage.wav: "oh shit"
  assert.ok(fs.existsSync(first.reportPath), "the report file is written");
  assert.equal(first.reportPath, path.join(home, "report.html"));

  const t1 = c1.text();
  assert.match(t1, /The damage/);
  assert.match(t1, /rage\.wav:/); // dictation reported in the summary text
  assert.match(t1, /we never launch a browser/);

  // Second run: dedup means nothing is double-counted.
  const c2 = collector();
  await runInit({ yes: true, noHooks: true, claudeRoot, codexRoot, superwhisperRoot, output: c2.stream });
  assert.equal(loadRecords().length, 2, "no new jar records on re-run");
  assert.equal(loadDictationRecords().length, 1, "no new dictation records on re-run");
  assert.match(c2.text(), /Jar so far: \$1\.50 — re-running is safe/); // 6 coins * $0.25
});

test("init --yes names the supplying flag for each missing source", async () => {
  freshHome();
  const c = collector();
  await runInit({
    yes: true,
    noHooks: true,
    claudeRoot: "/nope/claude",
    codexRoot: "/nope/codex",
    superwhisperRoot: "/nope/superwhisper",
    output: c.stream,
  });
  const t = c.text();
  assert.match(t, /Claude Code history not found.*CLAUDE_PROJECTS_ROOT/);
  assert.match(t, /Codex history not found.*--codex-root <dir>/);
  assert.match(t, /Superwhisper dictation not found at \/nope\/superwhisper.*--root <dir>/);
});

test("init --yes wires the hooks unless --no-hooks", async () => {
  freshHome();
  const c = collector();
  await runInit({ yes: true, claudeRoot: "/nope", codexRoot: "/nope", superwhisperRoot: "/nope", output: c.stream });
  const settings = JSON.parse(fs.readFileSync(process.env.SWEAR_JAR_CLAUDE_SETTINGS, "utf8"));
  assert.ok(settings.hooks.UserPromptSubmit[0].hooks[0].command.includes("swear-jar"));
  assert.ok(settings.hooks.Stop[0].hooks[0].command.includes("scan"));
  assert.match(c.text(), /Hooks wired/);
});

// ── interactive wizard (readline via stdin injection) ────────────────────────
async function driveInteractive(opts, answers) {
  const input = new PassThrough();
  const out = collector();
  const done = runInit({ ...opts, interactive: true, input, output: out.stream });
  for (const a of answers) {
    input.write(a + "\n");
    await tick();
    await tick(); // let readline resolve + register the next question()
  }
  const res = await done;
  return { res, text: out.text() };
}

test("interactive: typed-path fallback re-prompts on a bad path then imports a good one", async () => {
  freshHome();
  const superwhisperRoot = superwhisperFixture("what the hell"); // hell = mild 1
  // claude/codex missing → no prompts there; superwhisper forced not-found so we
  // exercise the typed-path loop; answers: [1/4] hooks=n, bad path, good path.
  const { text } = await driveInteractive(
    { noHooks: false, claudeRoot: "/nope", codexRoot: "/nope", superwhisperRoot: "/nope/superwhisper" },
    ["n", "/still/nope", superwhisperRoot]
  );
  assert.match(text, /Superwhisper not found at any of the usual spots/);
  assert.match(text, /not found: \/still\/nope/);
  assert.equal(loadDictationRecords().length, 1);
  assert.equal(loadDictationRecords()[0].words.hell, 1);
});

test("interactive: [Enter] accepts the found dictation path and imports it", async () => {
  freshHome();
  const superwhisperRoot = superwhisperFixture("this fucking merge");
  // answers: [1/4] hooks=n (skip install), [4/4] Enter = use found path.
  const { text } = await driveInteractive(
    { claudeRoot: "/nope", codexRoot: "/nope", superwhisperRoot },
    ["n", ""]
  );
  assert.match(text, /found, 1 recordings/);
  assert.equal(loadDictationRecords().length, 1);
});

// ── small pure helpers ───────────────────────────────────────────────────────
test("expandTilde expands ~ and ~/x, leaves other paths alone", () => {
  assert.equal(expandTilde("~"), os.homedir());
  assert.equal(expandTilde("~/foo/bar"), path.join(os.homedir(), "foo/bar"));
  assert.equal(expandTilde("/abs/path"), "/abs/path");
  assert.equal(expandTilde("rel/path"), "rel/path");
});

test("validSuperwhisperDir requires a dir with >=1 <id>/meta.json", () => {
  const empty = tmp("init-empty-");
  assert.equal(validSuperwhisperDir(empty), false); // exists but no recordings
  assert.equal(validSuperwhisperDir("/nope/never"), false); // missing
  assert.equal(validSuperwhisperDir(superwhisperFixture()), true);
});
