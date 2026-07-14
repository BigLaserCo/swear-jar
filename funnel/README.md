# swear-jar leaderboard funnel

The submission funnel for the public swear-jar leaderboard: a single
Cloudflare Worker (`funnel/worker.mjs` + `funnel/schema.mjs`, zero npm
dependencies) plus a static submit page (`docs/submit.html`).

**What it is.** Getting on the public board requires a **validated email**
(double opt-in): submit → we mail ONE confirmation link → the entry goes live
only after the click. The submit form also carries a **separate, optional,
unchecked-by-default** "join the mailing list" checkbox — that opt-in list is
the product's funnel. The board itself never shows an email, ever.

> **Deployment is an OWNER act.** The Worker runs on the owner's Cloudflare
> account and sends mail through the owner's Resend account, and **nothing
> goes live until the owner's pre-launch review**. Nothing in this repo
> contains a real key, account ID, or live endpoint — every value below is a
> placeholder.

## Routes

| Route | What it does |
| --- | --- |
| `POST /api/submit` | Validate schema+caps, rate-limit, store a PENDING row (48h TTL), send ONE confirmation email via Resend. Response never echoes internal state. |
| `GET /api/confirm?token=…` | Single-use token → CONFIRMED row **keyed by normalized email** (a re-submit updates the same person's entry, never duplicates), then 302 → the thanks page. |
| `GET /api/board.json` | The public board. Confirmed rows only, public-safe fields only (handle, stats numbers, `verified` flag, submitted date). 5-minute public cache. |
| `GET /api/export.csv` | Admin-only (`Authorization: Bearer <ADMIN_TOKEN>`). Confirmed rows incl. email + `join_list`, for mailing-list import. |

`verified` = the submission's `release_hash` is in the `KNOWN_RELEASES`
allow-list (comma-separated env var), i.e. the numbers came from a known build.

## Deploy (owner-only)

1. `npm i -g wrangler` and `wrangler login` (owner's Cloudflare account).
2. Copy `funnel/wrangler.toml.example` → `funnel/wrangler.toml` (gitignored
   territory — keep the real file out of the repo).
3. Create the KV namespace and paste its id into `wrangler.toml`:
   `wrangler kv namespace create JAR`
4. Set the two secrets (never in the repo, never in `wrangler.toml`):
   ```
   wrangler secret put RESEND_API_KEY   # from the owner's Resend dashboard
   wrangler secret put ADMIN_TOKEN      # long random string, e.g. openssl rand -hex 32
   ```
5. Fill the vars (`MAIL_FROM`, `PUBLIC_HOST`, `ALLOWED_ORIGIN`, optional
   `THANKS_URL`, `KNOWN_RELEASES`) and `wrangler deploy`.
6. Point `docs/submit.html`'s `CONFIG.API_BASE` at the deployed Worker origin
   and publish the page. Until then the page renders disabled with a
   "submissions opening soon" note — the site can ship first.

The Worker's **only outbound call is the Resend REST API**
(`https://api.resend.com/emails`) — the sanctioned hosted email service. The
shipped swear-jar app itself stays 100% local and zero-network; this server
component lives in `funnel/`, outside the app's `src/`/`bin/` no-network CI
wall, on purpose.

## Abuse posture

- **Per-IP rate limit** — 5 submissions/hour (KV counter, TTL-bucketed).
- **Per-email rate limit** — 3 submissions/day.
- **Hard body cap** — requests over 4 KB rejected before parsing.
- **Schema caps** — every numeric field capped (`funnel/schema.mjs`); unknown
  fields dropped; `top_word` must be censored (an
  uncensored swear is rejected server-side).
- **Handle sanitization** — display names reduced to `[a-zA-Z0-9_ -]`, max 24.
- **Fail-closed** — unexpected errors return generic 400/500 bodies, never a
  stack, never internal state.
- **No PII on the board** — `board.json` fields pass a strict allow-list
  (`publicView`); email/join_list/IP are structurally absent (tested).
- **Admin export token-gated** — Bearer token, constant-time-ish compare.
- **No PII in logs** — the Worker never logs emails, IPs, or request bodies.

## Privacy promises (put these on the page, keep them true)

- The email is used **only** to verify the submission and — only if the box
  was ticked — the mailing list. It is **never displayed**, never sold, never
  shared.
- Double opt-in: nothing is published, and no list membership exists, until
  the confirmation link is clicked. Unconfirmed rows self-expire in 48 hours.
- Unsubscribe is honored (handled by the list provider on every send).
- Deletion on request: delete the `confirmed:<email>` KV row (and the
  contact at the list provider) — that is the entire footprint.

## GDPR notes

- **Consent**: the submit form has an explicit required consent line for the
  submission itself and a separate unchecked checkbox for the list (no
  bundled consent, no dark pattern). `join_list` is stored as literal boolean
  true only.
- **Double opt-in** via the emailed confirmation link; timestamped
  (`confirmed_at`).
- **Access/export**: `GET /api/export.csv` is the data inventory for the
  controller; a subject-access request is answered from it.
- **Erasure**: delete the KV row + list-provider contact. There is no shadow
  copy; rate-limit counters hold no email past their TTL day-bucket.

## Mailing-list import flow

The mailing-list backend is **Resend Audiences** (same account as the
confirmation mail). Flow:

1. `curl -H "Authorization: Bearer $ADMIN_TOKEN" https://<worker-host>/api/export.csv > confirmed.csv`
2. Filter to `join_list=true` rows.
3. Import into the Resend Audience (dashboard import or API). Resend handles
   unsubscribe links on every broadcast; deletions there must be mirrored by
   deleting the KV row on request.

## Files

- `funnel/worker.mjs` — the Worker (routes, rate limits, Resend call).
- `funnel/schema.mjs` — field set + caps + validation. NOTE: a sibling module
  `scripts/leaderboard/schema.mjs` defines the same field set for the CLI
  side; the integrator unifies the two at merge.
- `funnel/wrangler.toml.example` — bindings/vars stubbed, placeholders only.
- `docs/submit.html` — the submit page (CONFIG block at the top).
- `test/funnel.test.mjs` — schema + worker-helper tests, including the
  privacy-critical "publicView never contains email/join_list/IP" test.
