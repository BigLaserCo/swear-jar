"""
Swear Jar — the command line. Finds your Superwhisper folder, drives the engine,
writes the report. All the user-facing glue; no counting or HTML lives here.
"""
import os, sys, argparse
from . import engine
from .lexicon import LEXICON
from .render import render_html

# The creator's donation link, baked into every report's "empty your jar" button.
# Set it to your Ko-fi / Buy Me a Coffee / Stripe Payment Link / PayPal.me URL,
# or override per-run with --donate-url. Empty = the button is hidden.
DONATE_URL = ""

# Superwhisper writes recordings here by default; we try a few spellings/locations.
CANDIDATES = [
    "~/Documents/superwhisper/recordings",
    "~/Documents/Superwhisper/recordings",
    "~/Library/Application Support/superwhisper/recordings",
    "~/superwhisper/recordings",
]


def find_recordings(explicit=None):
    """Return the recordings folder: the one you gave, else the first that exists."""
    if explicit:
        return os.path.expanduser(explicit)
    for c in CANDIDATES:
        p = os.path.expanduser(c)
        if os.path.isdir(p):
            return p
    return None


def _ask_for_folder():
    """Couldn't autodetect — tell the user where it usually is and let them paste."""
    usual = os.path.expanduser(CANDIDATES[0])
    print("🫙  I couldn't find your Superwhisper recordings automatically.")
    print(f"    It's usually here:  {usual}")
    print("    (Superwhisper › Settings › Recordings shows the exact path.)")
    if not sys.stdin.isatty():
        print("    Re-run with:  python3 swearjar.py --path /your/superwhisper/recordings")
        print("    Or just try:  python3 swearjar.py --demo")
        return None
    try:
        ans = input("    Paste the folder path (or press Enter to quit): ").strip()
    except (EOFError, KeyboardInterrupt):
        return None
    ans = os.path.expanduser(ans)
    return ans if ans and os.path.isdir(ans) else None


def build_parser():
    ap = argparse.ArgumentParser(prog="swearjar", description="How much do you swear at your AI?")
    ap.add_argument("--path", help="Superwhisper recordings folder (auto-detected if omitted)")
    ap.add_argument("--rate", type=float, default=1.00, help="dollars owed per swear (default $1)")
    ap.add_argument("--out", default=os.path.join(os.getcwd(), "swearjar-report.html"),
                    help="where to write the HTML report")
    ap.add_argument("--open", action="store_true", help="open the report when done")
    ap.add_argument("--demo", action="store_true", help="use fake data (no Superwhisper needed)")
    ap.add_argument("--reset", action="store_true", help="wipe the local tally and rescan")
    ap.add_argument("--insults", action="store_true", help="also count put-downs (stupid/idiot/…)")
    ap.add_argument("--audit", action="store_true",
                    help="print exactly which words were counted (accuracy check), then exit")
    ap.add_argument("--donate-url", default=DONATE_URL,
                    help="the creator's donation page for the 'empty your jar' button")
    return ap


def run_audit(path):
    """Print every surface word behind the count, so accuracy is verifiable."""
    folder = find_recordings(path)
    if not folder or not os.path.isdir(folder):
        folder = _ask_for_folder()
    if not folder:
        return 1
    forms = engine.audit_forms(folder)
    print(f"🫙  Audit of {folder} — exactly what got counted (spot any false positives):\n")
    total = 0
    for base, _, _ in LEXICON:
        c = forms.get(base) or {}
        n = sum(c.values())
        total += n
        if not n:
            continue
        top = ", ".join(f"{w}×{k}" for w, k in c.most_common(8))
        print(f"  {base:10} {n:>5}  [{top}]")
    print(f"\n  TOTAL swears counted: {total}")
    print("  See a word that isn't a swear? Every pattern is in swearjar/lexicon.py.")
    return 0


def main(argv=None):
    args = build_parser().parse_args(argv)

    if args.audit:
        return run_audit(args.path)

    if args.reset and os.path.exists(engine.DB_PATH):
        os.remove(engine.DB_PATH)

    if args.demo:
        con = engine.open_db(":memory:")   # isolated — never touches your real tally
        engine.seed_demo(con)
        print("🫙  Using DEMO data (no Superwhisper needed, nothing saved).")
    else:
        folder = find_recordings(args.path)
        if not folder or not os.path.isdir(folder):
            folder = _ask_for_folder()
            if not folder:
                return 1
        con = engine.open_db()
        added, seen = engine.ingest(con, folder)
        print(f"🫙  Scanned {seen} recordings ({added} new) in {folder} — nothing left your machine.")

    stats = engine.compute_stats(con, args.rate, include_insults=args.insults)
    if stats["total_recordings"] == 0:
        print("No recordings with text found yet. Talk to your AI a bit and run me again.", file=sys.stderr)
        return 1
    stats["donate_url"] = args.donate_url

    out = os.path.abspath(args.out)
    with open(out, "w", encoding="utf-8") as f:
        f.write(render_html(stats))

    print(f"\n   Swears counted : {stats['total_swears']:,}")
    print(f"   In the jar     : ${stats['jar_total']:,.2f}  (at ${stats['jar_rate']:.2f}/swear)")
    print(f"   Sworn in       : {stats['pct_recordings_sworn']}% of recordings"
          f"  ·  {stats['swears_per_day']}/day")
    if stats["top"]:
        print(f"   Favourite word : \"{stats['top'][0]['word']}\" ×{stats['top'][0]['count']:,}")
    if not args.insults and stats["insults_total"]:
        print(f"   Put-downs      : {stats['insults_total']:,} more (stupid/idiot/…) — add --insults to count them")
    print(f"\n✅  Report: {out}")

    if args.open:
        import webbrowser
        webbrowser.open("file://" + out)
    return 0
