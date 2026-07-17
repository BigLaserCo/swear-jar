// swear-jar leaderboard funnel — a file-backed KV store.
//
// The submission handler (funnel/worker.mjs) was written against a Cloudflare KV
// binding: `get / put / delete / list`, async, with a `{ expirationTtl }` option
// on put. This module implements that SAME interface on a plain filesystem, so
// the handler runs unchanged on a normal Linux host (see funnel/server.mjs).
// Zero dependencies — Node stdlib only, like the rest of the project.
//
// Layout: one JSON file per key under the data dir (FUNNEL_DATA_DIR):
//
//   { "v": "<the stored string>", "e": <expiry epoch ms | null> }
//
// Key -> filename is `encodeURIComponent(key) + ".json"`. That encoding maps
// "/" to "%2F", so a key can never escape the data dir (no path traversal), and
// it is exactly reversible, so `list()` can hand back the original key names.
//
// TTL is stored, not scheduled: a row with a past `e` is treated as ABSENT by
// get/list and unlinked on sight (lazy purge), and a periodic `sweep()` reclaims
// rows that are never read again. So an expired pending token cannot be
// confirmed even if the sweep has not run yet — expiry is enforced on read.
//
// Crash safety: every write goes to a temp file and is then `rename()`d into
// place. rename(2) is atomic within a filesystem, so a reader (or a crash) sees
// either the whole old value or the whole new one — never a half-written row.

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// How often the server asks the store to reclaim expired rows.
export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

const SUFFIX = ".json";
const TMP_MARK = ".tmp-";

// key -> flat, traversal-proof filename. encodeURIComponent leaves only
// [A-Za-z0-9-_.!~*'()] unescaped — none of which is a path separator.
export function keyToFilename(key) {
  return encodeURIComponent(String(key)) + SUFFIX;
}

// filename -> key. Exact inverse of keyToFilename (a key that itself ends in
// ".json" round-trips, because only the ONE appended suffix is removed).
export function filenameToKey(file) {
  const base = file.endsWith(SUFFIX) ? file.slice(0, -SUFFIX.length) : file;
  try {
    return decodeURIComponent(base);
  } catch {
    return null; // not one of ours — ignore it
  }
}

// createStore(dir, { now }) -> a KV-shaped store.
// `now` is injectable so TTL behaviour is testable without sleeping.
export function createStore(dir, { now = () => Date.now() } = {}) {
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });

  const fileFor = (key) => path.join(root, keyToFilename(key));

  // Read + parse one row, enforcing expiry. Returns null for missing, expired,
  // or corrupt rows — the handler already treats a null read as "not there".
  function readRecord(key) {
    const file = fileFor(key);
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return null; // missing
    }
    let rec;
    try {
      rec = JSON.parse(text);
    } catch {
      return null; // corrupt — reported as absent, left on disk for inspection
    }
    if (rec && rec.e != null && Number(rec.e) <= now()) {
      unlinkQuiet(file); // lazy purge
      return null;
    }
    return rec && typeof rec.v === "string" ? rec : null;
  }

  // Atomic-ish write: full write to a unique temp file, then rename into place.
  function writeRecord(key, rec) {
    const file = fileFor(key);
    const tmp = file + TMP_MARK + randomUUID();
    try {
      fs.writeFileSync(tmp, JSON.stringify(rec), "utf8");
      fs.renameSync(tmp, file);
    } catch (err) {
      unlinkQuiet(tmp); // never leave a stray temp behind
      throw err;
    }
  }

  function unlinkQuiet(file) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* already gone */
    }
  }

  // Every real row in the data dir, skipping temp files and foreign names.
  function entries() {
    let names;
    try {
      names = fs.readdirSync(root);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      if (name.includes(TMP_MARK) || !name.endsWith(SUFFIX)) continue;
      const key = filenameToKey(name);
      if (key == null) continue;
      out.push({ key, file: path.join(root, name) });
    }
    return out;
  }

  return {
    dir: root,

    // KV.get(key) -> the stored string, or null if missing/expired.
    async get(key) {
      const rec = readRecord(key);
      return rec ? rec.v : null;
    },

    // KV.put(key, value, { expirationTtl }) — ttl is in SECONDS, like KV.
    // No ttl (the confirmed rows) = no expiry.
    async put(key, value, options = {}) {
      const ttl = Number(options?.expirationTtl);
      const e = Number.isFinite(ttl) && ttl > 0 ? now() + ttl * 1000 : null;
      writeRecord(key, { v: String(value), e });
    },

    // KV.delete(key) — idempotent.
    async delete(key) {
      unlinkQuiet(fileFor(key));
    },

    // KV.list({ prefix }) -> { keys: [{ name }], list_complete, cursor }.
    // One readdir covers the whole namespace at this scale, so a listing is
    // always complete in a single page and no cursor is ever handed back (the
    // handler's do/while loop exits after one pass). Expired rows are filtered
    // out AND purged here, so an expired key can never surface on the board.
    async list({ prefix = "" } = {}) {
      const keys = [];
      for (const { key } of entries()) {
        if (prefix && !key.startsWith(prefix)) continue;
        // null = missing / corrupt / expired (readRecord purges an expired row)
        if (readRecord(key) === null) continue;
        keys.push({ name: key });
      }
      keys.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      return { keys, list_complete: true, cursor: undefined };
    },

    // Reclaim every expired row. Returns how many were removed. Called on a
    // timer by the server; correctness never depends on it (expiry is enforced
    // on read) — it just stops dead pending tokens from accumulating on disk.
    async sweep() {
      let purged = 0;
      const t = now();
      for (const { file } of entries()) {
        let rec;
        try {
          rec = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch {
          continue; // unreadable/corrupt — leave it alone
        }
        if (rec && rec.e != null && Number(rec.e) <= t) {
          unlinkQuiet(file);
          purged++;
        }
      }
      return purged;
    },
  };
}
