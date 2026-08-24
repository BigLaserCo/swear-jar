# Omega proof — ELE-010 AI Swear Jar sharing

## User-visible outcome

The public browser app now answers the product question, “How much do you swear
at AI?”, compares literal human swear instances with human kindness acts on one
shared-scale chart, selects one postable verdict, and produces one unified social
card and one platform-safe caption. The result page also carries optional links
to SetupYourAI and Big Laser; neither promotion is added to the shared post.

## Browser Omega

The staged `/app/` route was exercised through the real folder-picker flow with
four committed JSONL fixtures:

- swear-heavy: `1` swear, `0` nice, mouth verdict, sharing visible;
- kindness-heavy: `0` swears, `1` nice, goody-two-shoes verdict, sharing visible;
- tie: `1` swear, `1` nice, dead-even verdict, sharing visible;
- zero signal: `0` swears, `0` nice, no verdict card or share controls, retry visible.

The Copy post action was read back from the browser clipboard and matched the
approved four-paragraph caption. Download card produced a real PNG with the
canonical SVG renderer at `1200 × 675`. The swear-heavy result was inspected at
desktop and mobile viewports. The SetupYourAI and Big Laser links were present,
the browser console was clean, and no transcript upload or automatic network
request occurred.

## Automated verification

- `env NODE_OPTIONS=--test-isolation=none npm run verify` — passed: 450 tests,
  no unauthorized network path, zero runtime dependencies, no secret pattern,
  no internal-code leak, no internal-document leak, public claims green, MIT
  license audit green, and the raw-text privacy invariant green.
- Company-in-a-Box public-repo gates — green: leak, claims, secret, and license
  gates all present.
- Public remote guard — green for `BigLaserCo/swear-jar` under `ELE-382`.
- Independent Terra review — no actionable findings after canonical-card,
  zero-signal, and metadata corrections.

## Boundary

This is local rendered acceptance proof for the exact staged public artifacts.
It does not claim the release train has landed the branch or that production has
been updated; those remain release-train and post-deploy verification steps.

VERDICT: LAND — the share flow is internally consistent, privacy-safe, postable,
and verified through the affected browser paths.
