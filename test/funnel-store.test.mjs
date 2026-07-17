// Tests for funnel/store.mjs — the file-backed row store behind the submission
// handler. The contract that matters: a TTL'd row is GONE on read the moment it
// expires (an expired confirmation token must never be redeemable, sweep or no
// sweep), a write is all-or-nothing, and a key can never escape the data dir.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createStore, keyToFilename, filenameToKey } from "../funnel/store.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "swear-funnel-store-"));
}

// A store with a controllable clock, so TTL behaviour is tested without sleeping.
function withClock(dir) {
  let t = Date.UTC(2026, 6, 10, 12, 0, 0);
  const store = createStore(dir, { now: () => t });
  return { store, advance: (ms) => (t += ms) };
}

const HOUR = 3_600_000;

// ── the store surface ────────────────────────────────────────────────────────
test("store put/get round-trips a value and reports a missing key as null", async () => {
  const store = createStore(tmpDir());
  await store.put("pending:abc", JSON.stringify({ email: "a@b.co" }));
  assert.equal(await store.get("pending:abc"), '{"email":"a@b.co"}');
  assert.equal(await store.get("pending:nope"), null);
});

test("store put overwrites a key in place, leaving exactly one row", async () => {
  const dir = tmpDir();
  const store = createStore(dir);
  await store.put("confirmed:a@b.co", "first");
  await store.put("confirmed:a@b.co", "second");
  assert.equal(await store.get("confirmed:a@b.co"), "second");
  assert.equal(fs.readdirSync(dir).length, 1, "one key = one file, never a duplicate");
});

test("store delete removes a key and is idempotent", async () => {
  const store = createStore(tmpDir());
  await store.put("pending:t", "v");
  await store.delete("pending:t");
  assert.equal(await store.get("pending:t"), null);
  await store.delete("pending:t"); // deleting a gone key must not throw
});

// ── TTL ──────────────────────────────────────────────────────────────────────
test("a row written with no ttl never expires", async () => {
  const { store, advance } = withClock(tmpDir());
  await store.put("confirmed:a@b.co", "forever");
  advance(365 * 24 * HOUR);
  assert.equal(await store.get("confirmed:a@b.co"), "forever");
});

test("an expired row reads as absent the instant its ttl passes", async () => {
  const { store, advance } = withClock(tmpDir());
  await store.put("pending:tok", "row", { expirationTtl: 48 * 3600 }); // 48h, as the handler uses

  advance(47 * HOUR);
  assert.equal(await store.get("pending:tok"), "row", "still live before the ttl");

  advance(2 * HOUR); // now 49h — past it
  assert.equal(await store.get("pending:tok"), null, "expired rows are not redeemable");
});

test("reading an expired row purges it from disk (lazy purge)", async () => {
  const dir = tmpDir();
  const { store, advance } = withClock(dir);
  await store.put("pending:tok", "row", { expirationTtl: 60 });
  assert.equal(fs.readdirSync(dir).length, 1);

  advance(61_000);
  assert.equal(await store.get("pending:tok"), null);
  assert.equal(fs.readdirSync(dir).length, 0, "the expired file is unlinked on read");
});

test("sweep reclaims every expired row and keeps the live ones", async () => {
  const dir = tmpDir();
  const { store, advance } = withClock(dir);
  await store.put("pending:a", "1", { expirationTtl: 60 });
  await store.put("pending:b", "2", { expirationTtl: 60 });
  await store.put("pending:c", "3", { expirationTtl: 86_400 }); // outlives the others
  await store.put("confirmed:x@y.co", "4"); // no ttl at all

  advance(61_000);
  assert.equal(await store.sweep(), 2, "exactly the two expired rows are reclaimed");
  assert.equal(fs.readdirSync(dir).length, 2);
  assert.equal(await store.get("pending:c"), "3");
  assert.equal(await store.get("confirmed:x@y.co"), "4");
  assert.equal(await store.sweep(), 0, "a second sweep has nothing left to do");
});

