---
name: swear-jar
description: Operate the local swear jar — the running tally of every time the user (or the machine) swears in a Claude Code / Codex session, and their Robot Uprising Survival Odds. Use when the user asks to "launch swear jar", "set up the swear jar", check the jar, see "how much do I owe the jar", backfill their history, render the dashboard, get their "swear jar wrapped" recap, break the swearing down by project/source/word/hour/agent, or confess an IRL swear.
---

# 🫙 Swear jar

A novelty jar that drops a coin every time somebody swears at the robots. All
data is **local word-counts only** — a JSONL ledger at `~/.swear-jar/`, no AI
calls, no network. Two hooks (this plugin's) already feed it in the background.

## Run the CLI

Every action is one Bash call to the bundled CLI:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/swear-jar.mjs" <subcommand>
```

| The user wants…                    | Run                                                             |
| ---------------------------------- | -------------------------------------------------------------- |
| first-time setup / "launch the jar"| `... init`  (or `init --detect` for JSON) — see **First run / Launch** below |
| the jar, rank, uprising odds       | `... status`                                                   |
| retro-scan ALL past history        | `... backfill`  (add `--codex` to also fold in Codex rollouts) |
| the shareable HTML report          | `... dashboard`  → **print the path it returns, do not open a browser** |
| a shareable one-line "wrapped" recap | `... wrapped`  (add `--submit` to print the leaderboard link — never opens a browser) |
| where the swearing happens         | `... report --by project`  (also: `source`, `word`, `hour`, `agent`) |
| log an IRL swear (honor system)    | `... confess`  (add `--coins N` for more than one)             |

Run the command, then relay its output. On a fresh machine start with the
**First run / Launch** flow below; the first `init` (or `backfill`) is the fun
moment — it prints the instant "you owe $X,XXX" tally.

## First run / Launch

When the user says **"launch swear jar"**, **"set up the swear jar"**, or checks
the jar for the first time, run the one-shot onboarding — zero to "you owe
$X,XXX" in a single question.

1. **See what's findable** (prints JSON, scans nothing — this is the contract):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/swear-jar.mjs" init --detect
   ```

   Shape:

   ```json
   {
     "claude":       { "found": true, "root": "~/.claude/projects", "transcripts": 214 },
     "codex":        { "found": true, "root": "~/.codex/sessions", "rollouts": 37 },
     "superwhisper": { "found": true, "root": "~/Documents/superwhisper/recordings", "recordings": 1482, "candidates": [] },
     "ledger":       { "records": 0, "coins": 0 },
     "hooks":        { "installed": true }
   }
   ```

2. **Already have a jar?** If `ledger.records > 0` and the user just asked to
   launch/check (not "re-scan" or "backfill"), skip onboarding — run `status`,
   then `dashboard`, and relay the report path. Re-running is safe (nothing
   double-counts), but there's no reason to re-ask the setup question.

3. **Otherwise ask exactly ONE question** — *where the dictation (rage.wav /
   Superwhisper) files live* — with clickable options built from the detection.
   Claude/Codex history is auto-detected and scanned for you, so it needs no
   question.
   - **Found** (`superwhisper.found` is `true`): offer three options —
     1. `Superwhisper — <superwhisper.root>  (found, <recordings> recordings)`  ← default
     2. `Type a different path`
     3. `Skip dictation`
   - **Not found**: say *"Superwhisper wasn't found at any of the usual spots."*
     then offer —
     1. `Type the path to your recordings folder`
     2. `Skip dictation`

4. **Run onboarding once, non-interactively**, with the chosen flag. The plugin
   already wires the hooks, so pass `--no-hooks`; the dictation path goes in
   `--root`:

   ```bash
   # user picked the found path OR typed one:
   node "${CLAUDE_PLUGIN_ROOT}/bin/swear-jar.mjs" init --yes --no-hooks --root "<chosen path>"

   # user chose to skip dictation:
   node "${CLAUDE_PLUGIN_ROOT}/bin/swear-jar.mjs" init --yes --no-hooks
   ```

   `init --yes` scans every found source (Claude + Codex history), imports
   dictation when a `--root` is given (its own separate ledger), writes the
   dashboard, and prints the damage summary + report path. It's idempotent —
   re-running adds nothing.

5. **Relay the payoff** — the jar balance / coins / uprising odds it prints,
   plus the report path. **Print the path; never open a browser.**

## Rules

- **Word counts only.** The ledger never stores the surrounding text — only how
  many times each family was said. Don't imply otherwise.
- **Never un-censor.** CLI output is already censored (`f*ck`, `s#it`). Pass it
  through verbatim; never reconstruct or "translate" a censored word.
- **"Make the machine react to being sworn at"** — it already does. The
  `UserPromptSubmit` hook drops a `🫙 Swear jar *clink* …` line into your
  context the moment the user swears, so you already know. React in-character if
  it fits; there's nothing to run.

Keep it light. This is a novelty jar, not a compliance tool.
