#!/usr/bin/env bash
# Deploy the static site (docs/) + its Caddy vhost to the host that serves
# swearjar.unfocused.ai. No build step — docs/ is plain static files.
#
#   DEPLOY_HOST=<ssh-host> ./scripts/deploy-site.sh
#   DEPLOY_HOST=<ssh-host> SUBMIT_API_BASE=https://<worker-origin> ./scripts/deploy-site.sh
#
# DEPLOY_HOST is an SSH host/alias you can reach (e.g. one in ~/.ssh/config).
# The server IP is intentionally NOT baked in here (this repo is public).
#
# SUBMIT_API_BASE (optional) is the deployed funnel Worker origin, e.g.
# https://jar.example.com. docs/submit.html ships with CONFIG.API_BASE set to the
# "__API_BASE__" placeholder, which leaves the leaderboard form DISABLED ("opening
# soon") — the correct, honest state until the Worker is actually live. Set this
# var and the placeholder is rewritten to the real origin IN THE DEPLOYED COPY
# ONLY: the substitution happens on the server AFTER rsync, so the repo file is
# never modified and the checked-in default stays "disabled". Leave it unset and
# the deployed page keeps the placeholder (form stays off). Must be https://.
set -euo pipefail

HOST="${DEPLOY_HOST:-}"
if [ -z "$HOST" ]; then
  echo "error: set DEPLOY_HOST to the ssh host that serves swearjar.unfocused.ai" >&2
  echo "  e.g.  DEPLOY_HOST=myhost ./scripts/deploy-site.sh" >&2
  exit 1
fi

# Validate BEFORE anything ships, so a bad value can never reach the server.
API_BASE="${SUBMIT_API_BASE:-}"
if [ -n "$API_BASE" ]; then
  API_BASE="${API_BASE%/}" # submit.html appends "/api/submit" — no double slash
  case "$API_BASE" in
    https://*) ;;
    *)
      echo "error: SUBMIT_API_BASE must start with https:// (got: ${API_BASE})" >&2
      exit 1
      ;;
  esac
  # keep the value inert in the remote sed expression + shell
  case "$API_BASE" in
    *[\|\'\"\`\$\\\ ]*)
      echo "error: SUBMIT_API_BASE contains an unsafe character (| ' \" \` \$ \\ or space)" >&2
      exit 1
      ;;
  esac
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEBROOT="/var/www/swearjar"

echo "🫙 deploying site to ${HOST}:${WEBROOT}"
ssh "$HOST" "mkdir -p ${WEBROOT}"
# ship only the static site (skip markdown docs)
rsync -az --delete --exclude='*.md' "${ROOT}/docs/" "${HOST}:${WEBROOT}/"

# Point the leaderboard form at the live Worker — on the SERVER, after rsync, so
# the repo's submit.html keeps its checked-in default. Re-running is safe: rsync
# restores the file, then this rewrites it again.
if [ -n "$API_BASE" ]; then
  if grep -q '__API_BASE__' "${ROOT}/docs/submit.html"; then
    echo "🫙 pointing submit.html at ${API_BASE}"
    ssh "$HOST" "sed -i 's|__API_BASE__|${API_BASE}|g' ${WEBROOT}/submit.html &&
      ! grep -q '__API_BASE__' ${WEBROOT}/submit.html"
  else
    # Never let the var look like it did something it didn't: submit.html has no
    # placeholder to fill (it is already pointed at a configured origin).
    echo "warning: SUBMIT_API_BASE is set, but docs/submit.html carries no __API_BASE__" >&2
    echo "         placeholder — it is already configured. Deployed copy left as-is." >&2
  fi
elif grep -q '__API_BASE__' "${ROOT}/docs/submit.html"; then
  echo "🫙 SUBMIT_API_BASE unset — submit.html deploys with the form disabled (opening soon)"
fi

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
