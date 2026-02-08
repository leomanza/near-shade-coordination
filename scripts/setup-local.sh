#!/bin/bash
# Setup script for NEAR Shade Agent Coordination - Local Testing
# This installs all dependencies and creates .env files for local mode

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "=== NEAR Shade Agent Coordination - Local Setup ==="
echo "Project directory: $PROJECT_DIR"
echo ""

# Check for Ensue API key
ENSUE_KEY_FILE="/Users/manza/Code/ensue api key"
if [ -f "$ENSUE_KEY_FILE" ]; then
  ENSUE_API_KEY=$(grep -o 'lmn_[a-f0-9]*' "$ENSUE_KEY_FILE" | head -1)
  echo "Found Ensue API key: ${ENSUE_API_KEY:0:10}..."
else
  echo "WARNING: Ensue API key file not found at: $ENSUE_KEY_FILE"
  echo "You'll need to set ENSUE_API_KEY manually in .env.development.local files"
  ENSUE_API_KEY="your-ensue-api-key"
fi

echo ""
echo "--- Installing shared library dependencies ---"
cd "$PROJECT_DIR/shared"
npm install

echo ""
echo "--- Installing worker-agent-1 dependencies ---"
cd "$PROJECT_DIR/worker-agent-1"
npm install

echo ""
echo "--- Installing worker-agent-2 dependencies ---"
cd "$PROJECT_DIR/worker-agent-2"
npm install

echo ""
echo "--- Installing worker-agent-3 dependencies ---"
cd "$PROJECT_DIR/worker-agent-3"
npm install

echo ""
echo "--- Installing coordinator-agent dependencies ---"
cd "$PROJECT_DIR/coordinator-agent"
npm install

echo ""
echo "--- Installing frontend dependencies ---"
cd "$PROJECT_DIR/frontend"
npm install

echo ""
echo "--- Creating .env.development.local files for local mode ---"

# Worker 1
cat > "$PROJECT_DIR/worker-agent-1/.env.development.local" << EOF
WORKER_ID=worker1
PORT=3001
ENSUE_API_KEY=$ENSUE_API_KEY
ENSUE_TOKEN=$ENSUE_API_KEY
EOF
echo "Created worker-agent-1/.env.development.local"

# Worker 2
cat > "$PROJECT_DIR/worker-agent-2/.env.development.local" << EOF
WORKER_ID=worker2
PORT=3002
ENSUE_API_KEY=$ENSUE_API_KEY
ENSUE_TOKEN=$ENSUE_API_KEY
EOF
echo "Created worker-agent-2/.env.development.local"

# Worker 3
cat > "$PROJECT_DIR/worker-agent-3/.env.development.local" << EOF
WORKER_ID=worker3
PORT=3003
ENSUE_API_KEY=$ENSUE_API_KEY
ENSUE_TOKEN=$ENSUE_API_KEY
EOF
echo "Created worker-agent-3/.env.development.local"

# Coordinator (local mode - no NEAR/TEE required)
cat > "$PROJECT_DIR/coordinator-agent/.env.development.local" << EOF
PORT=3000
LOCAL_MODE=true
POLL_INTERVAL=5000
ENSUE_API_KEY=$ENSUE_API_KEY
ENSUE_TOKEN=$ENSUE_API_KEY
EOF
echo "Created coordinator-agent/.env.development.local"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "To start all agents, run:"
echo "  bash $PROJECT_DIR/scripts/start-all.sh"
echo ""
echo "To test the flow, run:"
echo "  bash $PROJECT_DIR/scripts/test-flow.sh"
