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

## Install as a Claude Code plugin or skill

Two ways to wire the jar into Claude Code. Both shell out to `node`, so both
need **Node ≥ 20** on your `PATH`. If Node is missing or too old, the hook
prints a one-line error and **exits 0** — your session is never blocked; the jar
simply records nothing until Node is available.

### Option A — plugin marketplace (one command, hooks auto-wire)

```
/plugin marketplace add BigLaserCo/swear-jar
/plugin install swear-jar@biglaser
```

Done. The plugin ships both hooks (`UserPromptSubmit` + `Stop`) and a
`/swear-jar:swear-jar` skill, so there is nothing to hand-edit in
`settings.json`. Manage or disable it from `/plugin`; pull updates later with
`/plugin marketplace update`. The skill lets you (or Claude) drive the jar
conversationally — "check the jar", "backfill my history", "render the
dashboard".

### Option B — plain clone + `swear-jar install`

The original path, no plugin system involved:

```
git clone git@github.com:BigLaserCo/swear-jar.git ~/Code/swear-jar
node ~/Code/swear-jar/bin/swear-jar.mjs install
```

`install` merges the same two hooks into `~/.claude/settings.json` (see
[Install](#install) above). No skill — you drive it from the shell.

### Running both is harmless

Install the plugin *and* the standalone hooks and every swear is still counted
exactly once. Both wire the identical `swear-jar … scan` command against the one
`~/.swear-jar/ledger.jsonl`, and every record is keyed by the transcript message
**uuid** — a message already in the jar is skipped on any re-scan or duplicate
hook fire (see [Data model](#data-model-and-why-duplicates-cant-happen)). Belt
and suspenders, no double charge.

## Commands

```
swear-jar status              the jar, your rank, uprising odds
swear-jar report --by project where the swearing happens (also: source|word|hour)
swear-jar confess [--coins n] drop a coin for IRL swearing (honor system)
swear-jar check <text>        dry-run the detector, records nothing
swear-jar install|uninstall   wire/unwire the Claude Code hooks
```

## Dashboard

```
swear-jar dashboard           build the local HTML damage report
```

`swear-jar dashboard` folds your ledger into a single self-contained HTML page
and writes it to `~/.swear-jar/report.html`, then **prints the path** — it
never opens a browser for you (open the file yourself when you want it). The
page is 100% local and offline: no CDN, no fonts, no remote images, no network
of any kind. Everything is inlined.

What it shows: the hero **$ owed to the jar**, the **you-vs-machine** split, the
**Robot Uprising** odds gauge + your rank, **coins by project**, a rage-o-clock
(coins by hour), a per-day trend, day-of-week, and your most-used families.
Swears are **censored by default** (`f***`) — a toggle reveals them locally, and
the share card carries only aggregate numbers, never a word of what you said.

An optional "empty your jar" donate button stays hidden unless you pass a
donate URL when rendering — there is no payment link baked in.

The renderer is exported for embedding: `renderDashboard(stats, { donateUrl })`
returns the filled HTML string, and `writeDashboard(records, opts)` writes the
report and returns its path (`src/dashboard.mjs`); `computeStats(records, now)`
produces the stats object (`src/stats.mjs`).

## Leaderboard (optional)

Want to see how your potty mouth ranks? `swear-jar wrapped --submit` prints a
link to the hosted leaderboard, pre-filled with **aggregate numbers only** — total
coins, $ owed, f-bombs %, and your **censored** top word, plus the app version and
release hash. Nothing is uploaded until you open the link, log in, and confirm on
the page; your transcripts never leave your machine.

```bash
swear-jar wrapped            # your shareable summary (no link)
swear-jar wrapped --submit   # + the pre-filled leaderboard submit link
```

Entries from a published release show a **✓ verified** badge (provenance: the
release hash is on the known-releases list). Honest caveat: verified means "came
from a published build + a real account", **not** proof the numbers weren't
faked — a local open-source tool can't prove that (see [SECURITY.md](SECURITY.md)).
You can spot-check your own ledger's integrity with `swear-jar verify-ledger`
(tamper-evident, not tamper-proof).

## Website

The public landing page and a live demo report live in [`docs/`](docs/) and are
served by **GitHub Pages** (Settings → Pages → *Deploy from a branch* → `main`,
folder `/docs`). Turning Pages on is a one-time repo-settings action for the repo
owner; once the repo is public and Pages is enabled, the site goes live at the
Pages URL.

- `docs/index.html` — the landing page. Self-contained: inline CSS/JS, zero
  external requests (the only outbound links point at this repo on GitHub).
- `docs/demo.html` — a synthetic damage report rendered by the **real** dashboard
  engine from fake data (a loud "synthetic demo" banner says so). Regenerate with
  `node scripts/site/buildDemo.mjs` — it is deterministic (fixed seed, same bytes
  every run) and reads **no** real ledger, `~/.swear-jar`, or `~/.claude` data.
- `docs/.nojekyll` — tells Pages to serve the files verbatim (skip the Jekyll build).

Both pages make zero network requests and carry no uncensored language; the
`docs/*` invariant is enforced by `test/site.test.mjs` (part of `npm test` and the
CI gate).

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

## Dictation import (rage.wav)

If you dictate to your AI, the jar can also count the swears in your **historical
dictations** — the voice notes you spoke, measured as *swears-per-dictation*. In
the report this lane is branded **rage.wav** (the tape).

```
swear-jar import-dictation [--root <dir>]   # historical rage.wav dictation → its own ledger
swear-jar report --dictation                # the dictation history, on its own
```

Each recording is stored as `<root>/<recording-id>/meta.json`; the importer
auto-detects the folder (the literal install path is
`~/Documents/superwhisper/recordings`) or takes `--root`. Same audited lexicon,
same "word counts only, never the text" privacy rule; re-running imports nothing
new (idempotent by recording-id).

**It is a separate, never-summed ledger** (`~/.swear-jar/dictation.jsonl`), not
the main jar. This is the no-double-count rule made mechanical: a dictated prompt
usually *also* appears in the Claude/Codex transcript the main jar already scans,
so folding dictation into `ledger.jsonl` would count it twice. `status`,
`dashboard`, and plain `report` read only `ledger.jsonl` and never see it;
dictation surfaces only through `report --dictation`.

## Testing

```bash
npm test
```

## Roadmap

- ~~Codex adapter (`agent: "codex"`) — same ledger, second scanner.~~ ✅ shipped (see **Codex** above).
- `swear-jar leaderboard` across agents now that Codex has landed.
- Optional daily digest (one summary line, aggregate numbers only).
- Weekly "uprising forecast" summary.
