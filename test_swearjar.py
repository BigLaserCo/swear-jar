#!/usr/bin/env python3
"""Tests for the swear-counting core. Run: python3 -m unittest -v test_swearjar"""
import unittest
from swearjar import count_swears, count_insults, count_polite


class TestCounting(unittest.TestCase):
    def total(self, s):
        return count_swears(s)[0]

    def counts(self, s):
        return count_swears(s)[1]

    # --- it counts real swears (and their variants) ---
    def test_basic(self):
        self.assertEqual(self.total("fuck this fucking thing"), 2)

    def test_fuck_family(self):
        c = self.counts("fuck fucking motherfucker fucked")
        self.assertEqual(c["fuck"], 4)

    def test_bullshit_and_shit(self):
        c = self.counts("that's bullshit and this is shit")
        self.assertEqual(c["shit"], 2)

    def test_goddamn_and_damn(self):
        self.assertEqual(self.counts("damn it, goddamn")["damn"], 2)

    def test_ass_variants(self):
        c = self.counts("ass asshole dumbass")
        self.assertEqual(c["ass"], 3)

    def test_case_insensitive(self):
        self.assertEqual(self.total("FUCK Shit DaMn"), 3)

    def test_compounds(self):
        # compounds must be caught, not just the base word
        self.assertEqual(self.counts("clusterfuck and motherfucker")["fuck"], 2)
        self.assertEqual(self.counts("bullshit horseshit dipshit")["shit"], 3)

    def test_dammit_double_m(self):
        # the -n regex missed the colloquial double-m spelling before
        self.assertEqual(self.counts("dammit and goddammit")["damn"], 2)

    def test_cunt(self):
        c = self.counts("what a cunt, absolute cunts, you cuntface")
        self.assertEqual(c["cunt"], 3)

    # --- accuracy: things that are NOT swears must not count ---
    def test_god_and_suck_are_not_swears(self):
        # "oh my god" / "sucks" were removed — not profanity
        self.assertEqual(self.total("oh my god this sucks, jesus christ"), 0)

    def test_arse_not_arsenal(self):
        self.assertEqual(self.total("i support arsenal and account for it"), 0)
        self.assertEqual(self.counts("get off your arse")["arse"], 1)

    def test_code_words_are_not_swears(self):
        # this tool runs on a programmer's dictation — these MUST never count
        # ("div" and "git" are British insults but here they're code, every time)
        code = ("add a div to the git commit, check the token count and the "
                "polygon count, that class assignment, a cocktail of screws")
        self.assertEqual(self.total(code), 0, f"false positive: {self.counts(code)}")

    # --- insults are counted SEPARATELY, never as swears ---
    def test_insults_separate(self):
        self.assertEqual(count_insults("you stupid idiot moron")[0], 3)
        self.assertEqual(self.total("you stupid idiot moron"), 0)  # not swears

    def test_polite(self):
        self.assertEqual(count_polite("please and thank you and sorry")[0], 3)
        self.assertEqual(self.total("please and thank you"), 0)  # manners aren't swears

    # --- it must NOT count innocent words (the embarrassing failures) ---
    def test_no_false_positives(self):
        clean = ("this is a class assignment, please pass. hello assistant, "
                 "let's assess the grass, order a cocktail, watch the peacock, "
                 "he harassed nobody, shell script, scrape the data, "
                 "success in december at christmas, minor damage, an assessment")
        self.assertEqual(self.total(clean), 0, f"false positive in: {self.counts(clean)}")

    def test_hell_not_hello(self):
        self.assertEqual(self.total("hello there"), 0)
        self.assertEqual(self.total("what the hell"), 1)

    def test_empty(self):
        self.assertEqual(self.total(""), 0)
        self.assertEqual(self.total("a perfectly polite sentence, thank you"), 0)

    # --- tiers ---
    def test_tiers(self):
        _, _, tiers = count_swears("fuck shit damn")
        self.assertEqual(tiers["fuck"], 3)   # strong
        self.assertEqual(tiers["shit"], 2)   # medium
        self.assertEqual(tiers["damn"], 1)   # mild

    def test_no_slurs_in_lexicon(self):
        from swearjar import LEXICON
        bases = {b for b, _, _ in LEXICON}
        self.assertIn("fuck", bases)
        self.assertIn("cunt", bases)
        for not_a_swear in ("god", "jesus", "suck"):   # removed — not profanity
            self.assertNotIn(not_a_swear, bases)


class TestEngine(unittest.TestCase):
    def test_compute_stats_smoke(self):
        from swearjar import open_db, seed_demo, compute_stats
        from swearjar.engine import _record
        con = open_db(":memory:")
        # a CLEAN (0-swear) recording FIRST — guards the by-day date-key regression
        _record(con, "clean1", "2026-05-01T09:00:00", 1777000000, "looks great thank you")
        seed_demo(con)
        s = compute_stats(con, 1.0)
        for k in ("swears_per_day", "first_swear", "signature_combo", "total_swears"):
            self.assertIn(k, s)
        self.assertGreater(s["total_swears"], 0)


if __name__ == "__main__":
    unittest.main()
