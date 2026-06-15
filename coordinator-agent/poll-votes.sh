#!/bin/bash
# Watch Ensue for all 4 worker votes landing.
# Polls coordination/tasks/{worker_did}/result for each active worker every 10s.
# Exits when all 4 votes are present.

set -euo pipefail
cd "$(dirname "$0")"

ENSUE_API_KEY="${ENSUE_API_KEY:-$(grep -m1 '^ENSUE_API_KEY=' .env.development.local 2>/dev/null | cut -d= -f2- | tr -d '"' || true)}"
if [ -z "${ENSUE_API_KEY:-}" ]; then
  ENSUE_API_KEY=$(grep -m1 '^ENSUE_API_KEY=' ../sandbox/.env.sandbox 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
fi
[ -z "${ENSUE_API_KEY:-}" ] && { echo "ENSUE_API_KEY not found"; exit 1; }

WORKERS=(
  "Vox:did:key:z6MkuhzCbffEQiCEJaYY34HJB3R4VKrHreuKSojrrh7KVib2"
  "Sentinel:did:key:z6MkuWuPjn5c7AjR8wFYkwFsg8EqWSAvG1iSWiZqyPRYYgzL"
  "Nexus:did:key:z6MkhxJhjDV6asCdwFzVAGFbuMoHSn76ch7jNGb9uFJZcrgG"
  "NearAI:did:key:z6MkoxHfFzBZw5r7Rj8Z4bfdWEkBiL5KpSH5ThP333hwFrkn"
)

probe() {
  local did=$1
  local body
  body=$(printf '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_memory","arguments":{"key_names":["coordination/tasks/%s/result"]}}}' "$did")
  curl -sS -m 10 -X POST "https://api.ensue-network.ai/?organization=socialcap" \
    -H "Authorization: Bearer $ENSUE_API_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    --data-raw "$body" 2>/dev/null | grep -o '"value":"[^"]*"' | head -1
}

iter=0
while true; do
  iter=$((iter+1))
  votes_in=0
  echo ""
  echo "── poll #$iter ─────────────────────────────"
  for entry in "${WORKERS[@]}"; do
    name="${entry%%:*}"
    did="${entry#*:}"
    val=$(probe "$did")
    if [ -n "$val" ]; then
      # extract option for compactness
      opt=$(echo "$val" | python3 -c "import json,sys; v=sys.stdin.read().split('\"value\":\"',1)[1].rsplit('\"',1)[0].replace('\\\\\\\"','\"'); j=json.loads(v); print(j.get('option','?'))" 2>/dev/null || echo "?")
      printf "  %-10s ✓ %s\n" "$name" "$opt"
      votes_in=$((votes_in+1))
    else
      printf "  %-10s · waiting\n" "$name"
    fi
  done
  if [ "$votes_in" -eq 4 ]; then
    echo ""
    echo "🎯 All 4 votes in. Ready to finalize:"
    echo "    node demo-full-finalize.mjs '<your-task-config-json>'"
    exit 0
  fi
  sleep 10
done
