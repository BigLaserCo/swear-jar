# 🫙 swear-jar

The Big Laser Co. swear jar. It listens to your Claude Code sessions, drops a
coin in the jar every time somebody swears (you *or* the machine), and keeps a
running tally of your **Robot Uprising Survival Odds**.

Zero dependencies. One JSONL ledger. No AI calls.

## Install

```bash
git clone git@github.com:your-org/swear-jar.git ~/Code/swear-jar
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
  "project": "example-app",  // where the swearing happened
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

## Testing

```bash
npm test
```

## Roadmap

- Codex adapter (`agent: "codex"`) — same ledger, second scanner.
- `swear-jar leaderboard` across agents once Codex lands.
- Optional daily digest (one summary line, aggregate numbers only).
- Weekly "uprising forecast" summary.
