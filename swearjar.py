#!/usr/bin/env python3
"""
Swear Jar 🫙  —  how much do you swear at your AI?

Scans your local Superwhisper voice-dictation history, counts every swear,
keeps a local SQLite tally, and renders a shareable dashboard.

100% LOCAL. Your transcripts never leave this machine. The share buttons only
post the aggregate number you see on screen — never your words.

Zero dependencies (Python 3.8+ standard library only) — so you can read every
line and trust what runs on your private voice notes.

    python3 swearjar.py                 # scan default Superwhisper folder, build report
    python3 swearjar.py --open          # ...and open it in your browser
    python3 swearjar.py --path /some/dir --rate 0.25
    python3 swearjar.py --demo          # try it with fake data (no Superwhisper needed)
"""
import argparse, glob, html, json, os, re, sqlite3, sys, datetime

APP = "Swear Jar"
DEFAULT_SW = os.path.expanduser("~/Documents/superwhisper/recordings")
DB_DIR = os.path.expanduser("~/.swearjar")
DB_PATH = os.path.join(DB_DIR, "swearjar.db")

# ---- the lexicon: base family -> (regex, tier) --------------------------------
# Tiers: 3=strong, 2=medium, 1=mild. General profanity only — no slurs.
LEXICON = [
    ("fuck",    r"\b(?:mother ?)?f+u+c+k+\w*\b", 3),
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
COMPILED = [(base, re.compile(rx, re.I), tier) for base, rx, tier in LEXICON]
TIER_NAME = {3: "strong", 2: "medium", 1: "mild"}

# Put-downs, NOT profanity — counted separately, only folded into the swear
# total when the user passes --insults. Keeps the headline "swear" number honest.
INSULTS = [
    ("stupid", r"\bstupid\w*\b"), ("idiot", r"\bidiot\w*\b"), ("moron", r"\bmoron\w*\b"),
    ("dumb", r"\bdumb\b"), ("lame", r"\blame\b"), ("useless", r"\buseless\b"),
    ("pathetic", r"\bpathetic\b"), ("garbage", r"\bgarbage\b"),
]
COMPILED_INS = [(base, re.compile(rx, re.I)) for base, rx in INSULTS]


def count_swears(text):
    """Return (total, {base: count}, {base: tier}) for profanity."""
    counts, tiers = {}, {}
    for base, rx, tier in COMPILED:
        n = len(rx.findall(text))
        if n:
            counts[base] = counts.get(base, 0) + n
            tiers[base] = tier
    return sum(counts.values()), counts, tiers


def count_insults(text):
    """Return (total, {base: count}) for put-downs (stupid/idiot/…)."""
    counts = {}
    for base, rx in COMPILED_INS:
        n = len(rx.findall(text))
        if n:
            counts[base] = n
    return sum(counts.values()), counts


# ---- database -----------------------------------------------------------------
def open_db(path=DB_PATH):
    if path != ":memory:":
        os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path)
    con.execute("""CREATE TABLE IF NOT EXISTS recordings(
        id TEXT PRIMARY KEY, dt TEXT, epoch INTEGER, words INTEGER, swears INTEGER, insults INTEGER DEFAULT 0)""")
    con.execute("""CREATE TABLE IF NOT EXISTS swear_counts(
        word TEXT PRIMARY KEY, count INTEGER, tier INTEGER)""")
    con.execute("CREATE TABLE IF NOT EXISTS insult_counts(word TEXT PRIMARY KEY, count INTEGER)")
    con.execute("CREATE TABLE IF NOT EXISTS scan_meta(key TEXT PRIMARY KEY, value TEXT)")
    # migrate older DBs that predate the insults column
    cols = [r[1] for r in con.execute("PRAGMA table_info(recordings)").fetchall()]
    if "insults" not in cols:
        con.execute("ALTER TABLE recordings ADD COLUMN insults INTEGER DEFAULT 0")
    con.commit()
    return con


