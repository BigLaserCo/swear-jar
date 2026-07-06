"""
Swear Jar — the word lists and the counting logic. Pure and I/O-free.

This is the part most worth reading: every word Swear Jar looks for lives here,
so you can see exactly what it counts (and edit it to taste). General profanity
only — deliberately NO slurs.
"""
import re

# base family -> (regex, tier).  Tiers: 3=strong, 2=medium, 1=mild.
LEXICON = [
    ("fuck",    r"\b(?:mother ?)?f+u+c+k+\w*\b", 3),
    ("cunt",    r"\bcunt\w*\b",                  3),
    ("shit",    r"\b(?:bull|horse|dog|dip|ape|bat)? ?s+h+i+t+\w*\b", 2),
    ("ass",     r"\b(?:dumb|jack|smart|fat)?ass(?:hole|holes|hat|es)?\b", 2),
    ("bitch",   r"\bb+i+t+c+h+\w*\b",            2),
    ("bastard", r"\bbastard\w*\b",               2),
    ("dick",    r"\bdick(?:head|heads|s)?\b",    2),
    ("piss",    r"\bpiss\w*\b",                  2),
    ("cock",    r"\bcock(?:sucker|head|s)?\b",   2),
    ("prick",   r"\bprick\w*\b",                 2),
    ("twat",    r"\btwat\w*\b",                  2),
    ("wanker",  r"\bwank\w*\b",                  2),
    ("bollocks",r"\bbollock\w*\b",               2),
    ("arse",    r"\barse\w*\b",                  2),
    ("damn",    r"\b(?:god ?)?damn\w*\b|\b(?:god ?)?dammit\b", 1),
    ("hell",    r"\bhell\b",                     1),
    ("crap",    r"\bcrap\w*\b",                  1),
    ("bloody",  r"\bbloody\b",                   1),
    ("bugger",  r"\bbugger\w*\b",                1),
    ("suck",    r"\bsuck(?:ed|ing|s|er|ers)?\b", 1),
    ("jesus",   r"\bjesus(?: christ)?\b|\bchrist\b", 1),
    ("god",     r"\boh my god\b",                1),
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


# Words to ignore when hunting for "rage triggers" (topics that co-occur with swears).
# A generous stopword list — common English + dictation filler — so only real
# topic words survive. (Swear inflections are filtered separately, via the lexicon.)
STOPWORDS = set((
    # common english
    "about above after again against all also am and any are arent aren't as at "
    "be because been before being below between both but can cannot cant could couldnt "
    "did didnt does doesnt doing dont down during each few for from further had hadnt "
    "has hasnt have havent having her here hers herself him himself his how into "
    "its itself just more most much must my myself nor not now off once only other "
    "ought our ours ourselves out over own same she should shouldnt some such than that "
    "thats their theirs them themselves then there these they theyre this those through "
    "too under until upon very was wasnt were werent what when where which while who "
    "whom why will with wont would wouldnt you youd youll youre youve your yours yourself "
    # dictation / conversational filler
    "okay yeah yep nope like want wants need needs make makes making made get gets "
    "getting got goes going gonna wanna gotta know knows knew think thinks thought "
    "thing things stuff lot lots kind sort sorts way ways good bad nice fine right left "
    "new old big small little bit here there now today tonight one two three first second "
    "next last put puts see saw seen say says said tell told give gave take took come "
    "came let lets look looks looking really actually basically literally maybe probably "
    "pretty quite kinda sorta because still even many back around another every always "
    "never sometimes else something anything everything nothing someone anyone everyone "
    "well sure mean means meant work works working different able same kind lot okay "
    "stuff yeah really want going want able thing look add added adding put using use "
    "used part parts side down over onto also much less able need needs want done doing "
    # swear/insult bases (belt-and-suspenders; inflections handled by the lexicon filter)
    "fuck shit damn cunt bitch hell crap suck god jesus christ stupid idiot please thanks sorry"
).split())


def trigger_words(text):
    """Unique meaningful TOPIC words in one recording — candidate rage triggers.

    Excludes stopwords AND anything the lexicon recognises as a swear/insult
    (so inflections like "fucked"/"shitty"/"goddamn" don't count as topics —
    otherwise a swear would trivially "co-occur" with swearing 100% of the time).
    """
    out = set()
    for w in re.findall(r"[a-z]{4,}", text.lower()):
        if w in STOPWORDS:
            continue
        if count_swears(w)[0] or count_insults(w)[0]:
            continue
        out.add(w)
    return out
