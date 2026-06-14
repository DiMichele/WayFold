#!/usr/bin/env bash
# Collega la cartella app esistente al repo GitHub (preserva .env, db.json, photos/, sessions/).
set -eu

APP_DIR="/home/wayfold/apps/wayfold"
REPO_URL="${WAYFOLD_REPO_URL:-git@github.com:DiMichele/WayFold.git}"
BRANCH="${WAYFOLD_BRANCH:-main}"

cd "$APP_DIR"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Repository git già presente in $APP_DIR"
  git remote -v
  exit 0
fi

echo "-> backup dati locali..."
BACKUP_DIR="$(mktemp -d)"
for item in .env db.json photos sessions; do
  if [ -e "$item" ]; then
    cp -a "$item" "$BACKUP_DIR/"
  fi
done

echo "-> init git e collegamento a $REPO_URL..."
git init -b "$BRANCH"
git remote add origin "$REPO_URL"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "-> ripristino dati locali..."
for item in .env db.json photos sessions; do
  if [ -e "$BACKUP_DIR/$item" ]; then
    cp -a "$BACKUP_DIR/$item" .
  fi
done
rm -rf "$BACKUP_DIR"

mkdir -p photos sessions
chmod +x deploy/update-from-git.sh deploy/install-on-server.sh 2>/dev/null || true

echo ""
echo "Setup git completato. Per aggiornare in futuro:"
echo "  bash $APP_DIR/deploy/update-from-git.sh"
