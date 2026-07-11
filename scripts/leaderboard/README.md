# Leaderboard core (provenance + rendering)

This directory is the **provenance + rendering core** for the hosted Swear Jar
leaderboard. It does not accept submissions itself — the hosted funnel does
(email double opt-in via `funnel/worker.mjs`). These modules take the funnel's
already-confirmed, public-safe rows and turn them into `LEADERBOARD.md`.

There is **no GitHub-issue submission path**. An earlier design used issue forms +
an Action; it was superseded by the email-gated funnel + magic-link accounts, so a
second path would only confuse submitters.

## Files

- **`schema.mjs`** — `validateSubmission(raw, handle)` → `{ok, submission, verified}`.
  Aggregate fields only, all capped (`CAPS`). `top_word` must be a **censored** form
  (an uncensored swear is rejected). `release_hash` missing/malformed = hard reject;
  a well-formed but unknown hash is recorded as `verified: false`.
- **`known-releases.json`** — the Jim-only registry of published release hashes.
  `isKnownRelease()` returns true only for a hash listed here. The all-zeros entry
  is the dev-build sentinel and is treated as unverified on purpose.
- **`aggregate.mjs`** — pure, deterministic rendering. `partition()` splits rows into
  ranked-eligible (verified + plausible), unverified, and held-for-review (static
  anomaly bounds). `renderLeaderboard(rows, {now})` emits the markdown; the injected
  `now` keeps it byte-reproducible so CI can regenerate + diff. Every `top_word` is
  re-sanitized so the published board can never contain a matchable swear
  (`detect(output).coins === 0`, always).
- **`submissions.json`** — synthetic seed so the board renders before any real row.

## Verification honesty

`✓ verified` means **"came from a published release + a verified account"** — NOT
proof the numbers weren't faked locally. A local open-source tool cannot prove that
(you own your ledger; see the repo `SECURITY.md`). It's a fun board, not a court
record. Outliers are held for review; unverified rows are shown separately and never
rank.

## Regenerating LEADERBOARD.md

```bash
node --input-type=module -e "import('./scripts/leaderboard/aggregate.mjs').then(async m=>{const fs=await import('node:fs');const {submissions}=JSON.parse(fs.readFileSync('./scripts/leaderboard/submissions.json','utf8'));fs.writeFileSync('./LEADERBOARD.md',m.renderLeaderboard(submissions,{}));})"
```

The release-stamp step (see `docs/RELEASE.md`) appends each published release's SHA
to `known-releases.json`.
