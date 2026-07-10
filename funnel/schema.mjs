// Leaderboard submission schema — the funnel Worker's copy.
//
// Self-contained on purpose: the Cloudflare Worker imports this and NOTHING
// else from the repo, so the Worker bundle stays a two-file module with zero
// npm dependencies and no reach into src/ (which the CI gate scans for
// network smells — this stays out of its way and out of the shipped app).
//
// NOTE FOR THE INTEGRATOR: scripts/leaderboard/schema.mjs (built on a sibling
// branch) defines the same field set from the CLI side. The two modules are
// meant to be unified at merge; keep the field names + caps in sync.
//
// Field set (matches the `wrapped --submit` payload):
//   total_coins     int    0 .. 1,000,000
//   dollars         number 0 .. 250,000        (coins * $0.25, but self-reported)
//   swears_per_day  number 0 .. 10,000
//   top_word        string ≤ 24, CENSORED ONLY (an uncensored swear is rejected)
//   fbomb_pct       number 0 .. 100
//   active_days     int    0 .. 100,000
//   agent           enum   claude | codex | superwhisper | other
//   app_version     semver-ish string ≤ 32
//   release_hash    hex string 7..64 chars (git object hash of the release)

export const AGENTS = ["claude", "codex", "superwhisper", "other"];

export const CAPS = {
  total_coins: 1_000_000,
  dollars: 250_000,
  swears_per_day: 10_000,
  fbomb_pct: 100,
  active_days: 100_000,
  top_word_len: 24,
  app_version_len: 32,
  release_hash_len: 64,
};

const APP_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.+-]+)?$/;
const RELEASE_HASH_RE = /^[0-9a-f]{7,64}$/i;

// Minimal uncensored-swear check for top_word. Deliberately a local copy of
// the lexicon STEMS (importing src/detect.mjs would pull app code into the
// Worker path); a censored form like "f**k" contains no full stem, so it
// passes — which is the point: the public board shows censored words only.
const UNCENSORED_RE = new RegExp(
  "\\b(?:" +
    [
      "f+u+c+k+",
      "s+h+i+t+",
      "c+u+n+t+",
      "b+i+t+c+h+",
      "ass(?:hole|hat|wipe|clown|es)?",
      "dick",
      "piss",
      "cock",
      "prick",
      "twat",
      "wank",
      "bollock",
      "bastard",
      "damn",
      "dammit",
      "crap",
      "hell",
      "bugger",
      "bloody",
      "douche",
      "tosser",
      "bellend",
      "knobhead",
      "goddamn",
      "motherfuck\\w*",
      "clusterfuck\\w*",
      "cocksucker",
      "arse(?:hole)?",
      "tits",
      "shag",
    ].join("|") +
    ")\\w*\\b",
  "i"
);

export function isUncensoredSwear(s) {
  return UNCENSORED_RE.test(String(s || ""));
}

function err(field, msg) {
  return `${field}: ${msg}`;
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

function checkNumber(errors, field, v, { cap, integer = false, min = 0 }) {
  const n = toNumber(v);
  if (!Number.isFinite(n)) {
    errors.push(err(field, "must be a finite number"));
    return undefined;
  }
  if (integer && !Number.isInteger(n)) {
    errors.push(err(field, "must be an integer"));
    return undefined;
  }
  if (n < min) {
    errors.push(err(field, `must be >= ${min}`));
    return undefined;
  }
  if (n > cap) {
    errors.push(err(field, `exceeds cap ${cap}`));
    return undefined;
  }
  return integer ? n : Math.round(n * 100) / 100;
}

// validate(stats) -> { ok: true, value } | { ok: false, errors: [...] }
// `value` is a NEW object containing only the known fields, coerced + trimmed —
// unknown fields are dropped, never stored.
export function validate(stats) {
  const errors = [];
  if (stats === null || typeof stats !== "object" || Array.isArray(stats)) {
    return { ok: false, errors: ["stats: must be an object"] };
  }

  const value = {};

  value.total_coins = checkNumber(errors, "total_coins", stats.total_coins, {
    cap: CAPS.total_coins,
    integer: true,
  });
  value.dollars = checkNumber(errors, "dollars", stats.dollars, { cap: CAPS.dollars });
  value.swears_per_day = checkNumber(errors, "swears_per_day", stats.swears_per_day, {
    cap: CAPS.swears_per_day,
  });
  value.fbomb_pct = checkNumber(errors, "fbomb_pct", stats.fbomb_pct, { cap: CAPS.fbomb_pct });
  value.active_days = checkNumber(errors, "active_days", stats.active_days, {
    cap: CAPS.active_days,
    integer: true,
  });

  // top_word — short, and censored-forms ONLY.
  const topWord = typeof stats.top_word === "string" ? stats.top_word.trim() : "";
  if (!topWord) {
    errors.push(err("top_word", "required"));
  } else if (topWord.length > CAPS.top_word_len) {
    errors.push(err("top_word", `longer than ${CAPS.top_word_len} chars`));
  } else if (isUncensoredSwear(topWord)) {
    errors.push(err("top_word", "must be censored (e.g. f**k), uncensored words are rejected"));
  } else {
    value.top_word = topWord;
  }

  // agent enum
  const agent = typeof stats.agent === "string" ? stats.agent.trim().toLowerCase() : "";
  if (!AGENTS.includes(agent)) {
    errors.push(err("agent", `must be one of ${AGENTS.join("|")}`));
  } else {
    value.agent = agent;
  }

  // app_version
  const appVersion = typeof stats.app_version === "string" ? stats.app_version.trim() : "";
  if (!appVersion || appVersion.length > CAPS.app_version_len || !APP_VERSION_RE.test(appVersion)) {
    errors.push(err("app_version", "must be a semver-like string (e.g. 0.1.0)"));
  } else {
    value.app_version = appVersion;
  }

  // release_hash
  const releaseHash = typeof stats.release_hash === "string" ? stats.release_hash.trim() : "";
  if (!releaseHash || releaseHash.length > CAPS.release_hash_len || !RELEASE_HASH_RE.test(releaseHash)) {
    errors.push(err("release_hash", "must be a 7-64 char hex string"));
  } else {
    value.release_hash = releaseHash.toLowerCase();
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value };
}
