"""
Swear Jar — the engine. Scans Superwhisper recordings into a local SQLite tally
and computes the stats. No rendering here (see render.py) and no CLI (see cli.py).
"""
import os, re, glob, json, sqlite3, datetime
from .lexicon import (count_swears, count_insults, count_polite, trigger_words, TIER_NAME)

DB_DIR = os.path.expanduser("~/.swearjar")
DB_PATH = os.path.join(DB_DIR, "swearjar.db")

DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ---- database ----------------------------------------------------------------
def open_db(path=DB_PATH):
    if path != ":memory:":
        os.makedirs(os.path.dirname(path), exist_ok=True)
    con = sqlite3.connect(path)
    con.execute("""CREATE TABLE IF NOT EXISTS recordings(
        id TEXT PRIMARY KEY, dt TEXT, epoch INTEGER, words INTEGER,
        swears INTEGER, insults INTEGER DEFAULT 0)""")
    con.execute("CREATE TABLE IF NOT EXISTS swear_counts(word TEXT PRIMARY KEY, count INTEGER, tier INTEGER)")
    con.execute("CREATE TABLE IF NOT EXISTS insult_counts(word TEXT PRIMARY KEY, count INTEGER)")
    con.execute("CREATE TABLE IF NOT EXISTS polite_counts(word TEXT PRIMARY KEY, count INTEGER)")
    con.execute("CREATE TABLE IF NOT EXISTS combo_counts(pair TEXT PRIMARY KEY, count INTEGER)")
    con.execute("CREATE TABLE IF NOT EXISTS trigger_counts(word TEXT PRIMARY KEY, sweary INTEGER, total INTEGER)")
    con.execute("CREATE TABLE IF NOT EXISTS scan_meta(key TEXT PRIMARY KEY, value TEXT)")
    cols = [r[1] for r in con.execute("PRAGMA table_info(recordings)").fetchall()]
    if "insults" not in cols:
        con.execute("ALTER TABLE recordings ADD COLUMN insults INTEGER DEFAULT 0")
    con.commit()
    return con


def _record(con, rid, dt, epoch, text):
    """Count one recording's text and write it into every tally. Idempotent by id."""
    swears, counts, tiers = count_swears(text)
    ins_total, ins_counts = count_insults(text)
    _, pol_counts = count_polite(text)
    con.execute("INSERT OR IGNORE INTO recordings(id,dt,epoch,words,swears,insults) VALUES(?,?,?,?,?,?)",
                (rid, dt, epoch, len(text.split()), swears, ins_total))
    for base, n in counts.items():
        con.execute("INSERT INTO swear_counts(word,count,tier) VALUES(?,?,?) "
                    "ON CONFLICT(word) DO UPDATE SET count=count+excluded.count", (base, n, tiers[base]))
    for base, n in ins_counts.items():
        con.execute("INSERT INTO insult_counts(word,count) VALUES(?,?) "
                    "ON CONFLICT(word) DO UPDATE SET count=count+excluded.count", (base, n))
    for base, n in pol_counts.items():
        con.execute("INSERT INTO polite_counts(word,count) VALUES(?,?) "
                    "ON CONFLICT(word) DO UPDATE SET count=count+excluded.count", (base, n))
    fams = sorted(counts)                                   # signature combos
    for a in range(len(fams)):
        for b in range(a + 1, len(fams)):
            con.execute("INSERT INTO combo_counts(pair,count) VALUES(?,1) "
                        "ON CONFLICT(pair) DO UPDATE SET count=count+1", (f"{fams[a]} + {fams[b]}",))
    sweary = 1 if swears > 0 else 0                         # rage triggers
    for w in trigger_words(text):
        con.execute("INSERT INTO trigger_counts(word,sweary,total) VALUES(?,?,1) "
                    "ON CONFLICT(word) DO UPDATE SET sweary=sweary+?, total=total+1", (w, sweary, sweary))


