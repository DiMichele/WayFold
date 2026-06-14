#!/usr/bin/env bash
# sudo bash /home/wayfold/apps/wayfold/deploy/setup-nginx-root.sh
set -eu

APP_DIR="/home/wayfold/apps/wayfold"
CONF_SRC="$APP_DIR/deploy/nginx-wayfold.conf"
CONF_DST="/etc/nginx/sites-enabled/wayfold"

cp "$CONF_SRC" "$CONF_DST"
nginx -t
systemctl reload nginx
loginctl enable-linger wayfold

echo "Nginx aggiornato. Linger abilitato per wayfold."
curl -sf -o /dev/null -w "https://wayfold.xyz -> HTTP %{http_code}\n" https://wayfold.xyz/ || true
