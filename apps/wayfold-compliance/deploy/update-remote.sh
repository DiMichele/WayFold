#!/usr/bin/env bash
# Run on VPS as wayfold — pull/sync already done; start/reload stack.
set -euo pipefail

APP_DIR="${APP_DIR:-/home/wayfold/apps/wayfold-compliance}"
export WAYFOLD_COMPLIANCE_ROOT="$APP_DIR"
COMPOSE=(docker compose --project-directory "$APP_DIR" -f "$APP_DIR/deploy/docker-compose.prod.yml")

cd "$APP_DIR"
mkdir -p data/db
# Clean mistaken bind targets from earlier path-resolution bugs
rm -rf deploy/data 2>/dev/null || true
# GRC core images expect uid 1001 for db volume (no passwordless sudo on VPS:
# use a one-shot root container to chown the bind mount).
if ! docker run --rm -v "$APP_DIR/data/db:/code/db" alpine:3.20 \
  sh -c 'chown -R 1001:1001 /code/db && chmod -R u+rwX,g+rwX /code/db'; then
  echo "WARN: docker chown failed; trying chmod a+rwx on data/db" >&2
  chmod -R a+rwx data/db || true
fi

echo "==> Pull + up Compliance stack"
# Tear down previous project names (compose file dir was used as project name before)
docker compose -f "$APP_DIR/deploy/docker-compose.prod.yml" --project-directory "$APP_DIR/deploy" down --remove-orphans 2>/dev/null || true
"${COMPOSE[@]}" down --remove-orphans 2>/dev/null || true
for c in wayfold-compliance-backend wayfold-compliance-frontend wayfold-compliance-huey \
         wayfold-compliance-engine wayfold-compliance-qdrant; do
  docker rm -f "$c" 2>/dev/null || true
done
"${COMPOSE[@]}" pull
# Recreate only when config/image changed; avoid full library re-seed every deploy
"${COMPOSE[@]}" up -d --remove-orphans

echo "==> Wait for backend health"
for i in $(seq 1 60); do
  # Host must be in ALLOWED_HOSTS (127.0.0.1 alone is rejected by Django)
  if curl -fsS -H 'Host: localhost' http://127.0.0.1:18000/api/health/ >/dev/null 2>&1; then
    echo "backend healthy"
    break
  fi
  # Compose may already mark the service healthy before our host-header curl succeeds
  status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' wayfold-compliance-backend 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    echo "backend healthy (docker healthcheck)"
    break
  fi
  sleep 5
  if [[ "$i" -eq 60 ]]; then
    echo "backend health timeout" >&2
    "${COMPOSE[@]}" ps >&2 || true
    docker logs wayfold-compliance-backend 2>&1 | tail -40 >&2 || true
    exit 1
  fi
done

echo "==> Stack status"
"${COMPOSE[@]}" ps
echo "Deploy app layer OK. Ensure nginx+cert for compliance.wayfold.xyz are installed."