def ingest(con, recordings_dir):
    """Scan the folder; add any recordings not already tallied. Idempotent."""
    metas = glob.glob(os.path.join(recordings_dir, "*", "meta.json"))
    added = 0
    for meta in metas:
        rid = os.path.basename(os.path.dirname(meta))
        if con.execute("SELECT 1 FROM recordings WHERE id=?", (rid,)).fetchone():
            continue
        try:
            with open(meta, encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            continue
        text = (d.get("result") or d.get("rawResult") or "").strip()
        if not text:
            continue
        try:
            epoch = int(rid)
        except ValueError:
            epoch = 0
        _record(con, rid, d.get("datetime", ""), epoch, text)
        added += 1
    con.execute("INSERT OR REPLACE INTO scan_meta(key,value) VALUES('source',?)", (recordings_dir,))
    con.commit()
    return added, len(metas)


def seed_demo(con):
    """Populate synthetic data so people without Superwhisper can see the vibe."""
    import hashlib
    base_epoch = 1777587458
    samples = [
        "okay why the fuck did you stop working again on this merge",
        "that's fucking broken fix the deploy", "no i told you a million times god damn it",
        "holy shit the test actually passed", "this is bullshit you didn't even check the build",
        "looks good thanks", "what the hell is this render", "you absolute muppet just merge it",
    ]
    for i in range(240):
        text = " ".join([samples[i % len(samples)]] * (1 + int(hashlib.md5(str(i).encode()).hexdigest(), 16) % 3))
        epoch = base_epoch + i * 7000
        dt = datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).isoformat()
        _record(con, f"demo{i}", dt, epoch, text)
    con.commit()


