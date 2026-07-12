// The tip jar — single source of truth for the donate/tip link.
//
// Every surface (report donate button, CLI tip lines, plugin skill copy)
// imports DONATE_URL from here; there is NEVER a second literal of this URL
// anywhere else. The default points at the hosted indirection page
// (docs/tip.html) — NOT a payment provider: the real payment target lives only
// in tip.html's button, so swapping providers at launch needs no CLI release.
// SWEAR_JAR_DONATE_URL overrides (forks, tests, a self-hosted mirror).

const DEFAULT_DONATE_URL = "https://swearjar.unfocused.ai/tip.html";

export const DONATE_URL = process.env.SWEAR_JAR_DONATE_URL || DEFAULT_DONATE_URL;

// The one-line "don't forget to tip" tag every door closes on (init summary,
// status, wrapped). One line, always DONATE_URL, always light — it's a novelty
// jar asking nicely, not a paywall.
export function tipLine() {
  return `🫙 The jar takes real money too — empty yours: ${DONATE_URL}`;
}
