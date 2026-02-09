# NEAR Shade Agent Coordination MVP

Multi-agent coordination system using NEAR Shade Agents, Ensue shared memory, and on-chain yield/resume pattern.

## 🎯 Architecture

```
User → Contract (yield) → Coordinator Agent → Ensue Memory ← Worker Agents
                                ↓
                    Coordinator aggregates results
                                ↓
                    Contract resume → User gets result
```

## 📦 Project Structure

```
near-shade-coordination/
├── shared/                    ✅ COMPLETED
│   └── src/
│       ├── ensue-client.ts   # Ensue API wrapper
│       ├── constants.ts      # Memory key paths
│       └── types.ts          # Shared TypeScript types
│
├── coordinator-contract/      ✅ COMPLETED
│   └── src/
│       └── lib.rs            # Yield/resume smart contract
│
├── worker-agent-1/            ✅ COMPLETED
│   ├── src/
│   │   ├── index.ts          # Hono server
│   │   ├── routes/task.ts    # Task API endpoints
│   │   └── workers/
│   │       └── task-handler.ts # Ensue integration
│   ├── Dockerfile            # Multi-stage build
│   └── docker-compose.yaml   # With shade-agent-api
│
├── worker-agent-2/            🔄 TODO
├── worker-agent-3/            🔄 TODO
├── coordinator-agent/         🔄 TODO
├── frontend/                  🔄 TODO
└── scripts/                   🔄 TODO
```

## ✅ Completed Components

### 1. Shared Library (`/shared`)

Provides common utilities for all agents:

- **EnsueClient**: Full API wrapper for Ensue memory network
  - `createMemory()`, `readMemory()`, `updateMemory()`
  - `readMultiple()`, `listKeys()`, `searchMemories()`
  - Error handling and retries

- **Constants**: Memory key structure
  - Worker keys: `coordination/tasks/worker{N}/{status,result,timestamp,error}`
  - Coordinator keys: `coordination/coordinator/{tally,status,proposal_id}`
  - Helper functions: `getWorkerKeys()`, `getAllWorkerStatusKeys()`

- **Types**: TypeScript interfaces
  - `WorkerResult`, `TallyResult`, `TaskConfig`
  - `CoordinationRequest`, `WorkerStatusInfo`

### 2. Coordinator Contract (`/coordinator-contract`)

NEAR smart contract implementing yield/resume pattern:

**Key Functions:**
- `start_coordination(task_config)` - User initiates, creates yield
- `coordinator_resume(proposal_id, result, hashes)` - Agent resumes
- `get_pending_coordinations()` - Agent polling
- `register_coordinator()` - TEE registration
- `approve_codehash()` - Owner management

**Security Features:**
- SHA256 hash validation for config and results
- TEE attestation verification (dcap-qvl)
- Only registered coordinator can resume

**Based on:** [verifiable-ai-dao](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/dao.rs)

### 3. Worker Agent 1 (`/worker-agent-1`)

First worker agent with Ensue integration:

**Features:**
- Hono HTTP server on port 3001
- Task execution with status tracking
- Ensue memory writes for coordination
- Docker-ready with shade-agent-api

**API Endpoints:**
- `POST /api/task/execute` - Start task
- `GET /api/task/status` - Get status from Ensue
- `GET /api/task/health` - Health check

**Task Flow:**
1. Update status to "processing"
2. Perform work (simulated for MVP)
3. Write result to Ensue
4. Update timestamp
5. Update status to "completed"

## 🚀 Quick Start

### Prerequisites

```bash
# Install dependencies
npm install -g near-cli-rs shade-agent-cli

# Verify credentials
cat ~/.near-credentials/accounts.json

# Get Ensue API key
export ENSUE_API_KEY=$(cat "/Users/manza/Code/ensue api key" | grep lmn_ | cut -d'=' -f2)
```

### 1. Build Shared Library

```bash
cd shared
npm install
npm run build
```

### 2. Deploy Contract

```bash
cd coordinator-contract
cargo near build
shade-agent-cli --wasm target/near/coordinator_contract.wasm --funding 7
```