# ---- stats -------------------------------------------------------------------
def compute_stats(con, rate, include_insults=False):
    rows = con.execute("SELECT dt, words, swears, insults FROM recordings").fetchall()
    total_recs = len(rows)
    total_words = sum(r[1] for r in rows)
    insults_total = sum(r[3] for r in rows)
    swear_of = (lambda r: r[2] + r[3]) if include_insults else (lambda r: r[2])
    total_swears = sum(swear_of(r) for r in rows)
    swore_recs = sum(1 for r in rows if swear_of(r) > 0)

    by_hour = [0] * 24
    by_hour_words = [0] * 24
    by_dow = [0] * 7
    by_dow_words = [0] * 7
    by_week, by_day, first_swear_min = {}, {}, {}
    for r in rows:
        dt, words, sw = r[0], r[1], swear_of(r)
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})", dt or "")
        if not m:
            continue
        y, mo, da, hh, mm = (int(x) for x in m.groups())
        k0 = f"{y:04d}-{mo:02d}-{da:02d}"          # date key — needed for EVERY row
        by_hour[hh] += sw
        by_hour_words[hh] += words
        if sw > 0:
            if k0 not in first_swear_min or hh * 60 + mm < first_swear_min[k0]:
                first_swear_min[k0] = hh * 60 + mm
        try:
            dobj = datetime.date(y, mo, da)
        except ValueError:
            continue
        by_dow[dobj.weekday()] += sw
        by_dow_words[dobj.weekday()] += words
        iso = dobj.isocalendar()
        wk = f"{iso[0]}-W{iso[1]:02d}"
        by_week[wk] = by_week.get(wk, 0) + sw
        by_day[k0] = by_day.get(k0, 0) + sw

    top = con.execute("SELECT word,count,tier FROM swear_counts ORDER BY count DESC").fetchall()
    top_insults = con.execute("SELECT word,count FROM insult_counts ORDER BY count DESC").fetchall()
    top_polite = con.execute("SELECT word,count FROM polite_counts ORDER BY count DESC").fetchall()
    strong = sum(c for _, c, t in top if t == 3)
    polite_total = sum(c for _, c in top_polite)
    swear_vocab = con.execute("SELECT COUNT(*) FROM swear_counts").fetchone()[0]
    fuck_count = next((c for w, c, _ in top if w == "fuck"), 0)

    dow_rate = [1000 * by_dow[i] / by_dow_words[i] if by_dow_words[i] else 0 for i in range(7)]
    worst_dow_i = max(range(7), key=lambda i: dow_rate[i]) if any(by_dow_words) else 0

    days_sorted = sorted(by_day)
    span_days = 1
    if days_sorted:
        span_days = max(1, (datetime.date.fromisoformat(days_sorted[-1])
                            - datetime.date.fromisoformat(days_sorted[0])).days + 1)
    per_day = total_swears / span_days

    first_swear = ""
    if first_swear_min:
        avg = round(sum(first_swear_min.values()) / len(first_swear_min))
        h = (avg // 60) % 24
        first_swear = f"{(h % 12) or 12}:{avg % 60:02d}{'am' if h < 12 else 'pm'}"
    combo = con.execute("SELECT pair,count FROM combo_counts ORDER BY count DESC LIMIT 1").fetchone()
    signature_combo = {"pair": combo[0], "count": combo[1]} if combo else None

    # rage triggers: topics that co-occur with swearing far more than your baseline
    base_rate = swore_recs / total_recs if total_recs else 0
    min_total = max(8, total_recs // 200)
    cap_total = max(min_total + 1, int(total_recs * 0.12))   # a topic is specific, not ubiquitous
    trig = con.execute("SELECT word,sweary,total FROM trigger_counts WHERE total BETWEEN ? AND ?",
                       (min_total, cap_total)).fetchall()
    # a real trigger: specific topic, mentioned enough, and you swear FAR above baseline when you do
    scored = [(w, s / t, s, t) for w, s, t in trig if s / t > base_rate * 1.4 and s >= 6]
    scored.sort(key=lambda x: (-x[1], -x[2]))     # most over-represented first, then volume
    rage_triggers = [{"word": w, "share": round(100 * sh), "sweary": s, "total": t}
                     for w, sh, s, t in scored[:6]]

    worst_day = max(by_day.items(), key=lambda kv: kv[1]) if by_day else ("—", 0)

    days_sworn = sorted(d for d, v in by_day.items() if v > 0)
    best = streak = 0
    prev = None
    for ds in days_sworn:
        cur = datetime.date.fromisoformat(ds)
        streak = streak + 1 if prev and (cur - prev).days == 1 else 1
        best = max(best, streak)
        prev = cur

    dts = sorted(r[0] for r in rows if r[0])
    return {
        "app": "Swear Jar",
        "total_recordings": total_recs,
        "total_words": total_words,
        "total_swears": total_swears,
        "swore_recordings": swore_recs,
        "pct_recordings_sworn": round(100 * swore_recs / total_recs, 1) if total_recs else 0,
        "swears_per_1k": round(1000 * total_swears / total_words, 1) if total_words else 0,
        "swears_per_day": round(per_day, 1),
        "span_days": span_days,
        "jar_rate": rate,
        "jar_total": round(total_swears * rate, 2),
        "spicy_pct": round(100 * strong / total_swears) if total_swears else 0,
        "top": [{"word": w, "count": c, "tier": TIER_NAME[t]} for w, c, t in top[:10]],
        "insults_total": insults_total,
        "top_insults": [{"word": w, "count": c} for w, c in top_insults[:5]],
        "insults_counted": include_insults,
        "polite_total": polite_total,
        "top_polite": [{"word": w, "count": c} for w, c in top_polite],
        "swear_vocab": swear_vocab,
        "fuck_count": fuck_count,
        "worst_dow": DOW[worst_dow_i],
        "worst_dow_rate": round(dow_rate[worst_dow_i], 1),
        "swears_per_year": round(per_day * 365),
        "jar_per_year": round(per_day * 365 * rate, 2),
        "first_swear": first_swear,
        "signature_combo": signature_combo,
        "rage_triggers": rage_triggers,
        "by_hour": by_hour,
        "by_hour_words": by_hour_words,
        "by_dow": by_dow,
        "week_series": [{"w": k, "v": v} for k, v in sorted(by_week.items())],
        "worst_day": {"date": worst_day[0], "swears": worst_day[1]},
        "longest_streak": best,
        "first_dt": dts[0] if dts else "",
        "last_dt": dts[-1] if dts else "",
        "active_days": len(by_day),
    }
