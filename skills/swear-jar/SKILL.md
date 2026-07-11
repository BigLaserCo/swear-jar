---
name: swear-jar
description: Operate the local swear jar — the running tally of every time the user (or the machine) swears in a Claude Code / Codex session, and their Robot Uprising Survival Odds. Use when the user asks to check the jar, see how much they owe, backfill their history, render the dashboard, break the swearing down by project/source/word/hour/agent, or confess an IRL swear.
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
| the jar, rank, uprising odds       | `... status`                                                   |
| retro-scan ALL past history        | `... backfill`  (add `--codex` to also fold in Codex rollouts) |
| the shareable HTML report          | `... dashboard`  → **print the path it returns, do not open a browser** |
| where the swearing happens         | `... report --by project`  (also: `source`, `word`, `hour`, `agent`) |
| log an IRL swear (honor system)    | `... confess`  (add `--coins N` for more than one)             |

Run the command, then relay its output. The first `backfill` is the fun
moment — it prints the instant "you owe $X,XXX" tally.

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
