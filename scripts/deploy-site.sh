#!/usr/bin/env bash
# Deploy the static site (docs/) + its Caddy vhost to the host that serves
# swearjar.unfocused.ai. No build step — docs/ is plain static files.
#
#   DEPLOY_HOST=<ssh-host> ./scripts/deploy-site.sh
#
# DEPLOY_HOST is an SSH host/alias you can reach (e.g. one in ~/.ssh/config).
# The server IP is intentionally NOT baked in here (this repo is public).
#
# The leaderboard form needs no deploy-time wiring: the API is same-origin with
# this site (Caddy proxies /api/* to the funnel service — see
# scripts/deploy-funnel.sh), so docs/submit.html simply carries that origin in
# its own CONFIG block. Fork this and you edit that one line, not this script.
set -euo pipefail

HOST="${DEPLOY_HOST:-}"
if [ -z "$HOST" ]; then
  echo "error: set DEPLOY_HOST to the ssh host that serves swearjar.unfocused.ai" >&2
  echo "  e.g.  DEPLOY_HOST=myhost ./scripts/deploy-site.sh" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEBROOT="/var/www/swearjar"

echo "🫙 deploying site to ${HOST}:${WEBROOT}"
ssh "$HOST" "mkdir -p ${WEBROOT}"
# ship only the static site (skip markdown docs)
rsync -az --delete --exclude='*.md' "${ROOT}/docs/" "${HOST}:${WEBROOT}/"

echo "🫙 installing Caddy vhost"
scp -q "${ROOT}/infra/swearjar.caddy" "${HOST}:/etc/caddy/conf.d/swearjar.caddy"
# validate, then reload; if a prior reload wedged, fall back to restart
ssh "$HOST" '
  caddy validate --config /etc/caddy/Caddyfile >/dev/null &&
  { systemctl reload caddy || systemctl restart caddy; } &&
  sleep 3 && systemctl is-active caddy
'

echo "🫙 verifying https://swearjar.unfocused.ai/"
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://swearjar.unfocused.ai/ || true)
echo "   HTTP ${code}"
[ "$code" = "200" ] && echo "✅ live" || { echo "⚠️  not 200 (DNS/cert may still be settling)"; exit 1; }
