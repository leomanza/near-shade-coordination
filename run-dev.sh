#!/bin/bash
# Run all Shade Coordination services in dev mode
# Usage: WORKER_COUNT=2 ./run-dev.sh   (default: 3)
# Stop:  Ctrl+C (kills all background processes)

set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS=()
WORKER_COUNT="${WORKER_COUNT:-3}"

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

# Start N workers (configurable via WORKER_COUNT env var)
for i in $(seq 1 "$WORKER_COUNT"); do
  PORT=$((3000 + i))
  echo "Starting worker${i} on :${PORT}..."
  # Use dev:worker{N} script so the worker-specific env is loaded correctly.
  # (The generic `dev` script hardcodes .env.development.local and would override DOTENV_CONFIG_PATH)
  cd "$ROOT/worker-agent" && npm run "dev:worker${i}" &
  PIDS+=($!)
done

# Start protocol API (port 3005)
echo "Starting protocol-api on :3005..."
cd "$ROOT/protocol-api" && npm run dev &
PIDS+=($!)

# Start frontend (port 3004)
echo "Starting frontend on :3004..."
cd "$ROOT/frontend" && npm run dev &
PIDS+=($!)

echo ""
echo "All services starting (WORKER_COUNT=${WORKER_COUNT}):"
echo "  Coordinator:  http://localhost:3000"
for i in $(seq 1 "$WORKER_COUNT"); do
  PORT=$((3000 + i))
  echo "  Worker ${i}:     http://localhost:${PORT}"
done
echo "  Protocol API: http://localhost:3005"
echo "  Frontend:     http://localhost:3004"
echo ""
echo "Press Ctrl+C to stop all services."

wait
