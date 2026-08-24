# AI Swear Jar Share and Result Design

- Date: 2026-08-24
- Status: Approved direction; implementation pending
- Scope: Public landing page, browser measurement flow, result comparison, share artifact, and one-dollar-per-swear rule

## Outcome

Swear Jar must answer one question immediately:

> **AI Swear Jar**
>
> **How much do you swear at AI?**

A visitor can measure their own Claude Code history in the browser, see a literal comparison between the number of times they swore at AI and the number of times they were nice to AI, and share one platform-safe result. The share earns the click; the result page may then introduce SetupYourAI and Big Laser.

The primary experience must not lead with installation commands, weighted damage points, tier pricing, uprising odds, or technical implementation language.

## Landing Page

The hero uses this copy:

- Brand: `AI Swear Jar`
- Heading: `How much do you swear at AI?`
- Supporting line: `Find out how often you swear at AI—and how often you’re nice to it. Open source.`
- Primary action: `Measure mine`
- Secondary action: `See an example`

`Measure mine` opens the real browser scanner at `/app/`. GitHub installation, CLI usage, and detailed privacy explanation move below the primary browser path.

The sample beside the hero previews the same two-count comparison used in a real result. It does not show imaginary debt, weighted coins, a machine-versus-human percentage, or uprising odds.

## Browser Measurement Flow

The existing browser scanner is not presently part of the deployed static site. The shippable flow therefore includes a deterministic `scripts/site/buildBrowserApp.mjs` build. The canonical sources remain `web/app.html` and `web/browser-scan.mjs`; the builder writes `docs/app/index.html`, `docs/app/browser-scan.mjs`, and exact copies of the required browser-safe modules (`detect`, `odds`, `render`, `sharecard`, `stats`, and `version`) under `docs/src/`. Parity tests fail if a generated file drifts from its canonical source. The existing docs-only deployment can then publish `/app/` without a second deployment path.

The dormant leaderboard upload control and its schema import are removed from the browser app in this release. They add a module and a dead control to a flow that explicitly does not require an account or upload.

The browser scanner must mirror the CLI scan semantics needed by this feature:

1. Read only files the visitor explicitly selects.
2. Detect literal swear instances with the canonical swear detector.
3. Detect positive instances with the canonical positive detector.
4. Preserve eligible human records that contain kindness but no swears.
5. Feed the resulting aggregate-only records into the canonical stats computation.
6. Render `userSwears` and `kindActs`; never derive the displayed counts from weighted coins or kindness credits.

The page must continue to make no automatic upload. Sharing happens only after an explicit user action.

The browser app should say plainly that the initial scanner supports Claude Code history. The broad headline must not imply support for chat-history formats the app cannot yet read.

## Unified Comparison Chart

The result begins with one comparison module. It is reused in the browser result, both local report modes, the sample report, and the generated share card.

It contains:

- `I have sworn at AI` with the exact `userSwears` count.
- `I have been nice to AI` with the exact `kindActs` count.
- Two horizontal bars using the same scale: `max(userSwears, kindActs, 1)`.
- Exact counts as text with thousands separators. Percentages and ratios are not shown.
- One verdict derived from those same two counts.

The existing Manners Ratio bars are the implementation model. No chart library is added.

### Verdict states

| Condition | Verdict | Visual state |
| --- | --- | --- |
| `kindActs > userSwears` | `HOLY GOODY TWO-SHOES` | Light/gold kindness treatment; no swear-mode verdict or decoration |
| `userSwears > kindActs` | `YOU SUCK` | Dark/ember swear treatment; no angel, gold star, or kindness-mode decoration |
| Equal nonzero counts | `DEAD EVEN` | Neutral treatment; neither exclusive verdict or decoration |
| Both counts are zero after eligible messages were scanned | `NO SIGNAL` | Neutral empty state; sharing is disabled |
| No eligible human messages were found | No verdict | Folder-selection error; sharing is disabled |

The strict winner rule prevents a tie or empty history from receiving the angel state.

## Mode Coherence

Damage and kindness may remain as optional deep-dive views, but they no longer compete as separate share stories.

- Both modes render the same unified comparison module and the same primary share artifact.
- Damage mode does not apply Gold Star or angel styling to its hero.
- Kindness mode does not offer a separate damage card.
- Damage mode does not offer a separate kindness card.
- The verdict appears once in the comparison module and controls only that module's theme.
- The default deep-dive view may follow the dominant count, but the user can still inspect the other data without receiving a second personality verdict.

