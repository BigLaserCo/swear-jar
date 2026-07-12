# SPEC — First-run onboarding, "launch swear jar", and the origin story

Status: approved for implementation · Milestone: onboarding-v1
Authored by the spec model; implemented by parallel implementation agents.
Each work package (WP) below is self-contained, has strict file ownership, and
lists its acceptance criteria. No WP may violate the **Invariants**.

---

## 1. Product name — decision

**Keep `Swear Jar` (— from Big Laser Co).** Rationale:

- The jar *is* the mechanic: coins, $0.25 each, `confess`, "empty your jar"
  donate, clink lines. Renaming orphans the entire economy metaphor.
- It's already shipped across every public surface (README, landing, plugin
  manifest, leaderboard, report header).
- Instantly legible + fun-not-serious, which matches the wrapped-style report
  ("cool fun AI metrics, not hardcore serious").

Sub-brands stay as-is and are *lanes*, not app names:

| Sub-brand | What it names |
| --- | --- |
| **Wrapped** | the shareable recap (`swear-jar wrapped`) and the report's share card |
| **rage.wav** | the dictation lane (Superwhisper import, separate ledger) |
| **Robot Uprising Survival Odds™** | the headline metric |

Alternates considered and rejected: `rage.wav` (names the tape, not the jar),
`Clink` (cute, zero findability), `AI Wrapped` / `Prompt Wrapped` (names one
screen; trademark-adjacent), `Potty Mouth` (juvenile). No code change needed.

---

## 2. The origin story (canonical copy)

