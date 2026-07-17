// swear-jar leaderboard funnel — the database.
//
// The funnel's rows live in real tables (funnel/schema.sql), reached over
// PostgREST with the SERVICE ROLE key. That key bypasses RLS, so it never
// leaves this module: it is closed over below, never stored on the returned
// object, never put in a URL, never logged, and never in an error message.
// Zero dependencies — global fetch and nothing else, like the rest of the
// project.
//
// This is deliberately NOT a key/value client with a table behind it. Each
// method is one of the funnel's actual jobs, named for that job, so the handler
// reads as intent ("take this pending token") instead of storage mechanics
// ("read it, then delete it, and hope nobody raced me"). Where a rule has to
// hold under concurrency, the DATABASE holds it — not JavaScript:
//
//   takePending    ONE statement: DELETE … WHERE token = ? AND expires_at > now
//                  RETURNING *. Expiry and single-use are the same atomic
//                  operation, so an expired token is unusable whether or not the
//                  sweep has run, and a replayed token deletes zero rows and
//                  returns nothing. Neither rule depends on a prior read.
//   bumpRateLimit  the bump_rate_limit() function — INSERT … ON CONFLICT DO
//                  UPDATE … RETURNING, one round trip, no read-modify-write, so
//                  two concurrent submissions cannot both see the same count.
//   listBoard      the `board` view — the publishable-column allow-list is the
//                  database's, not ours. Email is structurally absent from it.
//
// Errors fail closed and say NOTHING: an operation label and an HTTP status.
// Never the URL (it can carry a token), never the response body (PostgREST
// echoes offending values back), never a row, never an email, never the key.
// funnel/handler.mjs turns a throw into a generic 400/500.

// How often the server asks the database to reclaim expired ephemeral rows.
// Housekeeping only: expiry is enforced on read (see takePending), so nothing
// is ever wrong because this has not run yet.
export const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

const REST_PREFIX = "/rest/v1/";

// THE expiry predicate, and the reason an expired token cannot be redeemed.
//
// `now` is Postgres's special datetime INPUT VALUE — the current transaction
// time — not a function call. PostgREST passes a filter value through as a text
// literal that Postgres casts to the column type, so the comparison is made by
// the DATABASE's clock at the instant the statement runs, not by this process's
// clock and not at some earlier read.
//
// (`gt.now()` also happens to work, but only because Postgres's datetime parser
// silently discards the parentheses as punctuation — `'now('` parses too, while
// `'now(junk)'` errors. That is an accident of the parser rather than a
// contract, and it reads like a function call that PostgREST never evaluates, so
// we send the documented bare form.)
export const PENDING_LIVE_FILTER = "expires_at=gt.now";

// The soft-delete trio, cleared together — see upsertEntry.
const NOT_DELETED = { deleted_at: null, deleted_by: null, deletion_reason: null };

// A failure that carries no state. `op` is always a fixed literal from a call
// site below, never data, so this message is safe to log or surface anywhere.
export class DbError extends Error {
  constructor(op, status) {
    super(status ? `database ${op} failed (HTTP ${status})` : `database ${op} failed (no response)`);
    this.name = "DbError";
    this.op = op;
    this.status = status;
  }
}

const enc = (v) => encodeURIComponent(String(v ?? ""));

