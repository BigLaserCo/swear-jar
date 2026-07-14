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
//   swears_per_day  number 0 .. 5,000
//   top_word        string ≤ 24, CENSORED ONLY (an uncensored swear is rejected)
//   fbomb_pct       number 0 .. 100
//   active_days     int    0 .. 100,000
//   app_version     semver-ish string ≤ 32
//   release_hash    hex string 7..64 chars (git object hash of the release)

export const CAPS = {
  total_coins: 1_000_000,
  dollars: 250_000,
  swears_per_day: 5_000, // unified with leaderboard (see test/schema-parity)
  fbomb_pct: 100,
  active_days: 100_000,
  top_word_len: 24,
  app_version_len: 32,
  release_hash_len: 64,
  // ── milestone-3 hosted-wrapped extension (validateWrapped) ──────────────────
  families_max: 12, // at most 12 censored family keys travel in the payload
  count: 1_000_000, // ceiling for any single bucket/family count
  odds: 100, // Robot Uprising Survival Odds — a 0..100 percentage
  streak_days: 100_000, // longest consecutive-swear-day run
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

// ── milestone-3: the hosted-wrapped payload ──────────────────────────────────
// The hosted wrapped page is the (disclosed) collection moment: the client
// builds a URL carrying these AGGREGATE numbers and opens it. This schema is the
// privacy contract — it composes the untouched `validate()` above with the
// report aggregates, and (like validate) returns a NEW object holding ONLY the
// known fields. Unknown fields (project names/paths, cwd, session ids, per-day
// series, raw text) are never read here, so they can never travel — the DROP is
// the exclusion mechanism, tested end-to-end. `families` keys must already be
// censored (an uncensored swear key is rejected, same rule as top_word).

function checkIntArray(errors, field, v, len, cap) {
  if (!Array.isArray(v) || v.length !== len) {
    errors.push(err(field, `must be an array of exactly ${len} integers`));
    return undefined;
  }
  const out = [];
  for (let i = 0; i < len; i++) {
    const n = toNumber(v[i]);
    if (!Number.isInteger(n) || n < 0 || n > cap) {
      errors.push(err(field, `[${i}] must be an integer in 0..${cap}`));
      return undefined;
    }
    out.push(n);
  }
  return out;
}

function checkFamilies(errors, v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    errors.push(err("families", "must be an object of censored-word -> count"));
    return undefined;
  }
  const entries = Object.entries(v);
  if (entries.length > CAPS.families_max) {
    errors.push(err("families", `at most ${CAPS.families_max} families allowed`));
    return undefined;
  }
  const out = {};
  for (const [rawKey, rawCount] of entries) {
    const key = String(rawKey).trim();
    if (!key || key.length > CAPS.top_word_len) {
      errors.push(err("families", `key "${rawKey}" is empty or longer than ${CAPS.top_word_len}`));
      return undefined;
    }
    if (isUncensoredSwear(key)) {
      errors.push(err("families", `key "${rawKey}" must be censored (uncensored words are rejected)`));
      return undefined;
    }
    const n = toNumber(rawCount);
    if (!Number.isInteger(n) || n < 0 || n > CAPS.count) {
      errors.push(err("families", `count for "${rawKey}" must be an integer in 0..${CAPS.count}`));
      return undefined;
    }
    out[key] = n;
  }
  return out;
}

// validateWrapped(stats) -> { ok, value } | { ok, errors } — the base submit
// fields PLUS the six report aggregates, each schema-capped. `value` carries
// ONLY the known fields (base + families/by_hour/by_dow/user_vs_machine/odds/
// streak_days); everything else is dropped.
export function validateWrapped(stats) {
  const base = validate(stats);
  const errors = base.ok ? [] : [...base.errors];
  const value = base.ok ? { ...base.value } : {};
  const s = stats && typeof stats === "object" && !Array.isArray(stats) ? stats : {};

  const families = checkFamilies(errors, s.families);
  if (families !== undefined) value.families = families;

  const byHour = checkIntArray(errors, "by_hour", s.by_hour, 24, CAPS.count);
  if (byHour !== undefined) value.by_hour = byHour;

  const byDow = checkIntArray(errors, "by_dow", s.by_dow, 7, CAPS.count);
  if (byDow !== undefined) value.by_dow = byDow;

  const uvm = checkIntArray(errors, "user_vs_machine", s.user_vs_machine, 2, CAPS.count);
  if (uvm !== undefined) value.user_vs_machine = uvm;

  const odds = checkNumber(errors, "odds", s.odds, { cap: CAPS.odds, integer: true });
  if (odds !== undefined) value.odds = odds;

  const streak = checkNumber(errors, "streak_days", s.streak_days, {
    cap: CAPS.streak_days,
    integer: true,
  });
  if (streak !== undefined) value.streak_days = streak;

  if (errors.length) return { ok: false, errors };
  return { ok: true, value };
}

// ── the compact wire format (shared with the hosted Worker) ──────────────────
// Short keys + unreserved separators (".", "-") so a full worst-case payload
// stays ~1.1KB and (with the client's underscore-masked censoring) needs no
// percent-encoding. encode/decode are exact inverses through validateWrapped:
// decodeWrappedParams parses the query into a raw object; validateWrapped then
// caps + coerces it (the Worker validates untrusted input the same way).
const WIRE = {
  total_coins: "tc",
  dollars: "d",
  swears_per_day: "spd",
  top_word: "tw",
  fbomb_pct: "fb",
  active_days: "ad",
  app_version: "av",
  release_hash: "rh",
  odds: "o",
  streak_days: "sd",
};

export function encodeWrappedParams(value) {
  const p = new URLSearchParams();
  for (const [field, key] of Object.entries(WIRE)) {
    p.set(key, String(value[field]));
  }
  p.set("bh", (value.by_hour || []).join("."));
  p.set("bd", (value.by_dow || []).join("."));
  p.set("uvm", (value.user_vs_machine || []).join("."));
  p.set(
    "fam",
    Object.entries(value.families || {})
      .map(([k, c]) => `${k}-${c}`)
      .join(".")
  );
  return p.toString();
}

export function decodeWrappedParams(input) {
  const p =
    input instanceof URLSearchParams
      ? input
      : new URLSearchParams(String(input || "").replace(/^\?/, ""));
  const ints = (key) => {
    const raw = p.get(key);
    return raw ? raw.split(".").map(Number) : [];
  };
  const families = {};
  const famStr = p.get("fam");
  if (famStr) {
    for (const pair of famStr.split(".")) {
      const i = pair.lastIndexOf("-");
      if (i > 0) families[pair.slice(0, i)] = Number(pair.slice(i + 1));
    }
  }
  return {
    total_coins: Number(p.get(WIRE.total_coins)),
    dollars: Number(p.get(WIRE.dollars)),
    swears_per_day: Number(p.get(WIRE.swears_per_day)),
    top_word: p.get(WIRE.top_word) || "",
    fbomb_pct: Number(p.get(WIRE.fbomb_pct)),
    active_days: Number(p.get(WIRE.active_days)),
    app_version: p.get(WIRE.app_version) || "",
    release_hash: p.get(WIRE.release_hash) || "",
    odds: Number(p.get(WIRE.odds)),
    streak_days: Number(p.get(WIRE.streak_days)),
    by_hour: ints("bh"),
    by_dow: ints("bd"),
    user_vs_machine: ints("uvm"),
    families,
  };
}
