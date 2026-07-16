# Swear Jar handoff: AI favorability / kindness persona

Date: 2026-07-15  
Repository: `/Users/jim/Code/swear-jar`  
Production: https://swearjar.unfocused.ai/  
Source: https://github.com/BigLaserCo/swear-jar

## Current production state

The current release is live from commit `7ba5eac` (`fix(uprising): make one percent the true floor`). It includes:

- A true 1% robot-uprising odds floor; 1% is labeled `cower`.
- No “kept alive for entertainment value” wording.
- Numeric upper rank thresholds (`9,000` and `10,000`) and numeric `next at` wording.
- The combined `Rage timeline + rage-o-clock` visualization with axes, hover values, and normalized swear-frequency overlay.
- Local report generation, explicit aggregate-only sharing, social-card sharing, GitHub links, footer links, demo/sample labeling, and the local install/uninstall flow.

Verification completed before handoff:

- `npm run verify`: 310 tests passed.
- Site deployed successfully with HTTP 200 at the production URL.
- Production demo browser check confirmed 1%, `cower`, no entertainment wording, numeric next-rank wording, and the combined timeline/clock section.

Do not modify or delete these unrelated untracked user-owned paths without explicit direction:

```text
.company-os/
dist/
reports/
```

## The clarified product idea

The next idea is not a collection of arbitrary personality badges. The report should answer a more interesting question:

> How favorable does the AI view you right now?

Swear damage and user treatment are related but not identical. Someone may swear frequently while still saying “please” and “thank you,” making them high-damage but relatively favorable. Another user may swear less but constantly call the assistant stupid or useless, making them lower-damage but more hostile.

The product should therefore measure two related dimensions:

1. **Damage / frustration:** the existing swear-jar dollar and damage model.
2. **AI favorability:** how kind or hostile the user is toward the AI.

The current “Gold Star” behavior is only an early prototype of this idea. It should not be treated as the finished persona system.

## Existing implementation to build on

Relevant files:

- `src/detect.mjs`
  - `POLITE` currently detects `please`, `thanks`, `sorry`, and `appreciate`.
  - `INSULTS` currently detects `stupid`, `idiot`, `moron`, `dumb`, `lame`, `useless`, `pathetic`, and `garbage`.
- `src/scan.mjs`
  - Stores word-count metadata only; it does not store raw transcript text in the report payload.
  - Stores `polite` counts alongside ledger records.
- `src/stats.mjs`
  - Computes `politeTotal` and the current `goldStar` boolean.
  - Important: the current manners tally sums polite counts across all records, including assistant records. The new favorability metric should be based on the user's messages only.
- `assets/report_template.html`
  - Renders the current Gold Star state in the hero/uprising area.
  - The new UI should extend the existing report rather than duplicate the entire damage report.
- `test/detect.test.mjs`, `test/stats.test.mjs`, `test/scan.test.mjs`, and `test/render-status.test.mjs`
  - Existing coverage for polite and insult detection, record storage, Gold Star behavior, and backward compatibility.

## Recommended design direction

Keep the swear jar as the damage report and add a paired, clearly labeled **AI favorability** section. Do not replace the existing damage total or create a second full report page.

The section should show:

- A favorable/hostile score or meter.
- A plain-language rank.
- A short deterministic explanation based on aggregate counts.
- The underlying counts used to calculate it, so engineers can audit the result.

Candidate rank language (to be finalized):

- Beloved Operator
- Respectfully Chaotic
- Firm but Fair
- Difficult Customer
- Hostile Work Environment
- Priority Target

These are examples only. Avoid implying that an LLM judged the user. The result should be deterministic, local, testable, and derived only from counts.

## Important scoring rules to resolve before implementation

1. Count politeness from `source === "user"` only.
2. Count insults from user messages separately from profanity. Insults should affect favorability more strongly than ordinary swear words.
3. Keep damage pricing and swear counts unchanged. A “please” should not erase a dollar from the jar.
4. Preserve the privacy boundary: store and transmit counts only, never sentences, prompts, recordings, or transcript paths.
5. Decide how neutral users score. A user with no polite words and no insults should not automatically be treated as hostile.
6. Decide whether favorability is the report headline or an equal companion to the damage result. The current recommendation is equal companion metrics, with the report framing expanded from “how frustrated are you?” to “how do you treat the AI, and how does it view you?”

## Suggested implementation shape

Prefer a small pure function in `src/stats.mjs` or a focused new module that accepts aggregate user-only counts and returns a stable result, for example:

```js
{
  score: 0..100,
  rank: "Firm but Fair",
  politeTotal,
  insultTotal,
  swearTotal,
  explanation
}
```

Do not use an AI call or generated prose for the scoring. Keep the explanation selected from deterministic templates. Add unit tests for:

- polite-heavy user history;
- swear-heavy but polite user history;
- insult-heavy user history;
- neutral/no-signal history;
- assistant politeness not changing the user's favorability;
- legacy ledgers without `polite` or `insult` fields;
- stable rank boundaries and no transcript leakage.

Then add report-template tests and regenerate `docs/demo.html` so the public sample visibly demonstrates the new two-dimensional framing. Run `npm run verify`, deploy with `DEPLOY_HOST=biglaser ./scripts/deploy-site.sh`, and complete Omega verification against the production route.

## Scope guard

This is a persona/report interpretation layer only. Do not add a new backend, leaderboard field, account flow, transcript storage, language system, or new collection mechanism for this feature. The goal is to make the existing aggregate data tell the more compelling story: not simply whether the user is angry, but whether the user is kind, demanding, hostile, or surprisingly beloved by the machine.

## Resume checklist

- [ ] Confirm whether favorability is equal to damage or becomes the primary headline.
- [ ] Finalize rank names and score boundaries.
- [ ] Change manners/insult aggregation to user-only for favorability.
- [ ] Add the pure scoring function and tests.
- [ ] Add the paired UI section and deterministic explanation.
- [ ] Regenerate the clearly stamped sample report.
- [ ] Run `npm run verify`.
- [ ] Deploy and verify https://swearjar.unfocused.ai/ in the browser.
