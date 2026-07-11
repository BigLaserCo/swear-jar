// Leaderboard submission schema — the CLI / GitHub-Action side.
//
// The counterpart to funnel/schema.mjs (the Cloudflare Worker's self-contained
// copy). The INTEGRATOR unifies the two at merge: the FIELD NAMES + shape match
// funnel/schema.mjs exactly, so unification is trivial. A few validation
// parameters are intentionally stricter/renamed on this side per the leaderboard
// spec — flagged in DELTAS below so the merge is a conscious reconciliation, not
// a silent drift:
//
//   DELTA 1  agent enum       = claude | codex | both | dictation
//            (funnel: claude | codex | superwhisper | other)
//   DELTA 2  swears_per_day cap = 5,000   (funnel: 10,000)
//   DELTA 3  release_hash       = EXACTLY 40 lowercase hex (a full git SHA-1)
//            (funnel: 7..64 hex). Missing/malformed hash is a HARD REJECT; a
//            well-formed hash that isn't a known release is NOT a reject — it is
//            recorded with verified:false. That is the honest provenance signal.
//
// Unlike the Worker (which can't import app code), this module imports the
// canonical LEXICON from src/detect.mjs for the uncensored-swear guard, so the
// public board can never show a fully-spelled swear — only censored forms.
//
// AGGREGATE NUMBERS ONLY. No message text, no uncensored swears, ever.

import fs from "node:fs";
import { LEXICON } from "../../src/detect.mjs";

const HERE = new URL("./", import.meta.url);
const PLACEHOLDER_HASH = "0".repeat(40); // dev-build sentinel — always unverified

export const AGENTS = ["claude", "codex", "both", "dictation"]; // DELTA 1

export const CAPS = {
  total_coins: 1_000_000,
  dollars: 250_000, // coins * $0.25 ceiling; funnel-aligned
  swears_per_day: 5_000, // DELTA 2
  fbomb_pct: 100,
  active_days: 100_000,
  top_word_len: 24,
  app_version_len: 32,
};

const APP_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+.][0-9A-Za-z.+-]+)?$/;
const RELEASE_HASH_RE = /^[0-9a-f]{40}$/; // DELTA 3 — full git SHA-1, lowercase
// GitHub username: 1..39 chars, alphanumeric or single interior hyphens.
const HANDLE_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/;

// The uncensored-swear guard for top_word. LEXICON mixes letter-only patterns
// (fuck, shit, ...) with censored-form patterns (f*ck, s#it — whose source
// carries the "[*@#$%!]" censor class). We keep ONLY the letter-only patterns:
// a censored form like "f***" matches none of them, so it passes — which is the
// point (the public board shows censored words only, never a spelled-out one).
const CENSOR_CLASS = "[*@#$%!]";
const UNCENSORED_LEXICON = LEXICON.filter((p) => !p.re.source.includes(CENSOR_CLASS));

export function containsUncensoredSwear(s) {
  const t = String(s ?? "").toLowerCase();
  return UNCENSORED_LEXICON.some((p) => {
    p.re.lastIndex = 0; // shared global regexes — reset before each probe
    return p.re.test(t);
  });
}

function loadReleases() {
  try {
    const data = JSON.parse(fs.readFileSync(new URL("known-releases.json", HERE), "utf8"));
    return data && typeof data.releases === "object" && data.releases ? data.releases : {};
  } catch {
    return {};
  }
}

// Normalize to the stored form (lowercase) and validate shape. "" == invalid.
function normalizeHash(hash) {
  const h = String(hash ?? "").trim().toLowerCase();
  return RELEASE_HASH_RE.test(h) ? h : "";
}

// isKnownRelease(hash[, releases]) — true only for a well-formed hash present in
// known-releases.json. The all-zeros dev placeholder is NEVER known (unverified
// by design). `releases` is injectable for testing without touching the file.
export function isKnownRelease(hash, releases = loadReleases()) {
  const h = normalizeHash(hash);
  if (!h || h === PLACEHOLDER_HASH) return false;
  return Object.prototype.hasOwnProperty.call(releases, h);
}

