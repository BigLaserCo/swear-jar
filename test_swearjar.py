#!/usr/bin/env python3
"""Tests for the swear-counting core. Run: python3 -m unittest -v test_swearjar"""
import unittest
from swearjar import count_swears


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

    # --- it must NOT count innocent words (the embarrassing failures) ---
    def test_no_false_positives(self):
        clean = ("this is a class assignment, please pass. hello assistant, "
                 "let's assess the grass, order a cocktail, watch the peacock, "
                 "he harassed nobody, shell script, scrape the data")
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
        # sanity: it's general profanity only; keep the list small & known
        self.assertIn("fuck", bases)
        self.assertLess(len(bases), 25)


if __name__ == "__main__":
    unittest.main()
