<h1 align="center">🫙 Swear Jar</h1>
<p align="center"><em>How much do you swear at your AI?</em></p>

Swear Jar reads your [Superwhisper](https://superwhisper.com) voice-dictation
history — the stuff you mutter at your AI all day — tallies every swear into a
little local database, and hands you a shareable "damage report."

The founder swore at his AI **4,215 times in two months.** That's **$4,215** in
the jar. What's your number?

> Run it to see your own report. Design notes and the launch plan live in
> [`docs/`](docs/).

## The whole thing is local. That's the point.

Your voice notes are the most personal data you own. So Swear Jar:

- **Never uploads anything.** It reads files on your machine, writes a database
  on your machine (`~/.swearjar/`), and renders an HTML page on your machine.
- **Has zero dependencies.** Pure Python standard library — ~350 readable lines.
  Read every one before you run it. That's the trust model.
- **Shares only numbers, never words.** The share buttons carry your *balance*
  and *counts* — not a single word of what you actually said.

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

Requires Python 3.8+ (already on every Mac). Superwhisper is Mac-first; that's
who this is for today.

## What it counts

General profanity only, grouped into families (fuck / shit / damn / …) with a
mild-medium-strong "spice" rating. **No slurs, ever** — it's a swear jar, not a
hate-speech detector. The word list lives at the top of `swearjar.py`; edit it
to taste.

## Status & license

**Private preview — UNLICENSED. Not released, not for redistribution yet.**
The licensing model (open-source vs. source-available "read it, don't reship it")
is an open decision for the owner. Until then: look, learn, don't redistribute.

© Big Laser. Your numbers are yours to keep — and to brag about. `#SwearJar`
