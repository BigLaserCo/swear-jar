# WEBSITE PLAN — the Swear Jar site (scoreboard · setup · usage · tip)

Status: PLAN ONLY — approved direction, implement in a later milestone.
Owner site identity: **Big Laser Co** (per the shipped brand decision).
Swear Jar is **one of many apps** — the plan covers both the product site and
the thin "apps hub" on the parent site.

## 1. The one-sentence job of the site

A visitor lands, sees the live scoreboard and a real demo report, understands
in ten seconds that this is a **local, no-AI, nothing-uploaded** toy with real
numbers, copies ONE command, and leaves with the founder credited and the tip
link one click away.

## 2. Site map — swearjar.biglaser.co (the product site)

All static, served from this repo's `docs/` by GitHub Pages (custom domain
CNAME). The zero-external-request + censored-language invariants stay
CI-enforced on every page.

| Path | Page | Status |
| --- | --- | --- |
| `/` | Landing — hero funnel (see §4), origin story, demo preview card | exists; needs the §4 funnel reorder |
| `/leaderboard.html` | **The scoreboard** — top jars, verified badges, "get on the board" CTA | new |
| `/setup.html` | Install — the one funnel, all four doors in priority order | new (content exists in INSTALL.md; make it a page) |
| `/how-it-works.html` | Usage + privacy: commands, what's counted, what never leaves the machine, no-AI statement | new |
| `/tip.html` | The tip jar (indirection page — the one place the payment target lives) | in flight (monetization-v1) |
| `/demo.html` | Synthetic demo report | exists |
| `/submit.html` | Leaderboard submit (the ONLY data-touching page) | exists |

## 3. The scoreboard page (the site's centerpiece)

- **Data source:** the existing repo-side aggregate (`scripts/leaderboard`,
  `board.json` → rendered `LEADERBOARD.md`). Add a `scripts/site/buildLeaderboard.mjs`
  (same pattern as `buildDemo.mjs`: deterministic, reads `board.json`, writes
  `docs/leaderboard.html`). **No client-side fetch** — the page is regenerated
  and committed whenever the aggregate updates, so the zero-request invariant
  holds and the page is honest about its "as of <date>" freshness stamp.
- Columns: rank · handle · $ owed · coins · f-bomb % · censored top word ·
  uprising odds · ✓ verified badge (release-hash provenance, with the honest
  "verified ≠ can't-be-faked" footnote linking SECURITY.md).
- Empty state (pre-launch): seeded synthetic board (exists) with a loud
  "synthetic seed — be the first real jar" banner.
- CTA block: "Think you can beat this? One command:" + the npx one-liner.

## 4. Landing funnel (reorder of existing `/`)

Priority order — ONE golden path, alternates demoted:

1. **Hero:** "One command. Nothing leaves your machine. No AI." →
   `npx github:BigLaserCo/swear-jar init` → "your report opens with your
   damage. Terminal only — this tool doesn't need an AI to judge you."
2. **Second block — "Live in Claude Code?":** the two `/plugin` commands +
   "then just say *launch swear jar*". Positioning: optional convenience wrapper;
   the skill RUNS the real CLI (never simulates output).
3. **Scoreboard teaser:** top-3 rows inline + link to `/leaderboard.html`.
4. **Origin story** (shipped) + demo report link.
5. **Footer row ("other ways in"):** git clone · web app (`web/app.html`) ·
   uninstall honesty ("one command, your ledger stays yours").

## 5. Credit + money (non-negotiable, every page and every surface)

- **Every page footer:** "Made by Jim — Big Laser Co. · This is our jar:
  [tip link]" — the credit and the tip travel together, on every page, plus
  the report footer and the CLI tip lines (monetization-v1).
- The tip flow is always: any surface → `/tip.html` → the real payment target
  (one-line swap on one page; no CLI re-release ever needed).
- Attribution audit item (integration pass): report header/footer, wrapped
  share caption, README, plugin manifest — each must carry the Big Laser Co
  credit visibly, not just in metadata.

## 6. The apps hub (parent site — swear-jar is one of many)

- `biglaser.co/apps` (or an `apps.` subdomain — parent-site decision): a thin
  static index — card per app (name, one-liner, screenshot, link out). Swear
  Jar's card links to swearjar.biglaser.co. No shared runtime, no coupling;
  each app site stays independently deployable.
- This hub is OWNED BY THE PARENT SITE's repo/deploy, not this repo — this
  plan only reserves the card copy: "Swear Jar — your AI sessions owe you
  money. Local, no AI, nothing uploaded."

## 7. Messaging rules (site-wide)

- **No-AI stance, stated plainly:** "No AI calls. No cloud. No account. A
  plain local program counts words on your machine." This is a headline
  feature, not fine print.
- **You run it** — copy is imperative ("run this, see your damage"), never
  "ask Claude to…" as the primary framing.
- Data collection honesty: exactly one page (`/submit.html`) touches data,
  only aggregate numbers, only on the user's click; say so everywhere it's
  relevant.
- Censored language only (CI-enforced); the censorship IS the joke.

## 8. Implementation notes (for the later milestone)

- Everything ships as `docs/*` static pages regenerated by `scripts/site/*`
  builders (deterministic, seeded, no network at build). Extend
  `test/site.test.mjs` to cover new pages automatically (glob `docs/*.html`
  — it already does; new pages inherit the invariants).
- DNS/hosting: Pages custom domain `swearjar.biglaser.co`; the Cloudflare
  Worker keeps only the submit/API route. Turning on Pages + DNS is a
  repo-owner (Jim) launch act.
- Nav component is copy-paste per page (static, no build system) — keep the
  header/footer identical via the builders, not by hand.
- Milestone slicing when implemented: (a) leaderboard builder + page,
  (b) setup/how-it-works pages + landing funnel reorder, (c) apps-hub card on
  the parent site. Each independently shippable.

## 9. Out of scope for this plan

- Accounts/auth on the site beyond the existing submit flow.
- Any analytics/tracking (never — it would kill the trust story).
- Per-user profile pages on the scoreboard (future maybe; needs a privacy
  pass first).
