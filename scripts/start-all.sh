#!/bin/bash
# Start all agents and frontend for local testing
# Each agent runs in the background with prefixed output

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIDS=()

cleanup() {
  echo ""
  echo "Stopping all agents..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "All agents stopped."
  exit 0
}

trap cleanup SIGINT SIGTERM

echo "=== Starting NEAR Shade Agent Coordination (Local Mode) ==="
echo ""

# Start Worker Agent 1
echo "Starting Worker Agent 1 on :3001..."
cd "$PROJECT_DIR/worker-agent-1"
npm run dev 2>&1 | sed "s/^/[worker1] /" &
PIDS+=($!)

# Start Worker Agent 2
echo "Starting Worker Agent 2 on :3002..."
cd "$PROJECT_DIR/worker-agent-2"
npm run dev 2>&1 | sed "s/^/[worker2] /" &
PIDS+=($!)

# Start Worker Agent 3
echo "Starting Worker Agent 3 on :3003..."
cd "$PROJECT_DIR/worker-agent-3"
npm run dev 2>&1 | sed "s/^/[worker3] /" &
PIDS+=($!)

# Give workers a moment to start
sleep 3

# Start Coordinator Agent (local mode)
echo "Starting Coordinator Agent on :3000 (LOCAL MODE)..."
cd "$PROJECT_DIR/coordinator-agent"
npm run dev 2>&1 | sed "s/^/[coordinator] /" &
PIDS+=($!)

# Start Frontend
echo "Starting Frontend on :3004..."
cd "$PROJECT_DIR/frontend"
npm run dev 2>&1 | sed "s/^/[frontend] /" &
PIDS+=($!)

echo ""
echo "=== All services starting ==="
echo ""
echo "  Coordinator:  http://localhost:3000"
echo "  Worker 1:     http://localhost:3001"
echo "  Worker 2:     http://localhost:3002"
echo "  Worker 3:     http://localhost:3003"
echo "  Dashboard:    http://localhost:3004"
echo ""
echo "Press Ctrl+C to stop all services"
echo ""

# Wait for all background processes
wait