// Extract the first fenced ```json block (a GitHub issue-form `render: json`
// textarea wraps the pasted payload in one). Falls back to any fenced block.
// Returns the parsed object, or null if absent / unparseable.
export function parseIssueBody(body) {
  if (typeof body !== "string") return null;
  const match =
    /```json\s*\r?\n?([\s\S]*?)```/i.exec(body) || /```\s*\r?\n?([\s\S]*?)```/.exec(body);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

function checkNumber(errors, field, v, { cap, integer = false, min = 0 }) {
  const n = toNumber(v);
  if (!Number.isFinite(n)) {
    errors.push(`${field}: must be a finite number`);
    return undefined;
  }
  if (integer && !Number.isInteger(n)) {
    errors.push(`${field}: must be an integer`);
    return undefined;
  }
  if (n < min) {
    errors.push(`${field}: must be >= ${min}`);
    return undefined;
  }
  if (n > cap) {
    errors.push(`${field}: exceeds cap ${cap}`);
    return undefined;
  }
  return integer ? n : Math.round(n * 100) / 100;
}

// validateSubmission(raw, handle[, { releases }]):
//   { ok: true,  submission: {handle, ...fields, verified}, verified }
//   { ok: false, errors: [...] }
//
// `handle` comes from the issue AUTHOR metadata — never user-typed. `raw` is the
// parsed JSON payload. Unknown fields are dropped, never stored. A well-formed
// but unknown release_hash yields verified:false (recorded, not rejected).
export function validateSubmission(raw, handle, { releases } = {}) {
  const errors = [];

  const h = typeof handle === "string" ? handle.trim() : "";
  if (!HANDLE_RE.test(h)) {
    errors.push("handle: must be a valid GitHub username (taken from the issue author)");
  }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push("payload: must be a JSON object");
    return { ok: false, errors };
  }

  const value = {};
  value.total_coins = checkNumber(errors, "total_coins", raw.total_coins, {
    cap: CAPS.total_coins,
    integer: true,
  });
  value.dollars = checkNumber(errors, "dollars", raw.dollars, { cap: CAPS.dollars });
  value.swears_per_day = checkNumber(errors, "swears_per_day", raw.swears_per_day, {
    cap: CAPS.swears_per_day,
  });
  value.fbomb_pct = checkNumber(errors, "fbomb_pct", raw.fbomb_pct, { cap: CAPS.fbomb_pct });
  value.active_days = checkNumber(errors, "active_days", raw.active_days, {
    cap: CAPS.active_days,
    integer: true,
  });

  // top_word — short, censored-forms ONLY.
  const topWord = typeof raw.top_word === "string" ? raw.top_word.trim() : "";
  if (!topWord) {
    errors.push("top_word: required");
  } else if (topWord.length > CAPS.top_word_len) {
    errors.push(`top_word: longer than ${CAPS.top_word_len} chars`);
  } else if (containsUncensoredSwear(topWord)) {
    errors.push("top_word: must be censored (e.g. f***); uncensored words are rejected");
  } else {
    value.top_word = topWord;
  }

  // agent enum
  const agent = typeof raw.agent === "string" ? raw.agent.trim().toLowerCase() : "";
  if (!AGENTS.includes(agent)) {
    errors.push(`agent: must be one of ${AGENTS.join("|")}`);
  } else {
    value.agent = agent;
  }

  // app_version
  const appVersion = typeof raw.app_version === "string" ? raw.app_version.trim() : "";
  if (!appVersion || appVersion.length > CAPS.app_version_len || !APP_VERSION_RE.test(appVersion)) {
    errors.push("app_version: must be a semver-like string (e.g. 0.1.0)");
  } else {
    value.app_version = appVersion;
  }

  // release_hash — missing/malformed = HARD REJECT; unknown-but-valid = unverified.
  const normHash = normalizeHash(raw.release_hash);
  if (!normHash) {
    errors.push("release_hash: must be a 40-char lowercase hex string (a git commit SHA)");
  } else {
    value.release_hash = normHash;
  }

  if (errors.length) return { ok: false, errors };

  const verified = isKnownRelease(value.release_hash, releases ?? loadReleases());
  value.handle = h;
  value.verified = verified;
  return { ok: true, submission: value, verified };
}
