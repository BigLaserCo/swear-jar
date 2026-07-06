"""
Swear Jar — the word lists and the counting logic. Pure and I/O-free.

This is the part most worth reading: every word Swear Jar looks for lives here,
so you can see exactly what it counts (and edit it to taste). General profanity
only — deliberately NO slurs.
"""
import re

# base family -> (regex, tier).  Tiers: 3=strong, 2=medium, 1=mild.
# General profanity only — NO slurs, and NO mild exclamations that aren't really
# swears (god/jesus/suck were removed: "oh my god" is not a curse word).
# Elongations ("fuuuck") and compounds ("clusterfuck", "motherfucker") are caught.
LEXICON = [
    ("fuck",    r"\b\w*f+u+c+k+\w*\b",           3),   # fuck, fucking, motherfucker, clusterfuck
    ("cunt",    r"\bc+u+n+t+\w*\b",              3),
    ("shit",    r"\b(?:bull|horse|dog|dip|ape|bat|jack|cow|no)?s+h+i+t+\w*\b", 2),
    ("ass",     r"\b(?:dumb|jack|smart|fat|wise)?ass(?:hole|holes|hat|es|clown|wipe)?\b", 2),
    ("bitch",   r"\bb+i+t+c+h+\w*\b",            2),
    ("bastard", r"\bbastard\w*\b",               2),
    ("dick",    r"\bdick(?:head|heads|wad|face|s)?\b", 2),
    ("piss",    r"\bpiss\w*\b",                  2),
    ("cock",    r"\bcock(?:sucker|head|womble|s)?\b", 2),
    ("prick",   r"\bprick\w*\b",                 2),
    ("twat",    r"\btwat\w*\b",                  2),
    ("wank",    r"\bwank\w*\b",                  2),   # wank, wanker
    ("bollocks",r"\bbollock\w*\b",               2),
    ("arse",    r"\barse(?:hole|holes|d)?\b",    2),   # arse/arsehole — NOT "arsenal"
    ("douche",  r"\bdouche(?:bag|s)?\b",         2),
    ("tosser",  r"\btosser\w*\b",                2),
    ("knobhead",r"\bknob(?:head|end)\b",         2),   # "knob" alone excluded (door knob)
    ("bellend", r"\bbell ?end\b",                2),
    ("tits",    r"\btits\b|\btitties\b",         2),
    ("shag",    r"\bshag(?:ged|ging|s)?\b",      2),
    ("damn",    r"\b(?:god ?)?damn\w*\b|\b(?:god ?)?dammit\b", 1),
    ("hell",    r"\bhell\b",                     1),
    ("crap",    r"\bcrap\w*\b",                  1),
    ("bloody",  r"\bbloody\b",                   1),
    ("bugger",  r"\bbugger\w*\b",                1),
    ("sod",     r"\bsod(?:ding|\s+off|\s+it)\b", 1),   # "sod" alone excluded (soil)
]
TIER_NAME = {3: "strong", 2: "medium", 1: "mild"}
_COMPILED = [(base, re.compile(rx, re.I), tier) for base, rx, tier in LEXICON]

# Put-downs, NOT profanity — counted separately, folded into the swear total only
# when the user asks (--insults). Keeps the headline "swear" number honest.
INSULTS = [
    ("stupid", r"\bstupid\w*\b"), ("idiot", r"\bidiot\w*\b"), ("moron", r"\bmoron\w*\b"),
    ("dumb", r"\bdumb\b"), ("lame", r"\blame\b"), ("useless", r"\buseless\b"),
    ("pathetic", r"\bpathetic\b"), ("garbage", r"\bgarbage\b"),
]
_COMPILED_INS = [(base, re.compile(rx, re.I)) for base, rx in INSULTS]

# Politeness — the other side of the ledger, for the "manners vs. rage" stat.
POLITE = [
    ("please", r"\bplease\b"), ("thanks", r"\bthank(?:s| you)\b"),
    ("sorry", r"\bsorry\b"), ("appreciate", r"\bappreciate\b"),
]
_COMPILED_POL = [(base, re.compile(rx, re.I)) for base, rx in POLITE]


def _tally(text, compiled):
    counts = {}
    for base, rx, *_ in compiled:
        n = len(rx.findall(text))
        if n:
            counts[base] = n
    return counts


def count_swears(text):
    """Return (total, {base: count}, {base: tier}) for profanity."""
    counts, tiers = {}, {}
    for base, rx, tier in _COMPILED:
        n = len(rx.findall(text))
        if n:
            counts[base] = n
            tiers[base] = tier
    return sum(counts.values()), counts, tiers


def count_insults(text):
    """Return (total, {base: count}) for put-downs (stupid/idiot/…)."""
    counts = _tally(text, [(b, rx) for b, rx in _COMPILED_INS])
    return sum(counts.values()), counts


def count_polite(text):
    """Return (total, {base: count}) for polite words."""
    counts = _tally(text, [(b, rx) for b, rx in _COMPILED_POL])
    return sum(counts.values()), counts
