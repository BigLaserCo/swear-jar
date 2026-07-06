#!/usr/bin/env python3
"""
Swear Jar 🫙 — how much do you swear at your AI?

100% LOCAL. Your transcripts never leave this machine. Zero dependencies —
Python standard library only, so you can read every line before you run it.

This file is just the entry point. The real code is the `swearjar/` package:
    swearjar/lexicon.py — the word lists + counting (start here)
    swearjar/engine.py  — scan Superwhisper → local SQLite tally → stats
    swearjar/render.py  — stats → self-contained HTML report
    swearjar/cli.py     — the command line

    python3 swearjar.py            # scan your Superwhisper folder, build the report
    python3 swearjar.py --open     # ...and open it in your browser
    python3 swearjar.py --demo     # try it with fake data (no Superwhisper needed)
"""
import sys
from swearjar.cli import main

if __name__ == "__main__":
    sys.exit(main())
