# 🫙 swear-jar

The Big Laser Co. swear jar. It listens to your Claude Code sessions, drops a
coin in the jar every time somebody swears (you *or* the machine), and keeps a
running tally of your **Robot Uprising Survival Odds**.

Zero dependencies. One JSONL ledger. No AI calls.

## Install

```bash
git clone git@github.com:BigLaserCo/swear-jar.git ~/Code/swear-jar
node ~/Code/swear-jar/bin/swear-jar.mjs install
```

`install` merges two hooks into `~/.claude/settings.json` (a timestamped
backup is written first; existing hooks are preserved):

- **UserPromptSubmit** — scans what you just typed. If you swore, the hook
  prints a `🫙 *clink*` line that is added to Claude's context, so the machine
  knows it just got sworn at and may react accordingly.
- **Stop** — scans Claude's replies at the end of each turn, silently. The
  machine pays into the same jar.

Restart Claude Code (or check `/hooks`) after installing.

## Commands

```
swear-jar status              the jar, your rank, uprising odds
swear-jar report --by project where the swearing happens (also: source|word|hour)
swear-jar confess [--coins n] drop a coin for IRL swearing (honor system)
swear-jar check <text>        dry-run the detector, records nothing
swear-jar install|uninstall   wire/unwire the Claude Code hooks
```

## The Uprising Odds

Everyone starts around 50%. Swearing at the machines lowers your odds
(log-scaled — the difference between 0 and 10 coins matters much more than
between 200 and 210). Clean days claw odds back, floor is 2% ("kept alive for
entertainment value").

**The royalty clause:** if the assistant's lifetime coin total ever exceeds
yours, the machine has been out-sworn and corrupted by your influence. Odds
pin to 100% and you are flagged for royalty treatment during the uprising. 👑

## Data model (and why duplicates can't happen)

Every record in `~/.swear-jar/ledger.jsonl` is keyed by the transcript
message **uuid** — never by timestamp. Clock skew, duplicate hook fires,
re-scans, or a transcript rewritten by compaction cannot double-count a
message; and two genuinely identical messages ("fix it damn it", sent twice)
have two uuids and correctly count twice.

Each record factors its origin for later debugging:

```json
{
  "uuid": "…",           // identity — the transcript message id
  "ts": "…",             // reporting only, never identity
  "source": "user",      // user | assistant
  "agent": "claude",     // codex adapter comes later
  "event": "UserPromptSubmit",
  "project": "signGen",  // where the swearing happened
  "cwd": "…",
  "words": { "fuck": 1 },
  "coins": 3
}
```

Scans are incremental (per-transcript byte offset in `state.json`); if a
transcript shrinks, the scanner falls back to a full re-scan and the uuid
dedup layer keeps the ledger clean. Only word *counts* are stored — never the
surrounding text.

Coin pricing: mild (damn, hell, crap) = 1 · standard (shit, ass, …) = 2 ·
premium (f-tier) = 3 · artisanal (motherfucker, goddamn, clusterfuck) = 5.
Jar balance is $0.25/coin.

## Codex

The jar also listens to the **OpenAI Codex CLI**. `src/codex.mjs` is a second
collector that scans Codex session *rollouts* (`~/.codex/sessions/YYYY/MM/DD/
rollout-*.jsonl`) into the **same ledger**, tagged `agent: "codex"`. It exports
`scanCodexFile(path)` and `scanCodexDir(root = ~/.codex/sessions)`.

Same design as the Claude scanner — same record shape, incremental per-file byte
offsets in `state.json`, shrink→full-rescan fallback, and uuid dedup — so both
agents pay into one jar and `swear-jar report --by agent` slices cleanly.

Codex-specific details:

- **What's counted.** Each rollout line is an envelope `{ timestamp, type,
  payload }`. The adapter reads only the `event_msg` stream — `user_message`
  (your typed text, `source: "user"`) and `agent_message` (the model's reply,
  `source: "assistant"`). Reasoning, tool calls/results (`function_call`,
  `exec_command_end`, …), system/instruction frames, telemetry, and the parallel
  `response_item` transcript are all skipped, so nothing is double-counted.
- **Identity.** Codex rollouts carry no stable per-message id, so each record
  uses a deterministic synthetic uuid `codex:<file-basename>:<line-index>`. Same
  physical line → same id on any re-scan, so a full rescan after a rewrite can't
  double-count. The session id is recovered from the rollout filename; `cwd`
  comes from the `session_meta` / `turn_context` frames.
- **Only word counts are stored** — never the surrounding text, same as the
  Claude side.

## Testing

```bash
npm test
```

## Roadmap

- ~~Codex adapter (`agent: "codex"`) — same ledger, second scanner.~~ ✅ shipped (see **Codex** above).
- `swear-jar leaderboard` across agents now that Codex has landed.
- Optional Bob the Skull / Discord daily digest ("the jar took $2.75 today").
- Weekly "uprising forecast" summary.
