#!/usr/bin/env bash
# Run on the Arrab API VPS (or via: ssh arrab 'bash -s' < scripts/deploy-api-vps.sh)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/arrab-studio}"
REPO_URL="${REPO_URL:-https://github.com/AbdulelahBakhurji/arrabstudiov1.git}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-arrab-api}"
# Coolify/Traefik public path on api.arrabai.com (proxy does not strip).
ROUTE_PREFIX="${ARRAB_API_ROUTE_PREFIX:-/r/nmpi6uidtpkh1bdf}"

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

ENV_FILE="$APP_DIR/.env"
touch "$ENV_FILE"
if grep -q '^ARRAB_API_ROUTE_PREFIX=' "$ENV_FILE"; then
  sed -i.bak "s|^ARRAB_API_ROUTE_PREFIX=.*|ARRAB_API_ROUTE_PREFIX=${ROUTE_PREFIX}|" "$ENV_FILE"
  rm -f "${ENV_FILE}.bak"
else
  printf '\nARRAB_API_ROUTE_PREFIX=%s\n' "$ROUTE_PREFIX" >> "$ENV_FILE"
fi
if ! grep -q '^ARRAB_PUBLIC_BASE_URL=' "$ENV_FILE"; then
  printf 'ARRAB_PUBLIC_BASE_URL=https://api.arrabai.com%s\n' "$ROUTE_PREFIX" >> "$ENV_FILE"
fi

if systemctl list-unit-files | grep -q "^${SERVICE}.service"; then
  systemctl restart "$SERVICE"
  systemctl --no-pager --full status "$SERVICE" | head -20
else
  echo "No systemd unit named ${SERVICE}.service — start the API manually."
fi

PORT="${ARRAB_API_PORT:-8787}"
curl -fsS "http://127.0.0.1:${PORT}/health" || true
curl -fsS "http://127.0.0.1:${PORT}${ROUTE_PREFIX}/health" || true
curl -fsS "http://127.0.0.1:${PORT}${ROUTE_PREFIX}/v1/meta" | head -c 200 || true
echo
echo "Deploy complete."
