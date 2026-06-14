#!/usr/bin/env bash
# Eseguito come utente wayfold dopo il primo upload.
set -eu

APP_DIR="/home/wayfold/apps/wayfold"
NODE_BIN="/home/wayfold/.nvm/versions/node/v22.22.3/bin"
export PATH="$NODE_BIN:$PATH"

cd "$APP_DIR"

echo "-> npm ci (production)..."
npm ci --omit=dev

mkdir -p photos sessions

echo "-> systemd user units..."
mkdir -p ~/.config/systemd/user
cp deploy/wayfold-server.service deploy/wayfold-bot.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable wayfold-server.service wayfold-bot.service
systemctl --user restart wayfold-server.service
sleep 2
systemctl --user restart wayfold-bot.service

echo ""
echo "-> Stato servizi:"
systemctl --user --no-pager status wayfold-server.service | head -12
systemctl --user --no-pager status wayfold-bot.service | head -12

echo ""
echo "-> Health check locale:"
curl -sf -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:3000/ || echo "Server non risponde su :3000"

echo ""
echo "Completato lato app. Se Nginx non e ancora configurato:"
echo "  sudo bash $APP_DIR/deploy/setup-nginx-root.sh"
