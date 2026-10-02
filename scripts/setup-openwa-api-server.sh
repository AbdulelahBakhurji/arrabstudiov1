#!/usr/bin/env bash
# Run on the Arrab API VPS — OpenWA gateway + .env keys for @arrab/api.
# Usage: APP_DIR=/opt/arrab-studio bash scripts/setup-openwa-api-server.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
VENDOR="$ROOT/services/openwa/vendor"
OPENWA_PORT="${OPENWA_PORT:-2785}"
OPENWA_BASE="http://127.0.0.1:${OPENWA_PORT}"
API_PORT="${ARRAB_API_PORT:-8787}"

echo "══ OpenWA on API server (Arrab) ══"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required on the API VPS. Install Docker, then rerun."
  exit 1
fi

if [ ! -d "$VENDOR/.git" ]; then
  echo "Cloning OpenWA…"
  git clone --depth 1 https://github.com/rmyndharis/OpenWA.git "$VENDOR"
fi

cd "$VENDOR"
if [ ! -f .env ]; then
  cp .env.minimal .env
fi

# Linux Docker → API on host (bridge gateway). SSRF blocks private ranges by default.
DOCKER_HOST_IP="${DOCKER_HOST_IP:-172.17.0.1}"
ensure_openwa_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env
    rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}
ensure_openwa_env "SSRF_ALLOWED_HOSTS" "${DOCKER_HOST_IP},host.docker.internal,127.0.0.1,localhost"
ensure_openwa_env "WEBHOOK_SSRF_PROTECT" "true"

mkdir -p data/sessions data/media

echo "Starting OpenWA (bind ${OPENWA_PORT} on localhost)…"
docker compose -f docker-compose.dev.yml up -d --build

echo "Waiting for OpenWA health…"
for _ in $(seq 1 90); do
  if curl -sf "${OPENWA_BASE}/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

API_KEY=""
if [ -f "$VENDOR/data/.api-key" ]; then
  API_KEY="$(tr -d '[:space:]' < "$VENDOR/data/.api-key")"
fi
if [ -z "$API_KEY" ]; then
  echo "Could not read OpenWA API key from $VENDOR/data/.api-key — check: docker logs openwa-api"
  exit 1
fi

touch "$ENV_FILE"
set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

WEBHOOK_SECRET="$(grep -E '^OPENWA_WEBHOOK_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
if [ -z "$WEBHOOK_SECRET" ] || [ "${#WEBHOOK_SECRET}" -lt 16 ]; then
  WEBHOOK_SECRET="arrab-openwa-$(openssl rand -hex 16)"
fi

set_env "OPENWA_BASE_URL" "$OPENWA_BASE"
set_env "OPENWA_API_KEY" "$API_KEY"
set_env "OPENWA_WEBHOOK_SECRET" "$WEBHOOK_SECRET"

ROUTE_PREFIX="$(grep -E '^ARRAB_API_ROUTE_PREFIX=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
PUBLIC_BASE="$(grep -E '^ARRAB_PUBLIC_BASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
if [ -z "$PUBLIC_BASE" ]; then
  PUBLIC_BASE="https://api.arrabai.com"
fi
ARRAB_WEBHOOK="${PUBLIC_BASE%/}${ROUTE_PREFIX}/v1/connectors/openwa/webhook"

INTERNAL_WEBHOOK="http://${DOCKER_HOST_IP}:${API_PORT}${ROUTE_PREFIX}/v1/connectors/openwa/webhook"

echo "OpenWA API key written to $ENV_FILE (OPENWA_API_KEY)."
echo "Public webhook (for docs): $ARRAB_WEBHOOK"
echo "Registering OpenWA webhook → $INTERNAL_WEBHOOK"

extract_session_id() {
  node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); const id=Array.isArray(d)?d[0]?.id:d?.id; process.stdout.write(id||'');"
}

LEGACY_SESSION="arrab"
SESSION_JSON="$(curl -sf -X POST "${OPENWA_BASE}/api/sessions" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"${LEGACY_SESSION}\"}" 2>/dev/null || true)"
SESSION_UUID=""
if [ -n "$SESSION_JSON" ]; then
  SESSION_UUID="$(printf '%s' "$SESSION_JSON" | extract_session_id 2>/dev/null || true)"
fi
if [ -z "$SESSION_UUID" ]; then
  LIST_JSON="$(curl -sf "${OPENWA_BASE}/api/sessions?name=${LEGACY_SESSION}" \
    -H "X-API-Key: $API_KEY" 2>/dev/null || true)"
  if [ -n "$LIST_JSON" ]; then
    SESSION_UUID="$(printf '%s' "$LIST_JSON" | extract_session_id 2>/dev/null || true)"
  fi
fi

if [ -n "${SESSION_UUID:-}" ]; then
  if ! curl -sf -X POST "${OPENWA_BASE}/api/sessions/${SESSION_UUID}/webhooks" \
    -H "X-API-Key: $API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"${INTERNAL_WEBHOOK}\",\"events\":[\"message.received\"],\"secret\":\"${WEBHOOK_SECRET}\",\"retryCount\":3}"; then
    echo "(Legacy session webhook skipped — check SSRF_ALLOWED_HOSTS includes ${DOCKER_HOST_IP}.)"
  else
    echo ""
  fi
else
  echo "(Legacy session webhook skipped — per-user sessions register on link.)"
fi

echo ""
echo "Done. Restart arrab-api so it loads OPENWA_* from $ENV_FILE."
echo "Studio users link WhatsApp via Connect WhatsApp (QR); no keys on desktop."
