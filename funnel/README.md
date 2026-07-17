# swear-jar leaderboard funnel

The submission funnel for the public swear-jar leaderboard: a small Node
service (zero npm dependencies, Node stdlib only — like the rest of the
project) plus a static submit page (`docs/submit.html`).

**What it is.** Getting on the public board requires a **validated email**
(double opt-in): submit → we mail ONE confirmation link → the entry goes live
only after the click. The submit form also carries a **separate, optional,
unchecked-by-default** "join the mailing list" checkbox — that opt-in list is
the funnel. The board itself never shows an email, ever.

> **Deployment is an OWNER act.** The service runs on the owner's host and
> sends mail through the owner's mail-API account. Nothing in this repo
> contains a real key, host address, or credential — the secrets live in a
> file on the server that this repo never sees.

## Routes

| Route | What it does |
| --- | --- |
| `POST /api/submit` | Validate schema+caps, rate-limit, store a PENDING row (48h TTL), send ONE confirmation email. Response never echoes internal state. |
| `GET /api/confirm?token=…` | Single-use token → CONFIRMED row **keyed by normalized email** (a re-submit updates the same person's entry, never duplicates), then 302 → the thanks page. |
| `GET /api/board.json` | The public board. Confirmed rows only, public-safe fields only (handle, stats numbers, `verified` flag, submitted date). 5-minute public cache. |
| `GET /api/export.csv` | Admin-only (`Authorization: Bearer <ADMIN_TOKEN>`). Confirmed rows incl. email + `join_list`, for mailing-list import. |
| `GET /api/health` | Liveness only (`{"ok":true}`). Touches no data and no secrets. |

`verified` = the submission's `release_hash` is in the `KNOWN_RELEASES`
allow-list (comma-separated env var), i.e. the numbers came from a known build.

## Architecture

Three modules, each with one job:

- **`handler.mjs`** — the whole API: routing, validation, rate limits, CORS,
  the admin-token compare, and the one outbound mail call. `handleRequest(request, env)`
  takes a Fetch `Request` and returns a Fetch `Response`; it holds *all* the
  logic and never touches a socket, which is what makes it testable directly.
- **`server.mjs`** — the entrypoint: a `node:http` server that translates
  node's req/res to and from Fetch objects and calls `handleRequest`. It
  assembles the handler's `env` (config + the database as `env.DB`) and
  determines the client IP. It binds **127.0.0.1 only**.
- **`db.mjs`** — the database: a small PostgREST client (global `fetch`, no
  dependencies). Not a key/value layer with a table behind it — each method is
  one of the funnel's jobs, and the rules that must hold under concurrency are
  held by the database itself, not by JavaScript.

`schema.mjs` (field set + caps) is shared by all of it. Because the handler is
transport-agnostic, `server.mjs` re-uses it rather than reimplementing it —
there is exactly one copy of the rules, and the tests cover that one copy.

### The database

The rows live in real tables. **`funnel/schema.sql` is the schema** — apply it
to the project once, before the first deploy; it is the source of truth for
everything below.

| Table | What it holds |
| --- | --- |
| `entries` | Confirmed leaderboard entries, keyed by normalized email. **This is customer data** — a real person typed it into a form. Never hard-deleted (see below). |
| `pending` | Unconfirmed submissions awaiting the email click. Ephemeral, self-expiring, hard-deletable — nobody has agreed to anything yet. |
| `rate_limits` | Per-IP / per-email counters. Ephemeral. |
| `board` | A **view** exposing only publishable columns of live entries. |

Three properties are worth knowing, because the service leans on them:

- **The board's allow-list is the database's.** `board` selects handle, the
  stats numbers, `verified` and the submitted date, from rows that are not
  hidden. The email is *structurally absent* from the view, so `/api/board.json`
  cannot leak one even if application code asked it to. (`publicView` in the
  handler re-states the same field set — two walls, not one.)
- **Expiry is enforced on read, atomically.** Redeeming a token is a single
  `DELETE … WHERE token = ? AND expires_at > now RETURNING *`. So an expired
  link is dead the moment it expires whether or not anything swept it, and a
  replayed link deletes zero rows and gets nothing back — single-use with no
  window between the check and the consume. `sweep_expired()` (called on a
  timer) only reclaims space; correctness never depends on it.
- **Rate limits are counted by the database.** `bump_rate_limit(key, ttl)` is
  one atomic round trip returning the count *after* this hit, so two concurrent
  submissions can't both read the same count and both think they're under the
  limit.

**No hard delete, ever.** A `BEFORE DELETE` trigger on `entries` refuses the
statement outright — regardless of role, RLS or grants, so the trigger *is* the
policy rather than a rule application code has to remember. Taking someone off
the board means **hiding** them:

```sql
select soft_delete_entry('person@example.org', 'operator', 'requested removal');
```

That sets `deleted_at` / `deleted_by` / `deletion_reason`; live rows are the
ones with `deleted_at is null`. If that person ever confirms a submission again,
the entry is restored and the trio is cleared — they asked to be listed again,
and a live row must not claim it is hidden. (A genuine erasure request is the
one legitimate exception: drop the trigger deliberately, delete with an audit
record, put it back.)

Access is deny-by-default: RLS is on with **no policies** for `anon`, so the
publishable anon key reaches the `board` view and nothing else. The service uses
the **service-role** key, which bypasses RLS — which is why that key lives only
in `db.mjs`'s closure and never in the handler's `env`.

## Deploy

Target: **any Linux host with systemd + Caddy**. Caddy already terminates TLS
and serves the static site; the funnel is a loopback-bound service behind it.
No build step — the service is plain Node, run straight from source. It keeps
**no state on disk** (the rows are in the database), so the unit needs no
writable directory at all.

**One-time, on the project** — apply `funnel/schema.sql`.

**One-time, on the host** — create the environment file. The deploy script
requires it to exist and never creates, reads, or prints it:

```
sudo install -m 600 /dev/null /etc/swearjar-funnel.env
sudo editor /etc/swearjar-funnel.env
```

| Field | Required | What it is |
| --- | --- | --- |
| `MAIL_FROM` | yes | From address for the confirmation email (its domain must be verified with the mail provider). |
| `PUBLIC_HOST` | yes | Public host, used in the confirm link + the default thanks redirect. |
| `RESEND_API_KEY` | yes | The mail-API key. Server-side only — never exposed, never logged. |
| `ADMIN_TOKEN` | yes | Gates `/api/export.csv`. A long random string (`openssl rand -hex 32`). |
| `SUPABASE_URL` | yes | The database project's base URL. The service refuses to start if it isn't a valid `http(s)` URL. |
| `SUPABASE_SERVICE_KEY` | yes | The **service-role** key. It bypasses RLS, so treat it exactly like the mail key: server-side only, never in a browser, never logged, never in this repo. |
| `ALLOWED_ORIGIN` | no | The one origin allowed to POST. Defaults to `https://$PUBLIC_HOST` — correct for this same-origin deployment. |
| `THANKS_URL` | no | Override the post-confirm redirect. Defaults to `https://$PUBLIC_HOST/thanks`. |
| `KNOWN_RELEASES` | no | Comma-separated release hashes that earn the `verified` badge. |
| `PORT` | no | Loopback port. Defaults to `8788` (what the Caddy vhost proxies to). Set it if something else on the host already has that port. |
| `TRUST_PROXY` | no | `0` disables proxy-header trust (direct exposure — not this deployment). Defaults to on. |

**Every deploy** — one command:

```
DEPLOY_HOST=<ssh-host> ./scripts/deploy-funnel.sh
```

It rsyncs `funnel/` to `/opt/swearjar-funnel/`, installs + restarts the
systemd unit (`funnel/swearjar-funnel.service`, which runs `node server.mjs`),
installs the Caddy vhost (`infra/swearjar.caddy`, which reverse-proxies
`/api/*` to the service), and health-checks `GET /api/board.json` on the
public origin. It refuses to run if the environment file is missing, and exits
non-zero if the service or the health check comes back unhealthy.

The service **refuses to start** if a required variable is missing or the
database URL is malformed, naming the variables it needs and never printing a
value. Logs go to journald (`journalctl -u swearjar-funnel`) and contain no
emails, IPs, or request bodies.

The funnel's outbound calls are the **mail REST API** and its **database** —
that is the one sanctioned network surface in the whole project. The shipped
swear-jar app itself stays 100% local and zero-network; this server component
lives in `funnel/`, outside the app's `src/`/`bin/` no-network CI wall, on
purpose.

## Abuse posture

- **Per-IP rate limit** — 5 submissions/hour (TTL-bucketed counter, bumped
  atomically by the database — no read-modify-write race).
- **Per-email rate limit** — 3 submissions/day.
- **Trustworthy client IP** — the service binds loopback only, so Caddy is the
  only client that can reach it. The rate limit keys on the **rightmost**
  `X-Forwarded-For` entry — the address Caddy itself recorded — never the
  client-supplied leftmost value, which is forgeable. (Caddy discards a spoofed
  inbound header by default, and preserves the chain only for proxies it is told
  to trust; the rightmost entry is Caddy's own value under either posture, so
  this holds without depending on the proxy's configuration.) The handler reads
  the IP from an internal header that `server.mjs` sets from that trusted value
  and strips from every inbound request first, so a submitter cannot pick their
  own rate-limit bucket.
- **Hard body cap** — requests over 4 KB are rejected before parsing, and the
  cap is enforced on the bytes as they arrive: an oversize body stops being read
  at the limit rather than being buffered.
- **Schema caps** — every numeric field capped (`funnel/schema.mjs`); unknown
  fields dropped; `top_word` must be censored (an uncensored swear is rejected
  server-side).
- **Handle sanitization** — display names reduced to `[a-zA-Z0-9_ -]`, max 24.
- **Fail-closed** — unexpected errors return generic 400/500 bodies, never a
  stack, never internal state. A database error is never surfaced: `db.mjs`
  throws an operation label and an HTTP status, never the response body (which
  can echo offending values), never a URL (which can carry a live token), never
  a row, an email, or the key.
- **No PII on the board** — `board.json` fields pass a strict allow-list
  (`publicView`), *and* the `board` view they come from has no email column at
  all; email/join_list/IP are structurally absent (tested).
- **Single-use, self-expiring links** — enforced in one atomic statement, not by
  a read-then-delete.
- **Admin export token-gated** — Bearer token, constant-time-ish compare. It is
  the only path that reads an email out of the database.
- **No PII in logs** — the service never logs emails, IPs, or request bodies.
- **Least privilege** — the unit runs as a dynamic, unprivileged user with a
  read-only filesystem and no writable directory. The service-role key is held
  only in the database client's closure, never in the handler's `env`, so no
  route can reach it. The publishable anon key (if it is ever used) reaches the
  `board` view and nothing else: RLS is on with no policies for `anon`.

## Privacy promises (put these on the page, keep them true)

- The email is used **only** to verify the submission and — only if the box
  was ticked — the mailing list. It is **never displayed**, never sold, never
  shared.
- Double opt-in: nothing is published, and no list membership exists, until
  the confirmation link is clicked. Unconfirmed rows self-expire in 48 hours.
- Unsubscribe is honored (handled by the list provider on every send).
- Removal on request: `select soft_delete_entry(<email>, <actor>, <reason>)`
  hides the entry (and delete the contact at the list provider) — that is the
  entire footprint.

## GDPR notes

- **Consent**: the submit form has an explicit required consent line for the
  submission itself and a separate unchecked checkbox for the list (no
  bundled consent, no dark pattern). `join_list` is stored as literal boolean
  true only.
- **Double opt-in** via the emailed confirmation link; timestamped
  (`confirmed_at`).
- **Access/export**: `GET /api/export.csv` is the data inventory for the
  controller; a subject-access request is answered from it.
- **Erasure**: two different requests, deliberately kept apart.
  - *"Take me off the board"* → `soft_delete_entry(...)`. The entry stops being
    published and stops being exported; the row is retained, marked with who
    hid it, when, and why. This is the routine path, and it is what the
    `BEFORE DELETE` trigger exists to force.
  - *An Article 17 erasure request* → the row is genuinely destroyed. It is the
    one legitimate hard delete, and it is deliberate rather than casual: drop
    the trigger, delete the row with an audit record, reinstate the trigger, and
    delete the contact at the list provider. The trigger's whole point is that
    this cannot happen by accident, by a stray query, or by a bug.
  - There is no shadow copy either way: `pending` rows self-expire, and
    rate-limit counters hold no email past their TTL day-bucket.

## Mailing-list import flow

The mailing-list backend is an audience at the same mail provider as the
confirmation mail. Flow:

1. `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<public-host>/api/export.csv > confirmed.csv`
2. Filter to `join_list=true` rows.
3. Import into the audience (dashboard import or API). The provider handles
   unsubscribe links on every broadcast; a removal there must be mirrored by
   hiding the row (`soft_delete_entry`) on request.

## Files

- `funnel/handler.mjs` — the API handler (routes, rate limits, the mail call).
- `funnel/server.mjs` — the entrypoint: node:http ⇄ Fetch, config, loopback bind.
- `funnel/db.mjs` — the database client (PostgREST over global `fetch`).
- `funnel/schema.sql` — **the schema**: tables, the no-hard-delete trigger, the
  atomic functions, the `board` view, and the RLS posture.
- `funnel/schema.mjs` — field set + caps + validation. NOTE: a sibling module
  `scripts/leaderboard/schema.mjs` defines the same field set for the CLI
  side; the integrator unifies the two at merge.
- `funnel/swearjar-funnel.service` — the systemd unit.
- `infra/swearjar.caddy` — the vhost: static site + `/api/*` → the funnel.
- `scripts/deploy-funnel.sh` — the deploy.
- `docs/submit.html` — the submit page (CONFIG block at the top).
- `test/funnel.test.mjs` — schema + handler-helper tests, including the
  privacy-critical "publicView never contains email/join_list/IP" test.
- `test/funnel-db.test.mjs` — the database client: the exact request each method
  builds, expiry-on-read + single-use, and that an error leaks nothing.
- `test/funnel-server.test.mjs` — config, the request translation (body cap,
  forwarded-IP handling), and an end-to-end run of the real server on an
  ephemeral port, with the mail call stubbed and an in-memory database.
</content>
