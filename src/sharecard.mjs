// Share-card SVG — the ONE canonical generator for both card variants.
//
// "damage"   — the dark ember card (the original), aggregate rage numbers.
// "kindness" — the light gold card (side B), aggregate kindness numbers.
//
// The self-contained report/demo HTML pages inline this generator VERBATIM
// (no build step, no imports in the page). test/sharecard.test.mjs extracts
// the block between the parity markers from every surface and asserts it
// byte-matches this file, so the duplication can never silently drift.
//
// Privacy contract (same as everything else here): the card carries aggregate
// NUMBERS, a censored word at most, and fixed lexicon/brand strings — never a
// sentence, never a path, never an identity. Dollar figures are WHOLE dollars
// (the claims gate bans decimal cents on public surfaces).
//
// `d` is a plain display-ready object — no stats dependency, so the function is
// pure and portable into a <script> tag:
//   { coins, dollars, favLabel, fbombPct, vocab,            // damage
//     credits, dollarsBack, favKindLabel, grovelPct, kindVocab } // kindness

/*__CARD_SVG_START__*/
function cardSvg(d, variant) {
  const num = (n) => Number(n || 0).toLocaleString("en-US");
  const usd0 = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
  if (variant === "kindness") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><defs><linearGradient id="kg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F5C542"/><stop offset="1" stop-color="#C9922A"/></linearGradient></defs><rect width="1200" height="675" rx="28" fill="#FBF7EC"/><rect width="1200" height="10" fill="#F5C542"/><text x="60" y="92" fill="#241C10" font-family="Arial,sans-serif" font-size="32" font-weight="700">🫙 the kindness report</text><text x="60" y="250" fill="url(#kg)" font-family="Arial,sans-serif" font-size="128" font-weight="900">${num(d.credits)}</text><text x="60" y="300" fill="#574A32" font-family="Arial,sans-serif" font-size="28">kindness credits · ${usd0(d.dollarsBack)} earned back off the jar</text><text x="60" y="410" fill="#8A6A12" font-family="Arial,sans-serif" font-size="26" font-weight="700">${d.favKindLabel || "—"} · ${Number(d.grovelPct) || 0}% grovel · ${num(d.kindVocab)} distinct courtesies</text><text x="60" y="570" fill="#9C8F70" font-family="monospace" font-size="20">the machines remember who said please · swearjar.unfocused.ai</text></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" rx="28" fill="#17141c"/><rect width="1200" height="10" fill="#e8623a"/><text x="60" y="92" fill="#f3eee7" font-family="Arial,sans-serif" font-size="32" font-weight="700">🫙 swear, wrapped</text><text x="60" y="250" fill="#f3eee7" font-family="Arial,sans-serif" font-size="128" font-weight="900">${num(d.coins)}</text><text x="60" y="300" fill="#cfc6ba" font-family="Arial,sans-serif" font-size="28">damage points · ${usd0(d.dollars)} owed</text><text x="60" y="410" fill="#f0805c" font-family="Arial,sans-serif" font-size="26" font-weight="700">${d.favLabel || "—"} · ${Number(d.fbombPct) || 0}% f-bombs · ${num(d.vocab)} distinct curses</text><text x="60" y="570" fill="#6f675e" font-family="monospace" font-size="20">processed locally · swearjar.unfocused.ai · #SwearJar</text></svg>`;
}
/*__CARD_SVG_END__*/

export { cardSvg };

// stats -> the display-ready object cardSvg consumes. Centralized so the CLI
// and any Node-side renderer agree with the in-page builders on rounding and
// censoring rules. `censor` is injected (the page has its own).
export function cardData(stats, { censor = (w) => w[0] + "*".repeat(Math.max(1, w.length - 1)) } = {}) {
  const fav = stats.topWords && stats.topWords[0];
  const favKind = stats.topPositives && stats.topPositives[0];
  const grovelCredits = (stats.topPositives || [])
    .filter((p) => p.tier === "grovel")
    .reduce((n, p) => n + p.credits, 0);
  const grovelPct = stats.kindnessCredits ? Math.round((100 * grovelCredits) / stats.kindnessCredits) : 0;
  return {
    coins: stats.totalCoins,
    dollars: stats.dollarsOwed,
    favLabel: fav ? censor(fav.word) : "—",
    fbombPct: stats.fbombPct,
    vocab: stats.vocab,
    credits: stats.kindnessCredits,
    dollarsBack: stats.kindnessDollars,
    favKindLabel: favKind ? favKind.word : "—", // lexicon constant (please/thanks) — safe uncensored
    grovelPct,
    kindVocab: (stats.topPositives || []).length,
  };
}
