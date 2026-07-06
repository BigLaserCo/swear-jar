# Swear Jar — data representations

## 1. THE HERO STAT — "$ owed to the jar"

**Pick: the running dollar counter (`$1,338 owed`), not raw swear count.**

Raw count ("2,904 swears") is *impressive* but abstract — nobody has a gut feel for whether 2,904 is a lot. A dollar figure is instantly legible, morally loaded, and self-mocking: everyone grew up with a swear jar, so `$1,338` reads as *"this is what my potty mouth would literally cost me."* It's a number you screenshot with a wince-laugh, which is the exact emotion that drives a share. It also scales the joke — a big number is funny (*"I owe my AI a used car"*), a small one is also funny (*"$12, I'm basically a monk"*) — so it works for every user, not just the top decile.

Why not the alternatives: **swears/hour** is the nerdier true-intensity metric but needs a denominator explanation to land. **"more than X% of users"** is the *strongest eventual* hook but is impossible at launch (100% local, no aggregate) — reserve it for the opt-in future. The **$ jar** is the only candidate that is viral, self-contained, and shippable on day one with zero network.

---

## 2. TEN representations

1. **The Jar Counter** — a coin-jar that fills and a mono `$` odometer ticking up per swear. *Shareable:* it's the mascot; the number IS the brand.
2. **Rage-o-Clock** — 24-hour radial heatmap of swear-density by hour; your "witching hour" glows ember-hot. *Shareable:* "I curse hardest at 2am" is a personality reveal.
3. **Most-Cursed Day of Your Life** — auto-surfaces your single worst calendar day with the count + what you were building. *Shareable:* a dated, specific war story — inherently a story people retell.
4. **Top-Swears Leaderboard** — ranked bars of your go-to profanity, each with its own tally and a "signature swear" crown. *Shareable:* your #1 word is a fingerprint; people love comparing theirs.
5. **The Achievement Wall** — unlockable badges: *Potty Mouth* (1k+), *Zen Master* (a clean day), *Sailor* (5 swears in one breath), *Combo Breaker*, *Fixathon Fallout*. *Shareable:* badges are collectible and screenshot-native.
6. **Swearing Weather Report** — a timeline styled as a forecast: "Tuesday: 90% chance of profanity, gusts of F-bombs after 4pm." *Shareable:* the format is a joke in itself.
7. **Your AI's Breaking Point** — the single worst recording rendered as a redacted "incident report": duration, word count, ██████ swears, ember severity stamp. *Shareable:* the parody-classified aesthetic is catnip.
8. **The Longest Rant** — your longest unbroken tirade shown as a "receipt" with duration and a swears-per-minute burn rate. *Shareable:* "I ranted at Claude for 6 straight minutes" is a flex.
9. **Streak / Combo Counter** — clean-day streaks (halo) vs rage-streaks (fire); a broken clean streak gets a mock-mournful tombstone. *Shareable:* streaks trigger the same loss-aversion loop as Duolingo.
10. **The Cursed Constellation** — every recording a dot on a scatter (time × swear-density), the outliers labeled; your history as a night sky of little rage-stars. *Shareable:* it's *pretty*, and pretty gets pinned.

*Novel adds:* **"Swear Inflation" line** — swears/1k-words over time proving you're getting *worse* (mirrors the memo's flat-to-rising finding — self-own comedy). **"Politeness Tax"** — swears that landed on a *"please"* or *"thank you"* in the same breath ("you polite psychopath"). **"Escalation Ladder"** — how many words before your first F-bomb; a shrinking number is the whole gag.

---

## 3. THREE share-card concepts (1200×630 OG)

**A — Parody Bank Statement.** "SWEAR JAR — Statement of Account." Biggest element: `BALANCE DUE $1,338.00` in mono. Rows of "transactions" (top swears as line items with amounts), a footer disclaimer. Dry, deadpan, instantly forwardable.

**B — Arcade High-Score Screen.** CRT-scanline black, ember glow, `TOP SWEAR: FUCK ×612`, `HIGH SCORE 2,904`, "ENTER INITIALS." Biggest: the score. Vibe: nostalgic, competitive, begs a "beat my score."

**C — Wrapped Card.** Spotify-Wrapped stack: one giant stat per card, gradient ember panels, "Your Swear Jar 2026." Biggest: `$1,338` with "You swore more this year than 44% of your recordings." Vibe: the native share format people already know how to post.

**Strongest: A, the Bank Statement.** It fuses the hero stat (dollar balance) with the top-swears data in ONE frame, the parody is unmistakable at thumbnail size, and "statement of account" carries the guilty-confession tone that makes people *want* to expose their own number. B and C are the seasonal/variant cards.

---

## 4. THE "WRAPPED" ANGLE

**"Swear Jar Wrapped"** is the recurring viral moment because it manufactures a *dated event* out of static local data. Monthly ("Your July jar: $214") and yearly ("2026: you owed the jar $2,904") drops give a reason to re-open the app and re-share on a cadence — the thing a one-time novelty tool can't do. Each Wrapped is a swipeable stack of the section-9 cards ending on the Bank Statement, with year-over-year deltas ("+38% ragier than 2025") and a *new* badge unlocked. Because the raw material is already on every user's disk, Wrapped costs nothing to generate and lands the instant the period closes — no server, no waiting. The share loop: personal number + universal format + timed drop = the December-Spotify reflex, retargeted at how much people yell at their robots.

---

## 5. FUTURE (note only)

An **opt-in, anonymous aggregate** unlocks the strongest hook of all — **percentiles and a global leaderboard**: *"You swear more than 87% of operators,"* *"#3 rudest in the fleet this week,"* per-swear global rankings, cohort norms ("solo founders curse 2.1× more than teams"). That comparative number is more viral than any absolute one.

**The privacy line that keeps it safe:** never transmit transcripts or any text — only send **coarse aggregate counters** (total swears, per-category tallies, hour-of-day histogram) with **no timestamps, no content, no identifiers**, computed locally, opt-in per-share, k-anonymous (suppressed below a cohort floor). The product's entire trust story is "nothing leaves your machine" (the memo's `processed locally · nothing uploaded` badge) — the aggregate must preserve that literally: numbers travel, words never do.