def ingest(con, recordings_dir):
    """Scan the folder; add any recordings not already tallied. Idempotent."""
    metas = glob.glob(os.path.join(recordings_dir, "*", "meta.json"))
    added = 0
    for meta in metas:
        rid = os.path.basename(os.path.dirname(meta))
        cur = con.execute("SELECT 1 FROM recordings WHERE id=?", (rid,))
        if cur.fetchone():
            continue  # already counted — accumulate, don't double-count
        try:
            with open(meta, encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            continue
        text = (d.get("result") or d.get("rawResult") or "").strip()
        if not text:
            continue
        total, counts, tiers = count_swears(text)
        ins_total, ins_counts = count_insults(text)
        try:
            epoch = int(rid)
        except ValueError:
            epoch = 0
        con.execute("INSERT OR IGNORE INTO recordings(id,dt,epoch,words,swears,insults) VALUES(?,?,?,?,?,?)",
                    (rid, d.get("datetime", ""), epoch, len(text.split()), total, ins_total))
        for base, n in counts.items():
            con.execute("""INSERT INTO swear_counts(word,count,tier) VALUES(?,?,?)
                ON CONFLICT(word) DO UPDATE SET count=count+excluded.count""",
                        (base, n, tiers[base]))
        for base, n in ins_counts.items():
            con.execute("""INSERT INTO insult_counts(word,count) VALUES(?,?)
                ON CONFLICT(word) DO UPDATE SET count=count+excluded.count""", (base, n))
        added += 1
    con.execute("INSERT OR REPLACE INTO scan_meta(key,value) VALUES('source',?)", (recordings_dir,))
    con.commit()
    return added, len(metas)


def seed_demo(con):
    """Populate synthetic data so people without Superwhisper can see the vibe."""
    import hashlib
    base_epoch = 1777587458
    samples = [
        ("okay why the fuck did you stop working again", 6), ("that's fucking broken fix it", 3),
        ("no i told you a million times god damn it", 2), ("holy shit that actually worked", 1),
        ("this is bullshit you didn't even check", 2), ("looks good thanks", 0),
        ("what the hell is this", 1), ("you absolute muppet just merge it", 0),
    ]
    for i in range(240):
        text, _ = samples[i % len(samples)]
        # vary a bit deterministically
        reps = 1 + (int(hashlib.md5(str(i).encode()).hexdigest(), 16) % 3)
        text = (" ".join([text] * reps))
        total, counts, tiers = count_swears(text)
        epoch = base_epoch + i * 7000
        dt = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).isoformat()
        rid = f"demo{i}"
        con.execute("INSERT OR IGNORE INTO recordings(id,dt,epoch,words,swears) VALUES(?,?,?,?,?)",
                    (rid, dt, epoch, len(text.split()), total))
        for base, n in counts.items():
            con.execute("""INSERT INTO swear_counts(word,count,tier) VALUES(?,?,?)
                ON CONFLICT(word) DO UPDATE SET count=count+excluded.count""", (base, n, tiers[base]))
    con.commit()


# ---- stats --------------------------------------------------------------------
def compute_stats(con, rate, include_insults=False):
    rows = con.execute("SELECT dt, words, swears, insults FROM recordings").fetchall()
    total_recs = len(rows)
    total_words = sum(r[1] for r in rows)
    insults_total = sum(r[3] for r in rows)
    # a "swear" is profanity; --insults folds put-downs into the count
    swear_of = (lambda r: r[2] + r[3]) if include_insults else (lambda r: r[2])
    total_swears = sum(swear_of(r) for r in rows)
    swore_recs = sum(1 for r in rows if swear_of(r) > 0)

    by_hour = [0] * 24          # swears per hour (volume)
    by_hour_words = [0] * 24    # words per hour (to normalise into a rate)
    by_dow = [0] * 7            # Mon=0
    by_week = {}               # 'YYYY-Www' -> swears
    by_day = {}                # 'YYYY-MM-DD' -> swears
    for r in rows:
        dt, words, sw = r[0], r[1], swear_of(r)
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2})", dt or "")
        if not m:
            continue
        y, mo, da, hh = int(m[1]), int(m[2]), int(m[3]), int(m[4])
        by_hour[hh] += sw
        by_hour_words[hh] += words
        try:
            dobj = datetime.date(y, mo, da)
        except ValueError:
            continue
        by_dow[dobj.weekday()] += sw
        iso = dobj.isocalendar()
        by_week[f"{iso[0]}-W{iso[1]:02d}"] = by_week.get(f"{iso[0]}-W{iso[1]:02d}", 0) + sw
        key = f"{y:04d}-{mo:02d}-{da:02d}"
        by_day[key] = by_day.get(key, 0) + sw

    top = con.execute("SELECT word,count,tier FROM swear_counts ORDER BY count DESC").fetchall()
    top_insults = con.execute("SELECT word,count FROM insult_counts ORDER BY count DESC").fetchall()
    strong = sum(c for _, c, t in top if t == 3)

    worst_day = max(by_day.items(), key=lambda kv: kv[1]) if by_day else ("—", 0)
    week_series = [{"w": k, "v": v} for k, v in sorted(by_week.items())]

    # longest streak of consecutive calendar days with >=1 swear
    days_sworn = sorted(d for d, v in by_day.items() if v > 0)
    streak = best = 0
    prev = None
    for ds in days_sworn:
        cur = datetime.date.fromisoformat(ds)
        streak = streak + 1 if prev and (cur - prev).days == 1 else 1
        best = max(best, streak)
        prev = cur

    dts = sorted(r[0] for r in rows if r[0])
    return {
        "app": APP,
        "total_recordings": total_recs,
        "total_words": total_words,
        "total_swears": total_swears,
        "swore_recordings": swore_recs,
        "pct_recordings_sworn": round(100 * swore_recs / total_recs, 1) if total_recs else 0,
        "swears_per_1k": round(1000 * total_swears / total_words, 1) if total_words else 0,
        "jar_rate": rate,
        "jar_total": round(total_swears * rate, 2),
        "spicy_pct": round(100 * strong / total_swears) if total_swears else 0,
        "top": [{"word": w, "count": c, "tier": TIER_NAME[t]} for w, c, t in top[:10]],
        "insults_total": insults_total,
        "top_insults": [{"word": w, "count": c} for w, c in top_insults[:5]],
        "insults_counted": include_insults,
        "by_hour": by_hour,
        "by_hour_words": by_hour_words,
        "by_dow": by_dow,
        "week_series": week_series,
        "worst_day": {"date": worst_day[0], "swears": worst_day[1]},
        "longest_streak": best,
        "first_dt": dts[0] if dts else "",
        "last_dt": dts[-1] if dts else "",
        "active_days": len(by_day),
    }


