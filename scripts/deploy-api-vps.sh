#!/usr/bin/env bash
# Run on the Arrab API VPS (or via: ssh arrab 'bash -s' < scripts/deploy-api-vps.sh)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/arrab-studio}"
REPO_URL="${REPO_URL:-https://github.com/AbdulelahBakhurji/arrabstudiov1.git}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-arrab-api}"

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "Missing $APP_DIR — clone the repo first."
  exit 1
fi

cd "$APP_DIR"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"
corepack enable
corepack prepare pnpm@latest --activate
pnpm install --frozen-lockfile
pnpm --filter @arrab/shared build
pnpm --filter @arrab/core build
pnpm --filter @arrab/database build
pnpm --filter @arrab/ai build
pnpm --filter @arrab/agents build
pnpm --filter @arrab/api build

if systemctl list-unit-files | grep -q "^${SERVICE}.service"; then
  systemctl restart "$SERVICE"
  systemctl --no-pager --full status "$SERVICE" | head -20
else
  echo "No systemd unit named ${SERVICE}.service — start the API manually."
fi

curl -fsS "http://127.0.0.1:${ARRAB_API_PORT:-8787}/health" || true
curl -fsS "http://127.0.0.1:${ARRAB_API_PORT:-8787}/v1/org/workforce" | head -c 200 || true
echo
echo "Deploy complete."
