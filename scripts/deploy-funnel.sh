#!/usr/bin/env bash
# Deploy the leaderboard funnel API (funnel/) to the host that serves
# swearjar.unfocused.ai: rsync the service, install/restart its systemd unit,
# install the Caddy vhost that proxies /api/* to it, then health-check the
# public origin. No build step — the service is plain Node, zero dependencies.
#
#   DEPLOY_HOST=<ssh-host> ./scripts/deploy-funnel.sh
#
# DEPLOY_HOST is an SSH host/alias you can reach (e.g. one in ~/.ssh/config).
# The server IP is intentionally NOT baked in here (this repo is public).
#
# PREREQUISITES — both are OWNER acts, done once, before the first deploy:
#   1. the database schema (funnel/schema.sql) is applied to the project.
#   2. /etc/swearjar-funnel.env exists on the host (see funnel/README.md for the
#      fields). It holds the secrets; this script only checks that it EXISTS. It
#      never creates it, never reads it, never prints it, and it is never in this
#      repo — nor is any database credential.
set -euo pipefail

HOST="${DEPLOY_HOST:-}"
if [ -z "$HOST" ]; then
  echo "error: set DEPLOY_HOST to the ssh host that serves swearjar.unfocused.ai" >&2
  echo "  e.g.  DEPLOY_HOST=myhost ./scripts/deploy-funnel.sh" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPDIR="/opt/swearjar-funnel"
ENVFILE="/etc/swearjar-funnel.env"
UNIT="swearjar-funnel.service"
ORIGIN="https://swearjar.unfocused.ai"

echo "🫙 checking prerequisites on ${HOST}"
if ! ssh "$HOST" "test -f ${ENVFILE}"; then
  echo "error: ${ENVFILE} does not exist on ${HOST}." >&2
  echo "  Create it there yourself (root-owned, chmod 600) with:" >&2
  echo "    MAIL_FROM=...  PUBLIC_HOST=...  RESEND_API_KEY=...  ADMIN_TOKEN=..." >&2
  echo "    SUPABASE_URL=...  SUPABASE_SERVICE_KEY=..." >&2
  echo "  optional: ALLOWED_ORIGIN, THANKS_URL, KNOWN_RELEASES, PORT" >&2
  echo "  See funnel/README.md. This script never creates, reads, or prints it." >&2
  exit 1
fi
if ! ssh "$HOST" 'command -v node >/dev/null'; then
  echo "error: node is not installed on ${HOST} (the service needs Node >= 20)" >&2
  exit 1
fi

echo "🫙 deploying funnel to ${HOST}:${APPDIR}"
ssh "$HOST" "mkdir -p ${APPDIR}"
# Ship only the runnable service (skip the docs).
# --delete is safe here: the service stores no rows on disk — they live in the
# database — so nothing under ${APPDIR} is data. The schema (funnel/schema.sql)
# rides along for reference; it is applied to the database by the operator, not
# by this script, which holds no database credential.
rsync -az --delete --exclude='*.md' "${ROOT}/funnel/" "${HOST}:${APPDIR}/"

echo "🫙 installing systemd unit"
scp -q "${ROOT}/funnel/${UNIT}" "${HOST}:/etc/systemd/system/${UNIT}"
ssh "$HOST" "
  systemctl daemon-reload &&
  systemctl enable ${UNIT} >/dev/null 2>&1 &&
  systemctl restart ${UNIT} &&
  sleep 2 && systemctl is-active ${UNIT}
"

echo "🫙 installing Caddy vhost (proxies /api/* to the funnel)"
scp -q "${ROOT}/infra/swearjar.caddy" "${HOST}:/etc/caddy/conf.d/swearjar.caddy"
# validate, then reload; if a prior reload wedged, fall back to restart
ssh "$HOST" '
  caddy validate --config /etc/caddy/Caddyfile >/dev/null &&
  { systemctl reload caddy || systemctl restart caddy; } &&
  sleep 3 && systemctl is-active caddy
'

echo "🫙 verifying ${ORIGIN}/api/board.json"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${ORIGIN}/api/board.json" || true)
echo "   HTTP ${code}"
if [ "$code" = "200" ]; then
  echo "✅ funnel live"
else
  echo "⚠️  not 200 — inspect with:  ssh ${HOST} journalctl -u ${UNIT} -n 50" >&2
  exit 1
fi
