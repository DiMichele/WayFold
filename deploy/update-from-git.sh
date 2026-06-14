#!/usr/bin/env bash
# Aggiorna WayFold da GitHub e riavvia i servizi (utente wayfold).
set -eu

APP_DIR="/home/wayfold/apps/wayfold"
NODE_BIN="/home/wayfold/.nvm/versions/node/v22.22.3/bin"
export PATH="$NODE_BIN:$PATH"

cd "$APP_DIR"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Errore: $APP_DIR non è un repository git."
  echo "Esegui prima: bash deploy/setup-git-on-server.sh"
  exit 1
fi

echo "-> git pull..."
git pull --ff-only origin main

echo "-> npm ci (production)..."
npm ci --omit=dev

echo "-> riavvio servizi..."
systemctl --user restart wayfold-server.service
sleep 2
systemctl --user restart wayfold-bot.service

echo ""
echo "-> Stato servizi:"
systemctl --user --no-pager status wayfold-server.service | head -8
systemctl --user --no-pager status wayfold-bot.service | head -8

echo ""
curl -sf -o /dev/null -w "Health check: HTTP %{http_code}\n" http://127.0.0.1:3000/ || echo "Server non risponde su :3000"

echo "Aggiornamento completato."