# ---- report -------------------------------------------------------------------
def render_html(stats):
    tpl_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "report_template.html")
    with open(tpl_path, encoding="utf-8") as f:
        tpl = f.read()
    blob = json.dumps(stats)
    return tpl.replace("/*__DATA__*/{}", blob)


def main():
    ap = argparse.ArgumentParser(description="Swear Jar — how much do you swear at your AI?")
    ap.add_argument("--path", default=DEFAULT_SW, help="Superwhisper recordings folder")
    ap.add_argument("--rate", type=float, default=1.00, help="dollars owed per swear (default $1)")
    ap.add_argument("--out", default=os.path.join(os.getcwd(), "swearjar-report.html"))
    ap.add_argument("--open", action="store_true", help="open the report when done")
    ap.add_argument("--demo", action="store_true", help="use fake data instead of your folder")
    ap.add_argument("--reset", action="store_true", help="wipe the local tally and rescan")
    ap.add_argument("--insults", action="store_true",
                    help="also count put-downs (stupid/idiot/…) as swears")
    args = ap.parse_args()

    if args.reset and os.path.exists(DB_PATH):
        os.remove(DB_PATH)

    if args.demo:
        con = open_db(":memory:")   # isolated — never touches your real ~/.swearjar tally
        seed_demo(con)
        print("🫙  Using DEMO data (no Superwhisper needed, nothing saved).")
    else:
        con = open_db()
        if not os.path.isdir(args.path):
            print(f"❌  Couldn't find your Superwhisper folder at:\n    {args.path}\n"
                  f"    Point me at it with:  python3 swearjar.py --path /path/to/superwhisper/recordings\n"
                  f"    Or try a demo:        python3 swearjar.py --demo", file=sys.stderr)
            return 1
        added, seen = ingest(con, args.path)
        print(f"🫙  Scanned {seen} recordings ({added} new) — all on your machine, nothing uploaded.")

    stats = compute_stats(con, args.rate, include_insults=args.insults)
    if stats["total_recordings"] == 0:
        print("No recordings with text found yet. Talk to your AI a bit and run me again.", file=sys.stderr)
        return 1

    out = os.path.abspath(args.out)
    with open(out, "w", encoding="utf-8") as f:
        f.write(render_html(stats))

    print(f"\n   Swears counted : {stats['total_swears']:,}")
    print(f"   In the jar     : ${stats['jar_total']:,.2f}  (at ${stats['jar_rate']:.2f}/swear)")
    print(f"   Sworn in       : {stats['pct_recordings_sworn']}% of recordings")
    top = stats["top"][0] if stats["top"] else None
    if top:
        print(f"   Favourite word : \"{top['word']}\" ×{top['count']:,}")
    if not args.insults and stats["insults_total"]:
        print(f"   Put-downs      : {stats['insults_total']:,} more (stupid/idiot/…) — add --insults to count them")
    print(f"\n✅  Report: {out}")

    if args.open:
        import webbrowser
        webbrowser.open("file://" + out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
