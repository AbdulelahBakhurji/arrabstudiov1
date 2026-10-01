#!/usr/bin/env bash
# Run on the Arrab VPS as root (or: ssh arrab 'bash -s' < scripts/fix-coolify-prefix-now.sh)
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/arrab-studio}"
cd "$APP_DIR"
git fetch origin main
git reset --hard origin/main
grep -q '^ARRAB_API_ROUTE_PREFIX=' .env 2>/dev/null \
  && sed -i 's|^ARRAB_API_ROUTE_PREFIX=.*|ARRAB_API_ROUTE_PREFIX=/r/nmpi6uidtpkh1bdf|' .env \
  || printf '\nARRAB_API_ROUTE_PREFIX=/r/nmpi6uidtpkh1bdf\n' >> .env
corepack enable
pnpm install --frozen-lockfile
pnpm --filter @arrab/shared build
pnpm --filter @arrab/core build
pnpm --filter @arrab/database build
pnpm --filter @arrab/ai build
pnpm --filter @arrab/agents build
pnpm --filter @arrab/api build
systemctl restart arrab-api || systemctl restart arrab || true
# Coolify docker restart fallback
docker ps --format '{{.Names}}' | grep -i arrab | head -5 | while read n; do docker restart "$n" || true; done
sleep 2
curl -fsS http://127.0.0.1:8787/health || true
curl -fsS http://127.0.0.1:8787/r/nmpi6uidtpkh1bdf/v1/meta | head -c 200 || true
echo