This is the product's actual origin and it must appear on the public surfaces.
Canonical copy — public surfaces use the **censored** form (the `docs/*`
no-uncensored-language invariant is enforced by `test/site.test.mjs`, and
censoring our own origin story is exactly the product's joke):

> This whole thing exists because a computer crash ate a ten-minute dictation
> mid-thought. While digging for the corpse, I found out Superwhisper had been
> quietly saving **every recording and its transcription, locally, the whole
> time** — months of raw, unfiltered me-talking-to-AI. An absolute f\*\*\*ing
> gold mine. So I asked an AI to analyze how I talk to AI. I did not ask it to
> count the swearing. **It counted the swearing.** Out of everything in there,
> *that* was what it decided I most needed to know about myself.
>
> Fine. Jar's over there.

Placement (see WP3): top of `README.md` (right under the intro), a story
section on `docs/index.html`, and one footer line in the report template.

---

## 3. UX — the three doors, end to end

All three doors funnel into the same engine. The new piece is a **first-run
wizard** (`swear-jar init`) plus a **conversational launch** through the
plugin skill. Design goal: from zero to the "you owe $X,XXX" moment + the
wrapped report in **one command or one sentence**, with exactly one question
class asked along the way: *"where are your files?"* — pre-answered whenever
we can find them ourselves.

### Door A — GitHub clone / npx (terminal)

```sh
git clone https://github.com/BigLaserCo/swear-jar.git && cd swear-jar
node bin/swear-jar.mjs init
# or, zero-clone:
npx github:BigLaserCo/swear-jar init
```

The wizard (interactive TTY):

```
🫙 Swear Jar — first-time setup. Everything stays on your machine.

[1/4] Live hooks
      Wire the Claude Code hooks so every future swear pays in automatically?  [Y/n]

[2/4] Claude Code history
      Found ~/.claude/projects (214 transcripts). Scan it?  [Y/n]

[3/4] Codex history
      Found ~/.codex/sessions (37 rollouts). Scan it too?  [Y/n]

[4/4] Dictation — rage.wav (Superwhisper)
      Superwhisper keeps every dictation transcript at:
        ~/Documents/superwhisper/recordings    ← found, 1,482 recordings
      [Enter] use this   [p] type a different path   [s] skip
```

Not-found variants (the exact interaction Jim specced):

- Step 2/3 source missing → the step says `not found — skipped` and moves on
  (no dead-end questions about things we can't find and the user can't type).
- Step 4 missing → `Superwhisper not found at any of the usual spots.` then
  `Type the path to your recordings folder (Enter to skip): _`. A typed path
  that doesn't exist or contains no `*/meta.json` recordings re-prompts with
  `not found: <path>` (max 3 tries, then skip with a pointer to
  `swear-jar import-dictation --root <dir>`). `~` expands.

Then it runs everything it was told to, with the existing live progress
lines, and closes on the payoff:

```
🫙 The damage:
   Jar balance:   $312.75  (1,251 coins) — you 1,180 · the machine 71
   rage.wav:      213 swears across 1,482 dictations  (separate ledger)
   Uprising odds: 31%  — rank: Menace

   Full report:   ~/.swear-jar/report.html   (open it yourself — we never launch a browser)
```

### Door B — Claude Code plugin ("install directly in Claude")

```
/plugin marketplace add BigLaserCo/swear-jar
/plugin install swear-jar@biglaser
```

Hooks auto-wire (already true). The **skill** picks up onboarding: the first
time the user says **"launch swear jar"** (or "set up the swear jar", "check
the jar" with an empty ledger), Claude:

1. runs `init --detect` (machine-readable JSON, see §4) to learn what's
   findable and whether the ledger is empty;
2. asks ONE question with clickable options built from the detection —
   e.g. *"Where do your dictation files live?"* →
   `Superwhisper — ~/Documents/superwhisper/recordings (found, 1,482 recordings)` /
   `Type a path` / `Skip dictation` — the click-the-suggestion interaction,
   inside Claude's own UI;
3. runs `init --yes [--root <chosen>] [--no-hooks]` non-interactively;
4. relays the damage summary + the report path (never opens a browser).

### Door C — the browser app (`web/app.html`)

Unchanged this milestone (it already has its own folder-picker flow).
Future note only: a rage.wav drop-target could join it later; explicitly
**out of scope** here.

---

## 4. Work packages

### WP1 — `swear-jar init`: the first-run wizard  *(owner: files below, nothing else)*

**Files:** `src/init.mjs` (new), `bin/swear-jar.mjs` (wire the subcommand +
help text), `test/init.test.mjs` (new).

Behavior:

- `init` (alias `setup`) composes EXISTING modules only: `install()` from
  `src/install.mjs`, `backfill()` from `src/scan.mjs`, `scanCodexDir()` from
  `src/codex.mjs`, `importSuperwhisper()`/`defaultSuperwhisperRoot()` from
  `src/superwhisper.mjs`, `writeDashboard()` from `src/dashboard.mjs`,
  `computeStats()`/`renderStatus()` for the closing summary. No engine logic
  is re-implemented.
- **Detection helpers** (exported, pure-ish, unit-testable):
  `detectSources()` returns
  `{ claude: {found, root, transcripts}, codex: {found, root, rollouts},
     superwhisper: {found, root, recordings, candidates}, ledger: {records, coins},
     hooks: {installed} }`.
  Claude root: `~/.claude/projects`; Codex root: `~/.codex/sessions`;
  Superwhisper: the existing `CANDIDATE_ROOTS` walk. Counts are cheap
  directory counts, not full scans.
- **`init --detect`** prints that JSON to stdout and exits 0 — the skill's
  contract (WP2 consumes it; treat the shape as an API, test it).
- **Interactive mode** (TTY): the 4-step wizard from §3, built on
  `node:readline` — **zero new dependencies**. Each found source defaults to
  yes; each missing optional source is `not found — skipped`; Superwhisper
  missing → typed-path fallback with the `not found: <path>` re-prompt (≤3
  tries), `~` expansion, and validation = directory exists AND contains ≥1
  `<id>/meta.json`.
- **Non-interactive mode** (`--yes`, or stdin not a TTY): no prompts — wire
  hooks (unless `--no-hooks`), scan every FOUND source, skip missing ones,
  and print one line per skipped source with the flag that supplies it
  (`--root <dir>`, `--codex-root <dir>`). Flags: `--yes`, `--no-hooks`,
  `--root`, `--codex-root`, `--out` (dashboard path passthrough).
- **Idempotent / resumable:** safe to re-run; all dedup already lives in the
  ledgers. If the ledger is non-empty, open with the current jar balance
  ("Jar so far: $X — re-running is safe, nothing double-counts.").
- Ends by writing the dashboard and printing its path — **never** opens a
  browser (repo invariant). Ctrl-C mid-run must not corrupt anything
  (append-only ledgers already guarantee this — do not add cleanup handlers).

Acceptance:

- `node bin/swear-jar.mjs init --detect` → valid JSON, correct found/counts
  against fixture dirs (use `SWEAR_JAR_HOME` + temp fixture roots the way
  `test/superwhisper.test.mjs` does; detection roots must be overridable via
  params/env for tests without touching the real home dir).
- Non-TTY `init --yes` with fixture roots: scans, imports, writes dashboard,
  prints summary, exit 0; second run adds 0 records.
- Typed-path fallback: bad path → `not found` re-prompt; good path →
  imported (drive readline via stdin injection in tests).
- `npm test` and `node scripts/ci/verify.mjs` green. No new deps in
  `package.json` (there are none today; keep it that way).

### WP2 — "launch swear jar": skill-side onboarding  *(owner: `skills/swear-jar/SKILL.md` only; `test/plugin.test.mjs` only if it pins skill content)*

- Extend the skill's frontmatter `description` triggers: "launch swear jar",
  "set up the swear jar", "swear jar wrapped", "how much do I owe the jar".
- Add a **First run / Launch** section implementing §3 Door B, verbatim
  contract:
  - run `node "${CLAUDE_PLUGIN_ROOT}/bin/swear-jar.mjs" init --detect`;
  - if `ledger.records > 0` and the ask was just "launch/check" → skip
    onboarding, run `status` + `dashboard`, relay path;
  - else ask ONE multiple-choice question for dictation location (options
    from detection: found-path / type-a-path / skip; when not found, the
    first option is "type the path" and the copy says Superwhisper wasn't
    found at the usual spots);
  - then ONE non-interactive `init --yes …` call with the chosen flags;
  - relay the damage summary; print the report path; **never** open a
    browser, never un-censor, keep it light (existing Rules section stands).
- The command table gains `init` and `wrapped` rows.

Acceptance: `npm test` green (esp. `plugin.test.mjs`); SKILL.md stays
accurate to WP1's real flags/JSON (read `src/init.mjs` before writing);
no rule in the existing Rules section is weakened.

### WP3 — Origin story on the public surfaces  *(owner: `README.md`, `docs/index.html`, `docs/INSTALL.md`, `assets/report_template.html`)*

- **README.md:** add `## The origin story` directly after the intro
  paragraph, using §2 copy (censored form; markdown bold/emphasis kept).
  Also: add `swear-jar init` to the Commands block and make it the
  recommended first step in the Install section (one line each — the
  detailed wizard lives in code, not prose).
- **docs/index.html:** new story section (id `origin`), same censored copy,
  styled with the existing section/eyebrow/card patterns (match the file's
  current look; no new fonts/assets/network — the zero-network invariant is
  CI-enforced). Nav gains an `origin story` link. Keep the page's voice.
- **docs/INSTALL.md:** each install path's "then run" step becomes
  `init` (wizard) with `backfill` kept as the power-user alternative.
- **assets/report_template.html:** one footer line under the existing footer
  block: `born from a crashed 10-minute dictation and the f***ing gold mine
  it exposed` (small, muted, censored; no layout changes).
- Tone rule: the story is allowed to swear **in censored form** on every
  public surface — that's the brand joke. Never uncensored in `docs/*`
  (`test/site.test.mjs` enforces) or README.

Acceptance: `npm test` green (`site.test.mjs`, `dashboard.test.mjs`,
`pack.test.mjs`); `docs/index.html` renders correctly (visual check);
README reads clean top-to-bottom (init present, no duplicate sections).

---

## 5. Invariants (every WP, non-negotiable)

1. **Zero dependencies.** Node stdlib only; `package.json` gains nothing.
2. **Local-only.** No network calls anywhere in this milestone; `docs/*` and
   `web/*` stay zero-request (CI-enforced).
3. **Word counts only.** Nothing in this milestone stores or prints
   transcript text beyond what already exists.
4. **Never auto-open a browser.** Print paths.
5. **Censored by default** on every public/shareable surface.
6. **Hook safety.** Nothing here may make `scan` exit non-zero or slow it
   down; `init` is never called from hooks.
7. **Separate ledgers stay separate.** `init` reports rage.wav numbers in
   its summary text but never sums them into the jar balance.
8. **License `UNLICENSED`**; no copied-in third-party code.

## 6. Out of scope (recorded so nobody "helpfully" adds them)

- Superwhisper/rage.wav mode in `web/app.html` (future).
- Leaderboard/funnel changes — none.
- New metrics or report sections — none (origin footer line only).
- Windows path candidates for Superwhisper — typed-path fallback covers it.