// createDb({ url, serviceKey, fetch, now }) -> the funnel's database.
// `fetch` and `now` are injectable so the whole surface is testable without a
// network or a clock (see test/funnel-db.test.mjs).
export function createDb({ url, serviceKey, fetch: fetchImpl, now = () => Date.now() } = {}) {
  const base = String(url ?? "").replace(/\/+$/, "") + REST_PREFIX;
  const send = fetchImpl || globalThis.fetch;
  const key = String(serviceKey ?? "");

  async function request(op, method, pathAndQuery, { headers = {}, body } = {}) {
    const hasBody = body !== undefined;
    let res;
    try {
      res = await send(base + pathAndQuery, {
        method,
        headers: {
          // Supabase's gateway wants the key in `apikey`; PostgREST reads the
          // role from the bearer token. Both are the same service-role key.
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          ...(hasBody ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        ...(hasBody ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      // A transport failure must not surface the URL or a cause chain.
      throw new DbError(op, 0);
    }
    if (!res.ok) throw new DbError(op, res.status);
    return res;
  }

  // Parse a response body, tolerating the empty ones (204 from a void RPC, or
  // `return=minimal`). A malformed body is a failure, not a silent null.
  async function decode(op, res) {
    if (res.status === 204) return null;
    let text;
    try {
      text = await res.text();
    } catch {
      throw new DbError(op, res.status);
    }
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new DbError(op, res.status); // never echo the body
    }
  }

  const list = async (op, res) => {
    const rows = await decode(op, res);
    return Array.isArray(rows) ? rows : [];
  };

  return {
    // An unconfirmed submission, self-expiring. Nobody has agreed to anything
    // yet, so this row is ephemeral and hard-deletable by design.
    async putPending({ token, email, handle, stats, join_list, release_hash, app_version, ttlSeconds }) {
      const ttl = Math.max(0, Number(ttlSeconds) || 0);
      await request("pending.insert", "POST", "pending", {
        headers: { Prefer: "return=minimal" },
        body: {
          token,
          email,
          handle,
          stats,
          join_list: join_list === true,
          release_hash: release_hash ?? null,
          app_version: app_version ?? null,
          expires_at: new Date(now() + ttl * 1000).toISOString(),
        },
      });
    },

    // Redeem a pending token: return the row AND consume it, atomically.
    // Expired -> zero rows deleted -> null. Already redeemed -> zero rows -> null.
    // There is no window between the check and the consume because there is no
    // check: the filter IS the delete (see PENDING_LIVE_FILTER).
    async takePending(token) {
      const res = await request("pending.take", "DELETE", `pending?token=eq.${enc(token)}&${PENDING_LIVE_FILTER}`, {
        headers: { Prefer: "return=representation" },
      });
      const rows = await list("pending.take", res);
      return rows.length ? rows[0] : null;
    },

    // The confirmed entry — CUSTOMER DATA. Keyed by normalized email (the pk),
    // so a re-submit UPDATES the same person's row and can never duplicate them.
    //
    // The soft-delete trio is cleared here on purpose: confirming is a person
    // asking to be listed, and the trio is ONE fact — "hidden, by whom, why".
    // Keeping a stale deleted_by/deletion_reason on a row that is live on the
    // board would state that it is hidden, by someone, for a reason, while it is
    // plainly visible: a lie in the data, and one that would mislead the next
    // reader of that row. Nothing is destroyed by clearing it — the row itself
    // is fully retained (that is what the no-hard-delete trigger protects), and
    // the hiding was our bookkeeping, not the customer's submission.
    async upsertEntry({ email, handle, stats, join_list, verified, release_hash, app_version }) {
      const at = new Date(now()).toISOString();
      await request("entries.upsert", "POST", "entries", {
        // merge-duplicates = INSERT … ON CONFLICT (email) DO UPDATE. Every
        // column we send is overwritten; the ones we don't are left alone.
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: {
          email,
          handle,
          stats,
          join_list: join_list === true,
          verified: verified === true,
          release_hash: release_hash ?? null,
          app_version: app_version ?? null,
          confirmed_at: at,
          updated_at: at,
          ...NOT_DELETED,
        },
      });
    },

    // The public board: live rows, publishable columns, board order. Reading the
    // `board` view rather than `entries` is the point — the column allow-list is
    // the database's, so email cannot be selected here even by mistake.
    async listBoard({ limit = 100 } = {}) {
      const res = await request(
        "board.list",
        "GET",
        `board?select=*&order=total_coins.desc&limit=${enc(Math.max(0, Math.trunc(Number(limit) || 0)))}`
      );
      return list("board.list", res);
    },

    // The admin CSV path — and the ONLY method that reads an email out of the
    // database. Live rows only.
    async listEntriesForExport() {
      const res = await request(
        "entries.export",
        "GET",
        "entries?select=email,handle,join_list,confirmed_at,stats&deleted_at=is.null&order=confirmed_at.desc"
      );
      return list("entries.export", res);
    },

    // The count AFTER this hit, decided by the database in one statement.
    //
    // FAIL CLOSED. A missing or non-numeric answer THROWS — it must never be
    // coerced to a count. Note the trap this avoids: `Number(null)` is 0, and 0
    // is a finite number that compares as UNDER any limit, so a naive
    // `Number(body)` would turn a broken counter (a void answer, a 204, a null)
    // into "this submission is fine" and quietly disable rate limiting
    // altogether. The type is checked BEFORE any coercion for that reason.
    async bumpRateLimit(rateKey, ttlSeconds) {
      const res = await request("rate_limit.bump", "POST", "rpc/bump_rate_limit", {
        body: {
          p_key: String(rateKey),
          p_ttl_seconds: Math.max(0, Math.trunc(Number(ttlSeconds) || 0)),
        },
      });
      const raw = await decode("rate_limit.bump", res);
      const count =
        typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (!Number.isFinite(count)) throw new DbError("rate_limit.bump", res.status);
      return count;
    },

    // Reclaim expired pending/rate_limit rows. Housekeeping — correctness never
    // depends on it (see SWEEP_INTERVAL_MS).
    async sweep() {
      await request("sweep", "POST", "rpc/sweep_expired", { body: {} });
    },

    // The ONLY supported way to take someone off the board: the row is hidden
    // and who/when/why is recorded. Hard-deleting an entry is refused by the
    // database itself (funnel/schema.sql), whatever this code asks for.
    async softDeleteEntry(email, actor, reason) {
      await request("entries.soft_delete", "POST", "rpc/soft_delete_entry", {
        body: { p_email: String(email), p_actor: String(actor ?? ""), p_reason: String(reason ?? "") },
      });
    },
  };
}