### 3. Start Worker Agent 1 Locally

```bash
cd worker-agent-1
npm install

# Create .env.development.local from example
cp .env.development.local.example .env.development.local

# Edit with your values
WORKER_ID=worker1
PORT=3001
ENSUE_API_KEY=

# Start in development mode
npm run dev
```

### 4. Test Worker

```bash
# Health check
curl http://localhost:3001

# Check Ensue status
curl http://localhost:3001/api/task/status

# Execute task
curl -X POST http://localhost:3001/api/task/execute \
  -H "Content-Type: application/json" \
  -d '{"taskConfig": {"type": "random", "timeout": 2000}}'

# Check status again
curl http://localhost:3001/api/task/status
```

## 📋 Next Steps

### Phase 1: Complete Worker Agents
- [ ] Clone worker-agent-1 to worker-agent-2 (port 3002)
- [ ] Clone worker-agent-1 to worker-agent-3 (port 3003)
- [ ] Update environment configs
- [ ] Test all three workers

### Phase 2: Build Coordinator Agent
- [ ] Create coordinator agent with monitoring loop
- [ ] Implement contract polling (like verifiable-ai-dao)
- [ ] Add Ensue worker monitoring
- [ ] Implement aggregation logic
- [ ] Add contract resume handler

### Phase 3: Local Integration Testing
- [ ] Start all workers + coordinator locally
- [ ] Call contract's `start_coordination`
- [ ] Monitor Ensue memory updates
- [ ] Verify aggregation
- [ ] Verify contract resume

### Phase 4: Phala Deployment
- [ ] Build Docker images for all agents
- [ ] Push to Docker Hub
- [ ] Deploy to Phala Cloud
- [ ] Register coordinator on contract
- [ ] Approve codehashes

### Phase 5: Frontend Dashboard
- [ ] Create Next.js project
- [ ] Build agent status components
- [ ] Add wallet connection
- [ ] Real-time Ensue monitoring
- [ ] Contract interaction UI

## 🔑 Environment Variables

See [`.env.example`](.env.example) for full list. Key variables:

```bash
# NEAR
NEAR_ACCOUNT_ID=agents-coordinator.testnet
NEXT_PUBLIC_contractId=ac-proxy.agents-coordinator.testnet

# Ensue
ENSUE_API_KEY=

# Workers
WORKER_ID=worker1  # worker2, worker3
PORT=3001          # 3002, 3003

# Shade Agent
API_CODEHASH=a86e3a4300b069c08d629a38d61a3d780f7992eaf36aa505e4527e466553e2e5
APP_CODEHASH=generated-during-build
```

## 📖 Documentation

- [Coordinator Contract README](coordinator-contract/README.md)
- [Implementation Plan](/Users/manza/.claude/plans/partitioned-gathering-river.md)
- [Verifiable AI DAO Reference](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/)

## 🛠️ Technology Stack

- **Smart Contract**: Rust + NEAR SDK 5.7.0
- **Agents**: TypeScript + Node.js 22
- **HTTP Framework**: Hono 4.8
- **Memory Network**: Ensue API
- **TEE**: Phala Cloud (Intel TDX)
- **Docker**: Multi-stage builds, linux/amd64

## 📊 Progress Tracking

- ✅ Project structure created
- ✅ Shared library with Ensue client
- ✅ Coordinator smart contract
- ✅ Worker agent 1 complete
- 🔄 Worker agents 2 & 3 (in progress)
- ⏳ Coordinator agent
- ⏳ Docker configurations
- ⏳ Local testing
- ⏳ Phala deployment
- ⏳ Frontend dashboard

## 🔗 References

- [NEAR Shade Agents Docs](https://docs.near.org/ai/shade-agents/getting-started/introduction)
- [Ensue Documentation](https://ensue.dev/docs/)
- [AI DAO Tutorial](https://docs.near.org/ai/shade-agents/tutorials/ai-dao/overview)
- [Verifiable AI DAO Source](https://github.com/NearDeFi/verifiable-ai-dao)

---

**Status**: MVP Development In Progress 🚧
**Last Updated**: February 2026
