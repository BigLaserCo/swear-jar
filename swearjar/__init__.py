"""Swear Jar 🫙 — how much do you swear at your AI?  100% local, zero deps.

Package layout (all standard library, all readable):
  lexicon.py — the word lists + counting logic (start here)
  engine.py  — scan Superwhisper recordings → local SQLite tally → stats
  render.py  — a stats dict → a self-contained HTML report
  cli.py     — the command line
"""
__version__ = "0.2.0"

from .lexicon import (count_swears, count_insults, count_polite, trigger_words,  # noqa: F401
                      LEXICON, TIER_NAME, STOPWORDS)
from .engine import open_db, ingest, seed_demo, compute_stats, DB_PATH  # noqa: F401
from .render import render_html  # noqa: F401
