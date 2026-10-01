#!/usr/bin/env bash
# Post-deploy smoke test for the API fixes. Read-mostly: it creates ONE throwaway agent and archives it.
# Usage: API_URL=http://127.0.0.1:8787 SESSION_TOKEN=<account session token> bash scripts/smoke-api.sh
set -u
API_URL="${API_URL:-http://127.0.0.1:8787}"
PREFIX="${API_PREFIX:-}"
BASE="$API_URL$PREFIX"
TOKEN="${SESSION_TOKEN:-}"
pass=0; fail=0
ok()  { echo "  PASS  $1"; pass=$((pass+1)); }
bad() { echo "  FAIL  $1  ($2)"; fail=$((fail+1)); }
auth=(-H "authorization: Bearer $TOKEN" -H "x-arrab-account-session: $TOKEN")
json() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

echo "Smoke test: $BASE"
[ -n "$TOKEN" ] || { echo "Set SESSION_TOKEN (sign in once in the app, or POST /v1/account/sign-in)."; exit 2; }

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health" "${auth[@]}")
[ "$code" = "200" ] && ok "health 200" || bad "health" "got $code"

mx=$(curl -s -D - -o /dev/null -X OPTIONS "$BASE/v1/agents" -H "origin: http://localhost:1420" -H "access-control-request-method: GET" | tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-max-age"{print $2}')
[ "$mx" = "600" ] && ok "CORS preflight cached (max-age 600)" || bad "CORS max-age" "got '${mx:-none}'"

# Make sure there are enough events for the cursor check (each create logs one).
extra=()
for i in 1 2 3; do
  id=$(curl -s -X POST "$BASE/v1/agents" "${auth[@]}" -H 'content-type: application/json' -d "{\"name\":\"Smoke $i\",\"role\":\"Smoke test\",\"status\":\"draft\"}" | json 'd["id"]')
  extra+=("$id")
done

page=$(curl -s "$BASE/v1/activity?limit=2" "${auth[@]}")
n=$(echo "$page" | json 'len(d["items"])'); cur=$(echo "$page" | json 'd.get("nextCursor")')
[ -n "$n" ] && [ "$n" -le 2 ] && ok "activity limit respected ($n items)" || bad "activity limit" "$page"
echo "$page" | json '"nextCursor" in d' | grep -q True && ok "activity returns nextCursor field" || bad "activity nextCursor" "missing"
if [ -n "$cur" ] && [ "$cur" != "None" ]; then
  next=$(curl -s "$BASE/v1/activity?limit=2&before=$cur" "${auth[@]}")
  overlap=$(python3 - "$page" "$next" <<'PY'
import sys,json
a={i["id"] for i in json.loads(sys.argv[1])["items"]}; b={i["id"] for i in json.loads(sys.argv[2])["items"]}
print(len(a&b))
PY
)
  [ "$overlap" = "0" ] && ok "activity cursor pages do not overlap" || bad "activity cursor" "overlap=$overlap"
else
  bad "activity cursor" "no nextCursor after creating 3 agents"
fi

key="smoke:$(date +%s)"
mk() { curl -s -X POST "$BASE/v1/agents" "${auth[@]}" -H 'content-type: application/json' -d "{\"name\":\"Smoke\",\"role\":\"Smoke test\",\"status\":\"draft\",\"clientKey\":\"$key\"}"; }
a=$(mk | json 'd["id"]'); b=$(mk | json 'd["id"]')
[ -n "$a" ] && [ "$a" = "$b" ] && ok "same clientKey returns same agent" || bad "clientKey idempotency" "a=$a b=$b"

before=$(curl -s "$BASE/v1/activity?limit=200" "${auth[@]}" | json 'len([i for i in d["items"] if "Updated AI employee" in i["summary"]])')
curl -s -o /dev/null -X PATCH "$BASE/v1/agents/$a" "${auth[@]}" -H 'content-type: application/json' -d '{"role":"Smoke test"}'
after=$(curl -s "$BASE/v1/activity?limit=200" "${auth[@]}" | json 'len([i for i in d["items"] if "Updated AI employee" in i["summary"]])')
[ "$before" = "$after" ] && ok "no-op update logs nothing" || bad "no-op update" "before=$before after=$after"

[ -n "$a" ] && curl -s -o /dev/null -X PATCH "$BASE/v1/agents/$a" "${auth[@]}" -H 'content-type: application/json' -d '{"status":"archived"}'
for id in "${extra[@]}"; do [ -n "$id" ] && curl -s -o /dev/null -X PATCH "$BASE/v1/agents/$id" "${auth[@]}" -H 'content-type: application/json' -d '{"status":"archived"}'; done
echo; echo "passed=$pass failed=$fail"; [ "$fail" = "0" ]
