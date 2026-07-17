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

- **`worker.mjs`** — the whole API: routing, validation, rate limits, CORS,
  the admin-token compare, and the one outbound mail call. It is written
  against the Fetch API (`Request` in, `Response` out) and holds *all* the
  logic. Nothing about it is host-specific.
- **`server.mjs`** — the deployment entrypoint: a `node:http` server that
  translates node's req/res to and from Fetch objects and calls the handler in
  `worker.mjs` **verbatim**. It supplies the two things a runtime has to
  provide: the row store and the client IP. It binds **127.0.0.1 only**.
- **`store.mjs`** — a file-backed key/value store (one atomically-renamed JSON
  file per row under the data dir, TTL enforced on read plus a periodic sweep).

`schema.mjs` (field set + caps) is shared by all of it. Because the handler is
transport-agnostic, `server.mjs` re-uses it rather than reimplementing it —
there is exactly one copy of the rules, and the tests cover that one copy.

## Deploy

Target: **any Linux host with systemd + Caddy**. Caddy already terminates TLS
and serves the static site; the funnel is a loopback-bound service behind it.

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
| `ALLOWED_ORIGIN` | no | The one origin allowed to POST. Defaults to `https://$PUBLIC_HOST` — correct for this same-origin deployment. |
| `THANKS_URL` | no | Override the post-confirm redirect. Defaults to `https://$PUBLIC_HOST/thanks`. |
| `KNOWN_RELEASES` | no | Comma-separated release hashes that earn the `verified` badge. |
| `PORT` | no | Loopback port. Defaults to `8787` (what the Caddy vhost proxies to). |
| `FUNNEL_DATA_DIR` | no | Row store location. The unit sets it to the service's own state directory. |

**Every deploy** — one command:

```
DEPLOY_HOST=<ssh-host> ./scripts/deploy-funnel.sh
```

It rsyncs `funnel/` to `/opt/swearjar-funnel/`, installs + restarts the
systemd unit (`funnel/swearjar-funnel.service`), installs the Caddy vhost
(`infra/swearjar.caddy`, which reverse-proxies `/api/*` to the service),
and health-checks `GET /api/board.json` on the public origin. It refuses to
run if the environment file is missing, and exits non-zero if the service or
the health check comes back unhealthy.

The service **refuses to start** if a required variable is missing, naming the
variables it needs and never printing a value. Logs go to journald
(`journalctl -u swearjar-funnel`) and contain no emails, IPs, or request bodies.

The funnel's **only outbound call is the mail REST API** — that is the one
sanctioned network surface in the whole project. The shipped swear-jar app
itself stays 100% local and zero-network; this server component lives in
`funnel/`, outside the app's `src/`/`bin/` no-network CI wall, on purpose.

## Abuse posture

- **Per-IP rate limit** — 5 submissions/hour (TTL-bucketed counter).
- **Per-email rate limit** — 3 submissions/day.
- **Trustworthy client IP** — the service binds loopback only, so Caddy is the
  only client that can reach it. The rate limit keys on the **rightmost**
  `X-Forwarded-For` entry — the address Caddy itself recorded — never the
  client-supplied leftmost value, which is forgeable. (Caddy discards a spoofed
  inbound header by default, and preserves the chain only for proxies it is told
  to trust; the rightmost entry is Caddy's own value under either posture, so
  this holds without depending on the proxy's configuration.) Any inbound
  client-IP header is dropped before the handler sees the request, so a
  submitter cannot pick their own rate-limit bucket.
- **Hard body cap** — requests over 4 KB are rejected before parsing, and the
  cap is enforced on the bytes as they arrive: an oversize body stops being read
  at the limit rather than being buffered.
- **Schema caps** — every numeric field capped (`funnel/schema.mjs`); unknown
  fields dropped; `top_word` must be censored (an uncensored swear is rejected
  server-side).
- **Handle sanitization** — display names reduced to `[a-zA-Z0-9_ -]`, max 24.
- **Fail-closed** — unexpected errors return generic 400/500 bodies, never a
  stack, never internal state.
- **No PII on the board** — `board.json` fields pass a strict allow-list
  (`publicView`); email/join_list/IP are structurally absent (tested).
- **Admin export token-gated** — Bearer token, constant-time-ish compare.
- **No PII in logs** — the service never logs emails, IPs, or request bodies.
- **Least privilege** — the unit runs as a dynamic, unprivileged user with a
  read-only filesystem apart from its own state directory.

## Privacy promises (put these on the page, keep them true)

- The email is used **only** to verify the submission and — only if the box
  was ticked — the mailing list. It is **never displayed**, never sold, never
  shared.
- Double opt-in: nothing is published, and no list membership exists, until
  the confirmation link is clicked. Unconfirmed rows self-expire in 48 hours.
- Unsubscribe is honored (handled by the list provider on every send).
- Deletion on request: delete the `confirmed:<email>` row from the data dir
  (and the contact at the list provider) — that is the entire footprint.

## GDPR notes

- **Consent**: the submit form has an explicit required consent line for the
  submission itself and a separate unchecked checkbox for the list (no
  bundled consent, no dark pattern). `join_list` is stored as literal boolean
  true only.
- **Double opt-in** via the emailed confirmation link; timestamped
  (`confirmed_at`).
- **Access/export**: `GET /api/export.csv` is the data inventory for the
  controller; a subject-access request is answered from it.
- **Erasure**: delete the row + the list-provider contact. There is no shadow
  copy; rate-limit counters hold no email past their TTL day-bucket.

## Mailing-list import flow

The mailing-list backend is an audience at the same mail provider as the
confirmation mail. Flow:

1. `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<public-host>/api/export.csv > confirmed.csv`
2. Filter to `join_list=true` rows.
3. Import into the audience (dashboard import or API). The provider handles
   unsubscribe links on every broadcast; deletions there must be mirrored by
   deleting the row on request.

## Files

- `funnel/worker.mjs` — the API handler (routes, rate limits, the mail call).
- `funnel/server.mjs` — the Node entrypoint: node:http ⇄ Fetch adapter, config,
  loopback bind.
- `funnel/store.mjs` — the file-backed row store (TTL + atomic writes).
- `funnel/schema.mjs` — field set + caps + validation. NOTE: a sibling module
  `scripts/leaderboard/schema.mjs` defines the same field set for the CLI
  side; the integrator unifies the two at merge.
- `funnel/swearjar-funnel.service` — the systemd unit.
- `infra/swearjar.caddy` — the vhost: static site + `/api/*` → the funnel.
- `scripts/deploy-funnel.sh` — the deploy.
- `docs/submit.html` — the submit page (CONFIG block at the top).
- `test/funnel.test.mjs` — schema + handler-helper tests, including the
  privacy-critical "publicView never contains email/join_list/IP" test.
- `test/funnel-store.test.mjs` — the row store (TTL, atomic writes, listing).
- `test/funnel-server.test.mjs` — config, the request adapter (body cap,
  forwarded-IP handling), and an end-to-end run of the real server on an
  ephemeral port with the mail call stubbed.

`funnel/wrangler.toml.example` is a leftover from the original hosting target;
`worker.mjs` still works as a Cloudflare Worker entrypoint, but the Node
service above is **the** deployment.
