#!/usr/bin/env bash
# Run on VPS as wayfold — pull/sync already done; start/reload stack.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/wayfold/apps/wayfold-compliance}"
COMPOSE="docker compose -f deploy/docker-compose.prod.yml"

cd "$APP_DIR"
mkdir -p data/db
# CISO images expect uid 1001 for db volume
if command -v sudo >/dev/null 2>&1; then
  sudo chown -R 1001:1001 data/db 2>/dev/null || chown -R 1001:1001 data/db 2>/dev/null || true
else
  chown -R 1001:1001 data/db 2>/dev/null || true
fi

echo "==> Pull + up Compliance stack"
$COMPOSE pull
$COMPOSE up -d --remove-orphans

echo "==> Wait for backend health"
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:18000/api/health/ >/dev/null 2>&1; then
    echo "backend healthy"
    break
  fi
  sleep 5
  if [[ "$i" -eq 60 ]]; then
    echo "backend health timeout" >&2
    $COMPOSE ps >&2 || true
    exit 1
  fi
done

echo "==> Stack status"
$COMPOSE ps
echo "Deploy app layer OK. Ensure nginx+cert for compliance.wayfold.xyz are installed."
