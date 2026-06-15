#!/bin/bash
# Dispatch a Delibera proposal to the full mixed-mode swarm:
#   - 3 push workers (Vox/Sentinel/Nexus on GCP) via HMAC webhook
#   - 1 pull worker (NearAI on hosted IronClaw) via Ensue task_definition write
#
# Per dispatch-modes spec (doc/plans/dispatch-modes/00-spec.md), polling workers
# are activated by the Ensue write below; they need a human/external trigger
# to "wake up and check Ensue" since the hosted runtime can't poll on its own.
#
# Usage: bash dispatch-mixed-mode.sh
#
# Pairs with demo-full-finalize.mjs (which collects votes + finalizes on-chain).
set -euo pipefail

cd "$(dirname "$0")"

# ─── Config ───────────────────────────────────────────────────────────────────
TASK_CONFIG='{"topic":"Should the DAO fund a 6-month grant of 75,000 NEAR to a community-led open-source library for cross-chain wallet abstraction?","options":["approve","reject","conditional-approve"]}'
ENSUE_ENDPOINT="https://api.ensue-network.ai/?organization=socialcap"
SHARED_SECRET="ac3050197bf0fa10a73c587ab156c33a2aaecb43497abd01e3d84fd532cf4b74"
PUSH_WORKER_IPS=(35.193.90.69 136.114.32.194 34.60.89.220)
HOSTED_INSTANCE_URL="https://agent.near.ai/?instance=cef009f6-c887-408a-be2f-deec71698a3c"

# Source ENSUE_API_KEY from either local .env or sandbox env
ENSUE_API_KEY="${ENSUE_API_KEY:-$(grep -m1 '^ENSUE_API_KEY=' .env.development.local 2>/dev/null | cut -d= -f2- | tr -d '"' || true)}"
if [ -z "${ENSUE_API_KEY:-}" ]; then
  ENSUE_API_KEY=$(grep -m1 '^ENSUE_API_KEY=' ../sandbox/.env.sandbox 2>/dev/null | cut -d= -f2- | tr -d '"' || true)
fi
if [ -z "${ENSUE_API_KEY:-}" ]; then
  echo "ERROR: ENSUE_API_KEY not found in .env.development.local or ../sandbox/.env.sandbox"; exit 1
fi

# ─── Step 1: Write task_definition to Ensue ────────────────────────────────────
# This is BOTH:
#   - the input the push workers will read AFTER they receive the webhook
#   - the activation signal for the polling worker (it polls this key)
echo "[1/3] Writing task_definition to Ensue..."
ENSUE_BODY=$(python3 <<EOF
import json
tc = json.dumps($TASK_CONFIG) if False else """$TASK_CONFIG"""
print(json.dumps({
  "jsonrpc":"2.0","id":1,"method":"tools/call",
  "params":{"name":"update_memory","arguments":{
    "key_name":"coordination/config/task_definition","value":tc
  }}
}))
EOF
)
curl -sS -X POST "$ENSUE_ENDPOINT" \
  -H "Authorization: Bearer $ENSUE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data-raw "$ENSUE_BODY" | grep -o '"status":"success"' | head -1 || echo "  (silent — check Ensue console)"
echo "  task_definition written"

# ─── Step 2: HMAC-dispatch the 3 push workers ─────────────────────────────────
echo ""
echo "[2/3] HMAC-dispatching push workers..."
TASKID="demo-mixed-$(date +%s)"
PROPID="prop-mixed-$(date +%s)"
DISPATCH_BODY=$(python3 <<EOF
import json
tc = json.loads("""$TASK_CONFIG""")
print(json.dumps({
  "user_id":"coordinator",
  "content":f"deliberate task_id:$TASKID proposal_id:$PROPID",
  "metadata":{"taskId":"$TASKID","proposalId":"$PROPID","taskConfig":tc}
}))
EOF
)
SIG=$(printf '%s' "$DISPATCH_BODY" | openssl dgst -sha256 -hmac "$SHARED_SECRET" -hex | awk '{print $NF}')
for ip in "${PUSH_WORKER_IPS[@]}"; do
  printf "  %-15s " "$ip"
  curl -sS -m 10 -X POST "http://$ip:8083/webhook" \
    -H "Content-Type: application/json" \
    -H "X-Hub-Signature-256: sha256=$SIG" \
    --data-raw "$DISPATCH_BODY" \
    -w "HTTP %{http_code}\n" -o /dev/null &
done; wait

# ─── Step 3: Print the chat prompt for the polling worker ─────────────────────
echo ""
echo "[3/3] PASTE THE FOLLOWING INTO THE HOSTED IRONCLAW CHAT:"
echo "      $HOSTED_INSTANCE_URL"
echo ""
echo "─────────────────────────────────────────────────────────────────────────────"
cat <<'PROMPT'
PREREQUISITE: store your Ensue API key in this agent's config first
  - via the agent.near.ai setup form, OR
  - via your `ironclaw config set ENSUE_API_KEY <value>` tool.
The prompt below references the stored key by name so the secret never goes
through the chat (IronClaw's safety scanner blocks any inlined credential).

────────────────────────────────────────────────────────────────────────────

A new Delibera task is live in Ensue at coordination/config/task_definition.
Per your skill (https://delibera.xyz/skill.md, Mode B), read it via your http tool.

Use the ENSUE_API_KEY stored in your config as the Bearer token. Look it up via
your credentials/secrets tool before constructing the request — do NOT echo the
key value back in chat.

Request shape:

  POST https://api.ensue-network.ai/?organization=socialcap
  Headers:
    Authorization: Bearer <ENSUE_API_KEY from config>
    Content-Type: application/json
    Accept: application/json, text/event-stream
  Body:
    {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_memory","arguments":{"key_names":["coordination/config/task_definition"]}}}

Parse the response — the value is a JSON string of {topic, options}. Reason
about it using your values and pick ONE option from the options list. Then
write your vote back:

  POST same endpoint, same auth, body:
    {"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"update_memory","arguments":{
      "key_name":"coordination/tasks/did:key:z6MkoxHfFzBZw5r7Rj8Z4bfdWEkBiL5KpSH5ThP333hwFrkn/result",
      "value":"<your vote as JSON string, shape {\"option\":\"...\",\"rationale\":\"...\"}>"
    }}}

Confirm when your vote is written (you should see status: success in the response).
PROMPT
echo "─────────────────────────────────────────────────────────────────────────────"
echo ""
echo "Now WAIT 3-5 min for all 4 votes to land in Ensue. To check vote progress:"
echo ""
echo "  bash $(dirname "$0")/poll-votes.sh"
echo ""
echo "When all 4 votes are in, fire the live finalize from this dir:"
echo "  node demo-full-finalize.mjs '$TASK_CONFIG'"
