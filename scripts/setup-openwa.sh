#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/services/openwa/vendor"
ENV_FILE="$ROOT/.env"

echo "══ OpenWA setup for Arrab Studio ══"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required. Install Docker Desktop, then rerun this script."
  exit 1
fi

if [ ! -d "$VENDOR/.git" ]; then
  echo "Cloning OpenWA…"
  git clone --depth 1 https://github.com/rmyndharis/OpenWA.git "$VENDOR"
fi

cd "$VENDOR"

if [ ! -f .env ]; then
  cp .env.minimal .env
  echo "ALLOW_DEV_API_KEY=true" >> .env
fi

mkdir -p data/sessions data/media

echo "Starting OpenWA (Docker)…"
docker compose -f docker-compose.dev.yml up -d --build

echo "Waiting for OpenWA health…"
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:2785/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

API_KEY_FILE="$VENDOR/data/.api-key"
if [ -f "$API_KEY_FILE" ]; then
  API_KEY="$(tr -d '[:space:]' < "$API_KEY_FILE")"
  echo ""
  echo "OpenWA API key: $API_KEY"
  echo "Dashboard:      http://127.0.0.1:2785"
  echo "Swagger:        http://127.0.0.1:2785/api/docs"
else
  echo "Check container logs for the seeded API key: docker logs openwa-api"
  API_KEY=""
fi

WEBHOOK_SECRET=""
if [ -f "$ENV_FILE" ]; then
  WEBHOOK_SECRET="$(grep -E '^OPENWA_WEBHOOK_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
fi
if [ -z "$WEBHOOK_SECRET" ] || [ "${#WEBHOOK_SECRET}" -lt 16 ]; then
  WEBHOOK_SECRET="arrab-openwa-$(openssl rand -hex 12)"
  echo ""
  echo "Add to .env (min 16 chars):"
  echo "OPENWA_WEBHOOK_SECRET=$WEBHOOK_SECRET"
fi

SESSION_ID="arrab"
if [ -f "$ENV_FILE" ]; then
  SESSION_ID="$(grep -E '^OPENWA_SESSION_ID=' "$ENV_FILE" | head -1 | cut -d= -f2- || echo arrab)"
fi

if [ -n "$API_KEY" ]; then
  echo ""
  echo "Ensuring OpenWA session '$SESSION_ID'…"
  curl -sf -X POST "http://127.0.0.1:2785/api/sessions" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$SESSION_ID\"}" >/dev/null 2>&1 || true
  curl -sf -X POST "http://127.0.0.1:2785/api/sessions/$SESSION_ID/start" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{}" >/dev/null 2>&1 || true

  ARRAB_WEBHOOK="http://host.docker.internal:8787/v1/connectors/openwa/webhook"
  if [ -f "$ENV_FILE" ]; then
    BASE="$(grep -E '^ARRAB_PUBLIC_BASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
    PREFIX="$(grep -E '^ARRAB_API_ROUTE_PREFIX=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
    if [ -n "$BASE" ]; then
      ARRAB_WEBHOOK="${BASE%/}${PREFIX}/v1/connectors/openwa/webhook"
    fi
  fi

  echo "Registering webhook → $ARRAB_WEBHOOK"
  curl -sf -X POST "http://127.0.0.1:2785/api/sessions/$SESSION_ID/webhooks" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"$ARRAB_WEBHOOK\",\"events\":[\"message.received\"],\"secret\":\"$WEBHOOK_SECRET\",\"retryCount\":3}" \
    >/dev/null 2>&1 || echo "(Webhook registration skipped — connect Arrab API first or add manually in OpenWA.)"
fi

echo ""
echo "Next: pair WhatsApp at http://127.0.0.1:2785, then connect OpenWA in Arrab → Connectors."
