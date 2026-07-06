<h1 align="center">🫙 Swear Jar</h1>
<p align="center"><em>How much do you swear at your AI?</em></p>

Swear Jar reads your [Superwhisper](https://superwhisper.com) voice-dictation
history — the stuff you mutter at your AI all day — tallies every swear into a
little local database, and hands you a shareable "damage report."

The founder swore at his AI **4,392 times in two months** — 6× more f-bombs than
*The Wolf of Wall Street*, about **65 a day**. That's **$4,392** in the jar.
What's your number?

> Run it to see your own report. Design notes and the launch plan live in
> [`docs/`](docs/).

## The whole thing is local. That's the point.

Your voice notes are the most personal data you own. So Swear Jar:

- **Never uploads anything.** It reads files on your machine, writes a database
  on your machine (`~/.swearjar/`), and renders an HTML page on your machine.
- **Has zero dependencies.** Pure Python standard library. Read every line before
  you run it — that's the trust model.
- **Shares only numbers, never words.** The share buttons carry your *balance*
  and *counts* — not a single word of what you actually said. There's a **🙈
  censor toggle** (on by default) so shared cards read `f***`.

## Run it

```bash
python3 swearjar.py            # scan your Superwhisper folder → build the report
python3 swearjar.py --open     # ...and open it in your browser
python3 swearjar.py --demo     # curious but don't use Superwhisper? try fake data
```

Options:

| flag | what it does |
|---|---|
| `--path DIR` | point at your recordings folder (default `~/Documents/superwhisper/recordings`) |
| `--rate N` | dollars owed per swear (default `$1.00`) |
| `--open` | open the report when it's built |
| `--demo` | run on fake data — nothing saved, real tally untouched |
| `--reset` | wipe the local tally and rescan from scratch |
| `--insults` | also count put-downs (stupid / idiot / …) as swears |

Requires Python 3.8+ (already on every Mac). If it can't find your recordings it
tells you where they usually live and lets you paste the path. Superwhisper is
Mac-first; that's who this is for today.

## What's in your report

Your balance, a rage-o-clock (volume **and** a swears-per-word rate line), your
top swears, **you vs. the founder** (compared per day, so history length doesn't
matter), and a "fine print" of derived facts — first-swear-of-the-day, signature
combo, movie-f-bomb multiple, manners ratio, and **rage triggers**: the topics
you swear about far more than your baseline.

## What it counts

General profanity only, grouped into families (fuck / shit / damn / …) with a
mild-medium-strong "spice" rating. **No slurs, ever** — it's a swear jar, not a
hate-speech detector. Put-downs (stupid / idiot) are tracked separately and only
count as swears with `--insults`. Every word lives in
[`swearjar/lexicon.py`](swearjar/lexicon.py); edit it to taste.

## How it's built

Small, layered, and readable on purpose — the engine and the rendering are
separate so you can trust (or replace) either half:

```
swearjar/
  lexicon.py   the word lists + counting logic (pure, no I/O — start here)
  engine.py    scan Superwhisper → local SQLite tally → stats
  render.py    a stats dict → a self-contained HTML report
  cli.py       the command line
swearjar.py    the entry point (python3 swearjar.py)
report_template.html   the report's HTML/CSS/JS
test_swearjar.py       unit tests (python3 -m unittest)
```

`scripts/ci/verify.sh` is the gate: syntax + package import + tests + a demo
smoke that must render a real report. Green before every commit.

## Status & license

**Private preview — UNLICENSED. Not released, not for redistribution yet.**
The licensing model (open-source vs. source-available "read it, don't reship it")
is an open decision for the owner. Until then: look, learn, don't redistribute.

© Big Laser. Your numbers are yours to keep — and to brag about. `#SwearJar`
