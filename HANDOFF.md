# Swear Jar — Handoff (2026-07-06)

Local, zero-dep tool that scans a user's **Superwhisper** dictation history +
(new) live Claude Code/Codex prompts, counts how much they swear at their AI, and
renders a shareable "damage report." Repo: `~/Code/swear-jar` (git `main`, **no
remote** — not published; UNLICENSED private preview). Run: `python3 swearjar.py
--open`. Gate: `bash scripts/ci/verify.sh` (21 tests, green). Everything below is
COMMITTED unless marked otherwise.

## Architecture (v0.2, OSS-clean split)
- `swearjar/lexicon.py` — word lists + counting (pure; the audited source of truth)
- `swearjar/engine.py` — scan Superwhisper → local SQLite (`~/.swearjar/swearjar.db`) → stats; `audit_forms()`
- `swearjar/render.py` — stats → self-contained HTML; auto-embeds `docs/logo.png` as data-URI (emoji fallback)
- `swearjar/cli.py` — CLI (`--open/--demo/--reset/--insults/--audit/--donate-url`); Superwhisper folder auto-detect + prompt
- `swearjar/hook.py` — **UserPromptSubmit capture hook** (see below)
- `report_template.html` — the report (hero jar, rage-o-clock w/ rate line, leaderboard, you-vs-founder PER-DAY, fine-print facts, censor toggle, donate section)

## DONE + verified
- **Accuracy overhaul** (Jim's #1 demand): removed non-swears (god/jesus/suck); compounds caught (clusterfuck/motherfucker/dipshit); killed false positives (`arse`≠arsenal; div/git/count guarded by tests). `--audit` prints every counted word → **0 false positives** on real data. Real numbers: **~4,300 swears / ~63/day**.
- **Rage-triggers REMOVED** — door/hanger "makes you snap" was spurious correlation; deleted (don't rebuild without a real method).
- **Censor toggle** (🙈 default ON) — shared cards show `f***`.
- **Donation button LIVE** — Stripe "customers choose what to pay" link `https://donate.stripe.com/eVq00jb7zeEQ8zlbecg7e03` baked into `DONATE_URL` (cli.py). Verified HTTP 200.
- **Capture hook** (`swearjar/hook.py`) — reads the prompt, counts swears via the same lexicon, appends `{ts,word,source,session}` to `~/.swearjar/live-events.jsonl`, **exits silently → ZERO token cost** (verified in CC + Codex docs). 2s debounce. Tags source `claude-code` (field `user_input`) vs `codex` (field `prompt`) — **one hook, both clients**. Guard test asserts empty stdout.
- **Claude Code hook INSTALLED** into `~/.claude/settings.json` UserPromptSubmit (backup: `~/.claude/settings.json.bak-swearjar-*`; command `PYTHONPATH=/Users/jim/Code/swear-jar python3 -m swearjar.hook 2>/dev/null || true`). Additive; existing hooks untouched.

## OPEN — pick up here (priority order)
1. **LIVE-VERIFY the Claude Code hook (Jim's HARD GATE — do NOT call done until proven).** The hook is installed but NOT yet confirmed against a real prompt. `~/.swearjar/live-events.jsonl` was cleared. Have Jim send a message containing a swear, then check that file for a fresh `"source":"claude-code"` event. NOTE: unknown if CC hot-reloads hooks mid-session or only on a new session — verify honestly, say which.
2. **Install + live-verify the Codex hook.** Verified: Codex has the same `UserPromptSubmit` hook in `~/.codex/config.toml` (JSON stdin, prompt in `prompt`, exit-0-silent=free; docs: developers.openai.com/codex/hooks). Confirm the exact `config.toml` `[hooks]`/hooks.json TOML syntax BEFORE editing (don't break his Codex config), install the same command, then live-verify a real Codex swear lands as `"source":"codex"`. Bonus history path: parse `~/.codex/sessions/**/rollout-*.jsonl`.
3. **Wire the merge** — engine should read `~/.swearjar/live-events.jsonl` alongside Superwhisper and add those swears to totals/by-hour/by-day/leaderboard, **deduped by timestamp (~couple seconds)** so a dictated prompt seen by BOTH Superwhisper and the hook counts once (Jim's "at least a couple seconds apart"). Not built. Best done once real events flow.
4. **Connect-source wizard (Jim's last idea, DON'T over-build).** He wants least-friction source selection. Concern: a *website* picking a local folder is a security smell (browser File System Access API exists in Chrome but he's wary). RECOMMENDATION: keep it a **local** tool (folder access is fine locally) — a "Connect a source" step that shows which sources are supported (Superwhisper now; Claude Code/Codex via hook), auto-detects Superwhisper's path (already done in `cli.find_recordings`), and if not found opens Finder to the likely dir (`open ~/Documents/superwhisper` or the Desktop) with a one-line "it's usually here" hint. He said "I don't want to spend too much time on this app" — keep it thin.
5. **Logo** — Jim prefers HIS drawing (a jar-robot mascot he pasted; NOT on disk — CC keeps pasted images in-conversation). Mechanism wired: drop it at `~/Code/swear-jar/docs/logo.png` and render.py auto-embeds it (header + README swap from 🫙). My SVG was rejected/removed.
6. **License decision (Jim-only, per master rule).** He keeps calling it "the open-source project" — strongly leaning OSS, but has NOT explicitly said MIT/Apache. Do NOT set a license on inference; get his explicit word, then add LICENSE + set package license. This is the last blocker before publishing.

## Key facts / lessons (don't relearn the hard way)
- **The cunt undercount is NOT a bug — it's off-mic speech.** Superwhisper only records ACTIVE dictation. Proven: installed whisper.cpp, re-transcribed the audio; medium.en catches 88% of KNOWN cunts but found 0 in a day where Jim said it ~10× → those were said off-mic, never recorded. Don't "fix" the count from text (risks false positives). The capture hook (#1-3) is the real fix for *typed* swears (text, so cunt is caught 100%).
- **`result` == `rawResult`** in Superwhisper meta.json for swears (LLM cleanup doesn't strip them) — no field-level recovery.
- **MASTER RULE added** (`~/Code/CLAUDE.md`, ELE-499): *do your homework — verify facts (docs/run/read) before advising, never present a guess as fact.* I burned Jim's time twice guessing Stripe's UI. Honor this hard.
- **Competitive check (done):** swear-counting apps are crowded (all "stop swearing" self-help); `superwhisper-analysis` (GitHub) mines SW history for *productivity* + is share-optimized but does NOT do swearing. Jim's exact angle (swear-AT-AI confession as viral artifact) is unoccupied, but the mechanic is easy to clone → the edge is speed + brand + the viral moment, not a moat.
- Jim's asks trend: accuracy above all; least friction; don't waste his time; do the work don't hand him homework.

## Reverting the hook install (if needed)
`cp ~/.claude/settings.json.bak-swearjar-* ~/.claude/settings.json` (newest backup).
