#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEST="/var/www/testingworkspace"
mkdir -p "$DEST/releases"
rsync -a --delete --exclude 'releases/' "$ROOT/public/" "$DEST/"
chown -R www-data:www-data "$DEST"
echo "Deployed testingworkspace → $DEST"