## Share Card

There is one canonical 1200-by-675 share card. It contains only:

- `AI SWEAR JAR`
- `I have sworn at AI {swears} times.`
- `I have been nice to AI {nice} times.`
- The two-bar comparison chart.
- The single applicable verdict.
- `Want to know how you measure up?`
- `swearjar.unfocused.ai`

It must not contain money, debt, weighted coins, damage points, a favorite swear, spelled or censored profanity, hashtags, percentages, ratios, uprising odds, upload explanations, paths, identities, or raw conversation text.

The share card can use the applicable verdict's visual state, but both counts remain equally legible. Color and bar length supplement the text; they never replace it.

## Share Copy

The copied and native-share text is exactly:

> I used the open-source AI Swear Jar and found out I have sworn at AI {swears} times.
>
> On the other hand, I have been nice to AI {nice} times.
>
> Want to know how you measure up?
>
> https://swearjar.unfocused.ai

No extra sentence, hashtag, privacy narration, technical explanation, joke, profanity, or business promotion is appended.

The primary action is `Share my result`. The secondary action is `Copy post`. Native sharing attaches the generated PNG when supported. Clipboard/download fallbacks must describe what actually happened and never claim a post was published automatically.

## Dollar Rule

Money is not shown in the primary share card or post.

Anywhere the product retains a dollar figure, one literal swear instance equals one dollar. A displayed personal balance uses the human swear count. A displayed combined jar total uses the combined swear count. Severity tiers may remain as a separate novelty or ranking system, but they do not change dollar value and must not be labeled as literal swear counts.

Existing ledgers are repriced from their stored word-family counts, so old tiered dollar values do not survive into a new report.

Kindness remains a count for this comparison. Kindness credits may remain as a secondary novelty metric, but they are not money and do not reduce the jar balance.

## Maker Bridge

The social card and post stay focused on the user's result. Directly below the onsite result/share controls, use this compact bridge:

> Want AI to work better for your business? Visit SetupYourAI.
>
> Built in the Big Laser workshop.

The SetupYourAI action is primary. The Big Laser attribution is secondary. Neither is injected into the copied social post.

## Error and Empty States

- Unsupported or unreadable files do not sink the whole scan; the page reports how many eligible files/messages were found.
- A folder with no eligible Claude Code messages returns a clear folder-selection error and no share action.
- A valid history with zero detected swears and zero detected kindness shows `NO SIGNAL` and no share action.
- A share-image generation failure falls back to copying the exact post text and offering a card download.
- A denied or dismissed native share does not claim success.
- No network, account, leaderboard, or email requirement is introduced into the measurement path.

## Accessibility and Responsive Behavior

- Both labels and counts are real text.
- The comparison is a labeled figure or image role whose accessible name includes both counts and the verdict.
- Decorative bar fills are hidden from assistive technology.
- The two result rows stack cleanly on narrow screens.
- Buttons preserve visible keyboard focus.
- Existing reduced-motion behavior remains intact.
- The exported card preserves generous safe margins at 1200 by 675.

## Verification

Implementation follows red-green-refactor:

1. Add failing tests for the landing copy and real `/app/` artifact.
2. Add failing browser-scan parity tests proving kindness-only human messages survive and produce `kindActs`.
3. Add failing canonical-card tests for both counts, the bars, each verdict, tie handling, and forbidden content.
4. Add failing caption tests that pin the exact approved text across the browser app and both report templates.
5. Add failing pricing tests proving every swear family is one dollar per instance.
6. Implement the smallest changes that turn each test green.
7. Regenerate and parity-check the browser app and public sample reports.
8. Run the full test suite and the public-repository verification gate.

Omega requires four controlled browser histories: swear-dominant, kindness-dominant, tied, and zero-signal. For each, exercise the real folder-selection flow, inspect the desktop and mobile result, inspect the exported PNG, and verify the exact copied post. The deployed `/app/` must be identified by its scanner-specific title/content and exercised with a synthetic folder; HTTP 200 alone is not proof because the current Caddy fallback returns the homepage for unknown routes.

## Non-Goals

- Supporting every consumer AI transcript format in this release.
- Accounts, automatic posting, a public leaderboard, email gating, or paid promotion.
- A multi-band personality spectrum or additional verdict jokes.
- A new charting dependency.
- Rewriting the detector lexicons or the deeper novelty analytics beyond the one-dollar rule.