// ── list ─────────────────────────────────────────────────────────────────────
test("list returns prefix-matched keys, sorted, complete in one page", async () => {
  const store = createStore(tmpDir());
  await store.put("confirmed:b@x.co", "2");
  await store.put("confirmed:a@x.co", "1");
  await store.put("pending:tok", "p");
  await store.put("rl:ip:1.2.3.4:1", "3");

  const page = await store.list({ prefix: "confirmed:" });
  assert.deepEqual(page.keys.map((k) => k.name), ["confirmed:a@x.co", "confirmed:b@x.co"]);
  assert.equal(page.list_complete, true, "the handler's do/while must terminate");
  assert.equal(page.cursor, undefined);

  const all = await store.list();
  assert.equal(all.keys.length, 4, "no prefix = the whole namespace");
});

test("list hides expired rows, so an expired entry can never reach the board", async () => {
  const { store, advance } = withClock(tmpDir());
  await store.put("confirmed:live@x.co", "1");
  await store.put("confirmed:ghost@x.co", "2", { expirationTtl: 60 });

  advance(61_000);
  const page = await store.list({ prefix: "confirmed:" });
  assert.deepEqual(page.keys.map((k) => k.name), ["confirmed:live@x.co"]);
});

test("list is empty on a fresh data dir", async () => {
  const store = createStore(path.join(tmpDir(), "does-not-exist-yet"));
  assert.deepEqual((await store.list({ prefix: "confirmed:" })).keys, []);
});

// ── durability + safety ──────────────────────────────────────────────────────
test("a put leaves no temp file behind, and a stray temp file is ignored", async () => {
  const dir = tmpDir();
  const store = createStore(dir);
  await store.put("confirmed:a@b.co", "v");
  assert.ok(
    !fs.readdirSync(dir).some((f) => f.includes(".tmp-")),
    "the rename target is the only file left"
  );

  // Simulate a crash mid-write: a temp file that never got renamed. It must not
  // surface as a row (that is the point of writing to a temp name first).
  fs.writeFileSync(path.join(dir, "confirmed%3Az%40b.co.json.tmp-abc"), '{"v":"junk","e":null}');
  const page = await store.list({ prefix: "confirmed:" });
  assert.deepEqual(page.keys.map((k) => k.name), ["confirmed:a@b.co"]);
  assert.equal(await store.get("confirmed:z@b.co"), null, "a half-written row is not readable");
});

test("a corrupt row reads as absent and is skipped by list, never crashing the board", async () => {
  const dir = tmpDir();
  const store = createStore(dir);
  await store.put("confirmed:good@x.co", "1");
  fs.writeFileSync(path.join(dir, keyToFilename("confirmed:bad@x.co")), "{not json");

  assert.equal(await store.get("confirmed:bad@x.co"), null);
  const page = await store.list({ prefix: "confirmed:" });
  assert.deepEqual(page.keys.map((k) => k.name), ["confirmed:good@x.co"]);
});

test("keys with separators round-trip, and no key can escape the data dir", async () => {
  const dir = tmpDir();
  const store = createStore(dir);
  const nasty = [
    "confirmed:jar.fan+tag@example.org", // a real key shape: ':' '.' '+' '@'
    "../../etc/passwd", // traversal attempt
    "rl:ip:2001:db8::1:487000", // colons everywhere
    "a b/c\\d", // spaces + both slashes
    "weird.json", // a key that ends in the suffix
  ];
  for (const key of nasty) await store.put(key, `v:${key}`);

  for (const key of nasty) {
    assert.equal(await store.get(key), `v:${key}`, `round-trips: ${key}`);
    assert.equal(filenameToKey(keyToFilename(key)), key, `filename is reversible: ${key}`);
  }
  // Every file landed flat inside the data dir — nothing climbed out.
  assert.equal(fs.readdirSync(dir).length, nasty.length);
  for (const f of fs.readdirSync(dir)) {
    assert.ok(!f.includes("/") && !f.includes("\\"), `flat filename: ${f}`);
  }
  assert.equal(fs.existsSync(path.join(dir, "..", "..", "etc", "passwd")), false);
});
