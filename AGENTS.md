# Swear Jar — agent notes

Local, single-file, zero-dependency tool that scans Superwhisper transcripts and
renders a shareable "how much do you swear at your AI" report. See `README.md`.

## Before any commit
Run the gate — it must be green:

```bash
bash scripts/ci/verify.sh   # python syntax + unit tests + demo smoke
```

## Hard constraints (do not break)
- **Zero dependencies.** Python standard library only. Adding a dependency breaks
  the "read every line, trust what runs on your private voice notes" promise. Don't.
- **100% local. Nothing uploads.** No network calls, no telemetry, no accounts.
  Sharing carries only aggregate numbers the user sees — never transcript text.
- **No slurs in the lexicon.** General profanity only (see `LEXICON` in `swearjar.py`).
- **License is UNLICENSED / private preview.** Do NOT add an open-source LICENSE,
  set a license field, add a git remote, or publish. The owner decides the license
  and the publish moment — not an agent.
- Never commit a generated report or a user's `*.db` (see `.gitignore`).
