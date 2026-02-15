#!/bin/bash
# Run all Shade Coordination services in dev mode
# Usage: ./run-dev.sh
# Stop:  Ctrl+C (kills all background processes)

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS=()

cleanup() {
  echo ""
  echo "Shutting down all services..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
  echo "All services stopped."
}

trap cleanup EXIT INT TERM

# Build shared package if dist is stale
echo "Building shared package..."
cd "$ROOT/shared" && npm run build 2>&1 | tail -1
cd "$ROOT"

# Start coordinator (port 3000)
echo "Starting coordinator on :3000..."
cd "$ROOT/coordinator-agent" && npm run dev &
PIDS+=($!)

# Start worker1 (port 3001)
echo "Starting worker1 on :3001..."
cd "$ROOT/worker-agent" && npm run dev:worker1 &
PIDS+=($!)

# Start worker2 (port 3002)
echo "Starting worker2 on :3002..."
cd "$ROOT/worker-agent" && npm run dev:worker2 &
PIDS+=($!)

# Start worker3 (port 3003)
echo "Starting worker3 on :3003..."
cd "$ROOT/worker-agent" && npm run dev:worker3 &
PIDS+=($!)

# Start frontend (port 3004)
echo "Starting frontend on :3004..."
cd "$ROOT/frontend" && npm run dev &
PIDS+=($!)

echo ""
echo "All services starting:"
echo "  Coordinator:  http://localhost:3000"
echo "  Worker 1:     http://localhost:3001"
echo "  Worker 2:     http://localhost:3002"
echo "  Worker 3:     http://localhost:3003"
echo "  Frontend:     http://localhost:3004"
echo ""
echo "Press Ctrl+C to stop all services."

wait
