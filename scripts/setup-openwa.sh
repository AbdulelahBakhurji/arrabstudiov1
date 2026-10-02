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

# Arrab API runs on the host; OpenWA blocks private webhook URLs unless allowlisted.
ensure_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    # macOS/BSD sed needs backup suffix; strip the backup after.
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env
    rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
ensure_env "SSRF_ALLOWED_HOSTS" "host.docker.internal,127.0.0.1,localhost"
ensure_env "WEBHOOK_SSRF_PROTECT" "true"

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

SESSION_NAME="arrab"
if [ -f "$ENV_FILE" ]; then
  SESSION_NAME="$(grep -E '^OPENWA_SESSION_ID=' "$ENV_FILE" | head -1 | cut -d= -f2- || echo arrab)"
fi

if [ -n "$API_KEY" ]; then
  echo ""
  echo "Ensuring OpenWA session name '$SESSION_NAME'…"
  extract_session_id() {
    # stdin: create object or list array from OpenWA
    node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const id=Array.isArray(d)?d[0]?.id:d?.id; process.stdout.write(id||'');"
  }
  # OpenWA path ids are UUIDs — create by name, then use the returned id.
  SESSION_JSON="$(curl -sf -X POST "http://127.0.0.1:2785/api/sessions" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$SESSION_NAME\"}" 2>/dev/null || true)"
  SESSION_UUID=""
  if [ -n "$SESSION_JSON" ]; then
    SESSION_UUID="$(printf '%s' "$SESSION_JSON" | extract_session_id 2>/dev/null || true)"
  fi
  if [ -z "$SESSION_UUID" ]; then
    SESSION_JSON="$(curl -sf "http://127.0.0.1:2785/api/sessions?name=${SESSION_NAME}" \
      -H "X-API-Key: $API_KEY" 2>/dev/null || true)"
    if [ -n "$SESSION_JSON" ]; then
      SESSION_UUID="$(printf '%s' "$SESSION_JSON" | extract_session_id 2>/dev/null || true)"
    fi
  fi

  if [ -n "${SESSION_UUID:-}" ] && [ "$SESSION_UUID" != "null" ]; then
    curl -sf -X POST "http://127.0.0.1:2785/api/sessions/$SESSION_UUID/start" \
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

    echo "Registering webhook → $ARRAB_WEBHOOK (session $SESSION_UUID)"
    if ! curl -sf -X POST "http://127.0.0.1:2785/api/sessions/$SESSION_UUID/webhooks" \
      -H "X-API-Key: $API_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"url\":\"$ARRAB_WEBHOOK\",\"events\":[\"message.received\"],\"secret\":\"$WEBHOOK_SECRET\",\"retryCount\":3}"; then
      echo "(Webhook registration failed — start Arrab API and ensure SSRF_ALLOWED_HOSTS includes the webhook host.)"
    else
      echo ""
    fi
  else
    echo "(Could not resolve session UUID for '$SESSION_NAME' — Studio will create per-user sessions on Connect WhatsApp.)"
  fi
fi

echo ""
echo "Next:"
echo "  1. Set OPENWA_API_KEY=$API_KEY in the Arrab API .env"
echo "  2. Set OPENWA_WEBHOOK_SECRET=$WEBHOOK_SECRET"
echo "  3. pnpm dev:api — then Connect WhatsApp in Studio and scan the QR"
