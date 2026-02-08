#!/bin/bash
# Test the full coordination flow locally
# Requires all agents to be running (use start-all.sh first)

set -e

COORDINATOR="http://localhost:3000"
WORKER1="http://localhost:3001"
WORKER2="http://localhost:3002"
WORKER3="http://localhost:3003"

echo "=== NEAR Shade Agent Coordination - Flow Test ==="
echo ""

# Step 1: Health checks
echo "--- Step 1: Health Checks ---"
echo ""

echo -n "Coordinator: "
curl -s "$COORDINATOR/" | python3 -m json.tool 2>/dev/null || echo "OFFLINE"
echo ""

echo -n "Worker 1: "
curl -s "$WORKER1/api/task/health" | python3 -m json.tool 2>/dev/null || echo "OFFLINE"
echo ""

echo -n "Worker 2: "
curl -s "$WORKER2/api/task/health" | python3 -m json.tool 2>/dev/null || echo "OFFLINE"
echo ""

echo -n "Worker 3: "
curl -s "$WORKER3/api/task/health" | python3 -m json.tool 2>/dev/null || echo "OFFLINE"
echo ""

# Step 2: Check initial worker statuses
echo "--- Step 2: Worker Statuses (via Coordinator) ---"
echo ""
curl -s "$COORDINATOR/api/coordinate/workers" | python3 -m json.tool
echo ""

# Step 3: Reset memory
echo "--- Step 3: Reset Memory ---"
echo ""
curl -s -X POST "$COORDINATOR/api/coordinate/reset" | python3 -m json.tool
echo ""
sleep 1

# Step 4: Trigger individual workers
echo "--- Step 4: Trigger Individual Workers ---"
echo ""

echo "Triggering Worker 1 (random)..."
curl -s -X POST "$WORKER1/api/task/execute" \
  -H "Content-Type: application/json" \
  -d '{"taskConfig": {"type": "random", "timeout": 2000}}' | python3 -m json.tool
echo ""

echo "Triggering Worker 2 (count, value=42)..."
curl -s -X POST "$WORKER2/api/task/execute" \
  -H "Content-Type: application/json" \
  -d '{"taskConfig": {"type": "count", "parameters": {"count": 42}, "timeout": 2000}}' | python3 -m json.tool
echo ""

echo "Triggering Worker 3 (multiply, 6*7)..."
curl -s -X POST "$WORKER3/api/task/execute" \
  -H "Content-Type: application/json" \
  -d '{"taskConfig": {"type": "multiply", "parameters": {"a": 6, "b": 7}, "timeout": 2000}}' | python3 -m json.tool
echo ""

# Step 5: Monitor workers until completion
echo "--- Step 5: Monitoring Workers ---"
echo ""

for i in $(seq 1 15); do
  STATUSES=$(curl -s "$COORDINATOR/api/coordinate/workers")
  W1=$(echo "$STATUSES" | python3 -c "import sys,json; print(json.load(sys.stdin)['workers']['worker1'])" 2>/dev/null)
  W2=$(echo "$STATUSES" | python3 -c "import sys,json; print(json.load(sys.stdin)['workers']['worker2'])" 2>/dev/null)
  W3=$(echo "$STATUSES" | python3 -c "import sys,json; print(json.load(sys.stdin)['workers']['worker3'])" 2>/dev/null)
  echo "  [$i] worker1=$W1  worker2=$W2  worker3=$W3"

  if [ "$W1" = "completed" ] && [ "$W2" = "completed" ] && [ "$W3" = "completed" ]; then
    echo ""
    echo "All workers completed!"
    break
  fi
  sleep 1
done

echo ""

# Step 6: Check coordinator status
echo "--- Step 6: Coordinator Status ---"
echo ""
curl -s "$COORDINATOR/api/coordinate/status" | python3 -m json.tool
echo ""

# Step 7: Run full coordination flow
echo "--- Step 7: Full Coordination Flow ---"
echo ""
echo "Triggering coordination via coordinator..."
curl -s -X POST "$COORDINATOR/api/coordinate/trigger" \
  -H "Content-Type: application/json" \
  -d '{"taskConfig": {"type": "random", "timeout": 2000}}' | python3 -m json.tool
echo ""

echo "Waiting for coordination to complete..."
for i in $(seq 1 20); do
  STATUS=$(curl -s "$COORDINATOR/api/coordinate/status")
  COORD_STATUS=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null)
  echo "  [$i] coordinator=$COORD_STATUS"

  if [ "$COORD_STATUS" = "completed" ]; then
    echo ""
    echo "Coordination completed!"
    echo ""
    echo "Final result:"
    echo "$STATUS" | python3 -m json.tool
    break
  fi

  if [ "$COORD_STATUS" = "failed" ]; then
    echo ""
    echo "Coordination FAILED!"
    echo "$STATUS" | python3 -m json.tool
    break
  fi

  sleep 2
done

echo ""
echo "=== Test complete ==="
