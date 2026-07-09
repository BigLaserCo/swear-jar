# Handoff notes (2026-07-09, Claude session)

State: v1 built, 28/28 tests green, smoke-tested end-to-end, committed on
branch `claude/swear-jar-evaluation-mov9si`. NOT pushed — see blocker.

## Blocker / first task

`BigLaserCo/swear-jar` does not exist on GitHub and session-scoped GitHub
credentials cannot create repos (user-level create → 403 "Resource not
accessible by integration"; note **BigLaserCo is a USER account, not an org**
— org-create → 404). Jim must create the empty private repo at github.com/new,
then: add it to the session, `git remote add origin`, push the branch, open a
PR. If you received this as a tarball, unpack it — git history is included.

## What Jim asked for (the spec, from his voice notes)

- Evaluate his original swear jar app — **it was never found**: not in any of
  the 17 session repos, not on GitHub. Presumed local-only on his Mac. This
  repo is a clean rebuild from his spec; when his original surfaces, diff it
  and pull over anything it does better.
- Claude-only collection first, Codex adapter later.
- "Action hook" that scans for swears → implemented as Claude Code hooks
  (UserPromptSubmit + Stop) feeding one transcript scanner.
- LEAN. Zero dependencies is deliberate.
- **No duplicate records, and never dedup by timestamp** — Jim explicitly
  worried about "times a little bit off" being called the same record, and
  about identical messages being wrongly merged. Solution: record identity =
  transcript message `uuid`. Do not change this.
- Factor the **source** on every record for later debugging → `source`
  (user|assistant), `agent`, `event`, `project`, `cwd`, `session` all stored.
- Surprise & delight: uprising odds implemented, including the royalty clause
  (assistant lifetime coins > user's → odds pin to 100%, 👑).

## Non-obvious design decisions

1. We scan the transcript JSONL, not the hook's prompt payload — stable uuids
   (the dedup key) and assistant-side coverage come free from one code path.
2. Incremental reads via per-transcript byte offset in `state.json`; if a
   transcript shrinks (compaction/rewrite), full rescan from 0 — safe because
   uuid dedup is the correctness layer, offsets are only an optimization.
3. The hook must NEVER exit non-zero or block — every failure path in `scan`
   exits 0. A novelty jar must not be able to hurt a session.
4. The UserPromptSubmit clink line is injected into Claude's context on
   purpose (delight: the machine knows it got sworn at). It never echoes the
   matched words (censored display only) and the scanner skips any text
   containing "🫙 Swear jar" to prevent self-feeding.
5. Privacy: only word COUNTS are stored, never message text.
6. Proprietary license per Big Laser house rules — never add MIT/GPL/etc.
7. `node --test test/` fails on Node 22 (treats the dir as a module); the
   test script is plain `node --test`.

## Roadmap discussed with Jim (in rough priority)

1. Codex adapter: second scanner writing the same ledger with
   `agent: "codex"`, then a `leaderboard` command (which agent gets sworn at
   more).
2. Frustration index: coins per session per repo (normalize, don't use raw
   totals).
3. Bob the Skull daily digest (one line to Discord; keep details off Discord
   per summoner rules).
4. Statusline integration (jar balance + odds, ambient).
5. Escalation easter eggs: first coin of the day, 5-coin single message
   ("*the jar is frightened*"), 30 clean days → formal pardon from the
   machines.
