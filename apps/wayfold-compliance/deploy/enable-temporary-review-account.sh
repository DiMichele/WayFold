#!/usr/bin/env bash
# Explicit one-shot: enable TEMPORARY REVIEW credential (username from env, password OUT OF BAND).
# Does NOT run during deploy or live-verify.
set -euo pipefail
APP_DIR="${APP_DIR:-/home/wayfold/apps/wayfold-compliance}"
AUTH="$APP_DIR/data/engine/.auth.env"
USERNAME="${WAYFOLD_AUTH_USER:-admin}"
PASSWORD="${WAYFOLD_AUTH_PASSWORD:-}"
if [[ -z "${PASSWORD}" ]]; then
  echo "ERROR: set WAYFOLD_AUTH_PASSWORD in the environment (not stored in git)." >&2
  exit 1
fi
SECRET=$(grep '^WAYFOLD_SESSION_SECRET=' "$AUTH" 2>/dev/null | cut -d= -f2- || true)
if [[ -z "${SECRET}" ]]; then SECRET=$(openssl rand -hex 32); fi
umask 077
cat >"$AUTH" <<EOF
WAYFOLD_AUTH_USER=$USERNAME
WAYFOLD_AUTH_PASSWORD=$PASSWORD
WAYFOLD_SESSION_SECRET=$SECRET
EOF
chmod 600 "$AUTH"
echo "Temporary review account enabled for user: $USERNAME (password not logged)."
docker restart wayfold-compliance-engine >/dev/null 2>&1 || true
