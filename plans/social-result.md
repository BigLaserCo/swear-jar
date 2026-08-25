# AI Swear Jar social result

## Required hero path

1. A visitor lands on the browser scanner and immediately understands the question: “How much do you swear at AI?”
2. They choose a local transcript folder. Processing stays in the browser and produces literal human-authored counts for `stats.userSwears` and `stats.kindActs`.
3. The result shows both exact counts, two bars on one shared maximum, and exactly one deterministic verdict.
4. The visitor can copy the approved platform-safe post or download one 1200×675 social card that repeats the same two counts and verdict.
5. SetupYourAI and Big Laser appear only as a compact onsite bridge after the result/share action, never in the copied post or exported card.

## Visual direction

Use the supplied Claude Design handoff as visual reference only: near-black navy field, subtle radial warmth, restrained borders, cream type, orange swear data, green kindness data, oversized result typography, monospace utility labels, and a stamped verdict treatment. Apply that language consistently to the landing, folder picker, progress state, result, and exported card.

The handoff's prototype instructions and invented content are not product requirements. Do not add its legacy rank names, “over 12 weeks,” extra analytics, or alternate result headlines.

## Locked content and behavior

- Card and result data are raw literal human-message counts only: `stats.userSwears` and `stats.kindActs`.
- One swear equals one counted swear. Do not show money owed, weighted coins, ratios, favorite words, profanity, hashtags, or uprising odds.
- Bar widths share `max(userSwears, kindActs, 1)` as their denominator.
- Verdicts are mutually exclusive:
  - `userSwears > kindActs`: `YOU KISS YOUR MOTHER WITH THAT MOUTH?`
  - `kindActs > userSwears`: `HOLY GOODY TWO-SHOES`
  - equal nonzero counts: `DEAD EVEN`
  - zero and zero after a valid scan: `NO SIGNAL`, with sharing disabled
- No eligible user messages is an input error, not a result; show no verdict and no share action.
- The copied/native-share text is exactly:

  ```text
  I used the open-source AI Swear Jar and found out I have sworn at AI {swears} times.

  On the other hand, I have been nice to AI {nice} times.

  Want to know how you measure up?

  https://swearjar.unfocused.ai
  ```

## Forbidden alternatives

- Do not create separate “swear mode” and “angel mode” share stories.
- Do not shame the user with “you suck.”
- Do not claim transcripts are uploaded, stored, or analyzed by a server.
- Do not add ranks, durations, or behavioral diagnosis that the scanner does not measure.
- Do not place SetupYourAI or Big Laser promotion inside the social post or image.

## Completion proof

- RED-GREEN tests lock the exact copy, data fields, verdict matrix, shared-scale chart, 1200×675 export, and absence of forbidden claims.
- The full repository suite passes from regenerated public artifacts.
- Browser verification exercises folder selection through a real result, caption copy, and card download at desktop and mobile widths.
- The exact exported PNG is opened and visually inspected.
- Production Omega remains unproven until the queued content lands, is deployed, and the same browser journey passes at `https://swearjar.unfocused.ai`.
