# Swear Jar — open-source unification plan (final Fable review, 2026-07-09)

Goal: one fun, viral, **accurate**, 100%-local, zero-dependency open-source app:
a swear jar for your AI coding sessions. This doc is the binding spec for the
unified v1; the two prior implementations feed it.

## Verdict: unify on Node, port the Python crown jewels

Canonical app = the **Node transcript-scanner** architecture (branch
`claude/swear-jar-evaluation-mov9si`), with the Python build's assets ported in.
Why Node wins under the new constraints (viral + max session data + open source):

- Every Claude Code user has the JS runtime by definition; `npx`-style install
  is the distribution channel this audience already trusts.
- The collector that gets "the most AI session data with the least effort" —
  transcript JSONL scanning with uuid dedup — is already built and tested there.
- One language for hook + CLI + dashboard rendering (the 30k HTML dashboard
  template is language-agnostic; its renderer is ~40 lines either way).

What gets PORTED from Python (`main`, preserved):

1. **The audited lexicon** — 25 families incl. elongations (`f+u+c+k`),
   compounds, British slang, and the hard-won negative guards (no god/jesus/suck,
   arse-not-arsenal, knob-alone excluded). Parity tests come with it.
2. **Insults + politeness counters** (separate from the headline swear number —
   keeps it honest; `--insults` folds them in).
3. **The HTML dashboard** (`report_template.html`) — hero stat = $ owed,
   rage-o-clock with rate line, censored share card. This is the viral surface.
4. **`--audit` trust tool** — print every surface form behind every tally.
5. **Superwhisper import** — as a clearly-labeled SEPARATE source (see below).

## Collection architecture (max data, no overcounting)

Collectors → one append-only JSONL ledger (`~/.swear-jar/ledger.jsonl`) → views.

- **claude** — hooks (UserPromptSubmit + Stop) scan session transcripts
  incrementally; **`swear-jar backfill`** retro-scans ALL of
  `~/.claude/projects/**/*.jsonl` on first run (measured on the founder's
  machine: 2,232 transcripts / 1.3 GB → the instant "you owe $X,XXX" moment).
- **codex** — same ledger, `agent: "codex"`; rollout files are
  `{timestamp,type,payload}` envelopes (860 files / 8 GB here) — lazy/optional
  backfill, own extractor.
- **superwhisper** — historical dictation import; measures a DIFFERENT thing
  (swears-per-dictation) and would double-count dictated prompts that also
  appear in transcripts, so it is **never summed into the jar by default** —
  it renders its own "dictation history" dashboard view.
- **confess** — manual honor-system coins.

### The no-overcount contract (all mechanically tested)

1. Record identity = transcript message **uuid**, never timestamps. Re-scans,
   duplicate hook fires, clock jitter, rewritten transcripts cannot double-count;
   identical repeat messages correctly count twice.
2. Skip `isMeta`, `isCompactSummary` (restates old swears), `isApiErrorMessage`,
   `isSidechain` (subagent chatter isn't the human).
3. **Strip injected blocks before detection**: `<system-reminder>…</system-reminder>`,
   `<command-name|command-message|command-args>`, `<local-command-caveat|stdout>`.
   Measured contamination on real data: 10/60 recent transcripts carry
   system-reminder text in user lines, 4-5/60 carry command output, 2/60 compact
   summaries. (Verified NOT present: CLAUDE.md injection does not persist into
   transcript user lines on current Claude Code.)
4. Only `text` content blocks are extracted — tool_results never counted.
5. Self-feed guard: the clink line is censored AND the scanner skips any text
   containing the jar marker.
6. Known accepted bias (it's a feature): when the assistant quotes your swear
   back, the machine pays — that's the royalty-clause game.

## Open-source hardening (keys + internal leakage)

- **Zero dependencies** and **zero network calls** are invariants, enforced in
  CI: `scripts/ci/verify.mjs` = tests + grep-fail on `fetch(`/`http.request` in
  src + dependency-count check.
- **Secret-scan gate** on tracked files (sk-ant-, sk_live_, AKIA, gho_, etc.).
- **Privacy invariant test**: feed a fixture transcript containing a fake API
  key + swears → assert ledger/state contain word counts only, never message
  text, never the key.
- **Share surfaces leak nothing**: exported/share outputs carry aggregate
  numbers only — no paths, no project names, no cwd (local terminal reports may
  show project names; anything shareable may not).
- **Scrub list** (verified by grep audit 2026-07-09):
  - Node `test/scan.test.mjs:25,37,55` — `/Users/jim/Code/signGen` → generic path.
  - Node `README.md:65` (signGen example), `README.md:91` (Bob the Skull) → generalize.
  - Node `docs/HANDOFF.md` — internal session notes: remove from public lineage.
  - Python `HANDOFF.md`, `AGENTS.md` internals, `docs/launch-plan.md` — never ship.
- **Fresh history at publish**: internal handoff docs exist in both git
  histories; the public repo gets a squashed clean initial commit at flip time.

## Jim-only acts (hard rule: no AI ever sets a license or makes a repo public)

1. Set the LICENSE (recommendation: MIT for maximum viral adoption) + update
   `package.json` `license`/`private` fields. Until then everything stays
   proprietary/private — the build proceeds regardless.
2. Flip the GitHub repo public (squash-republish at that moment).
3. npm publish decision + name check at publish time.

## Build order (v1 branch `claude/unified-v1`, rooted on the Node base)

1. Port lexicon + insults/politeness + parity tests.
2. Accuracy filters (strip/skip rules above) + tests.
3. `backfill` command (incremental offsets, progress line).
4. Scrub pass per list above.
5. CI guards (verify.mjs: tests + no-network + secret-scan + privacy invariant).
6. Dashboard port (render stats → `report_template.html`) + share card.
7. Codex adapter. 8. Statusline/digest/easter eggs (post-v1).

Roadmap after v1 (unchanged): agent leaderboard, per-repo frustration index
(coins/session normalized), daily digest, Wrapped, opt-in percentile service.
