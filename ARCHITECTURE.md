# NEAR Shade Agent Coordination - Architecture Guide

## The Simple Version (ELI5)

Imagine three students (Worker Agents) working independently on parts of a group project. They can't talk to each other directly. Instead, they each write their answers on a shared whiteboard (Ensue Memory Network) that only they and their teacher (Coordinator Agent) can see.

The teacher reads all three answers from the whiteboard, combines them into a final grade, and records **only the final grade** in the official school gradebook (NEAR Smart Contract). The individual student answers never appear in the gradebook -- they stay private on the whiteboard.

Anyone can look at the gradebook to see the final grade, but nobody can figure out what each student contributed individually.

That's the entire system.

---

## How It Works (5-Minute Version)

```
                         NEAR Blockchain (public)
                    +-----------------------------+
                    |   Coordinator Contract      |
                    |   - Stores final aggregate  |
                    |   - Yield/Resume pattern    |
                    |   - Hash verification       |
                    +-------------|---------------+
                                  |
                         resume(aggregate_only)
                                  |
                    +-------------|---------------+
                    |   Coordinator Agent (:3000) |
                    |   - Triggers workers        |
                    |   - Monitors completion     |
                    |   - Aggregates results      |
                    |   - Writes ONLY aggregate   |
                    |     to blockchain           |
                    +-----|--------|-----------|--+
                     read |  read  |     read  |
                    +-----|--------|-----------|--+
                    |                             |
                    |   Ensue Shared Memory       |
                    |   (off-chain, permissioned) |
                    |                             |
                    +-----|--------|-----------|--+
                    write |  write |     write |
                    +-----+  +----+--+  +-----+-----+
                    |Worker1| |Worker2|  |Worker3    |
                    |(:3001)| |(:3002)|  |(:3003)    |
                    +-------+ +-------+  +-----------+
```

**The flow:**

1. A user (or dApp) calls `start_coordination("task_config")` on the NEAR contract
2. The contract creates a **yielded promise** (pauses execution, waiting for a result)
3. The Coordinator Agent detects the pending coordination by polling the contract
4. The Coordinator writes the task config to Ensue and triggers all 3 Worker Agents
5. Each Worker independently computes a result and writes it to their private Ensue key
6. The Coordinator monitors Ensue until all workers are done
7. The Coordinator reads all results, computes the aggregate (e.g., sum)
8. **Privacy step**: The Coordinator sends ONLY `{aggregatedValue, workerCount, timestamp}` to the contract -- individual worker values never touch the blockchain
9. The contract resumes its yielded promise with the aggregate result
10. The result is stored on-chain as a finalized coordination

---

## Component Deep Dive

### 1. Ensue Shared Memory (Coordination Layer)

**What it is:** A permissioned, off-chain key-value store with a JSON-RPC 2.0 API over Server-Sent Events (SSE). Think of it as a private shared database that agents use to coordinate.

**Why we use it:** Agents running in Trusted Execution Environments (TEEs) can't directly communicate with each other. Ensue provides a shared memory space where they can read/write data asynchronously.

**Data model:**
```
coordination/
  tasks/
    worker1/
      status    = "idle" | "pending" | "processing" | "completed" | "failed"
      result    = { workerId, taskType, output: { value, data }, processingTime }
      timestamp = 1770497735701
      error     = null | "error message"
    worker2/...
    worker3/...
  coordinator/
    status      = "idle" | "monitoring" | "aggregating" | "completed"
    tally       = { aggregatedValue, workerCount, workers: [...], timestamp }
    proposal_id = 1
  config/
    task_definition = { type: "random", timeout: 2000 }
```

**Access control:** Ensue uses a permissioned model with five scopes: `read`, `write`, `update`, `delete`, and `share`. Permissions use regex key patterns for granular namespace control.

**Current MVP setup:** All agents share one API key for simplicity. In production, each agent would have its own key with scoped permissions:
- Workers: `write` access to `coordination/tasks/{their_id}/*` only
- Coordinator: `read` access to all worker keys, `write` access to `coordination/coordinator/*`
- Frontend: `read` access to all keys (display only)

**What stays in Ensue (private):** Individual worker values, processing details, error logs, intermediate states.

**What goes on-chain (public):** Only the aggregated value and metadata.

### 2. NEAR Smart Contract (Settlement Layer)

**What it is:** A Rust smart contract on NEAR using the **yield/resume** pattern -- a unique NEAR feature that allows a contract to pause execution, wait for an off-chain agent to provide data, and then resume.

**Contract file:** `coordinator-contract/src/lib.rs` (compiled to WASM)

**Key functions:**

| Function | Who calls it | What it does |
|----------|-------------|-------------|
| `start_coordination(task_config)` | Any user/dApp | Creates a yielded promise, stores pending coordination with yield_id |
| `coordinator_resume(proposal_id, result, config_hash, result_hash)` | Coordinator agent (TEE-verified) | Validates hashes, resumes the yield with the aggregate result |
| `return_coordination_result(...)` | Contract itself (callback) | Stores finalized result, cleans up pending state |
| `get_pending_coordinations()` | Coordinator agent | View function: returns pending coordinations for polling |
| `get_finalized_coordination(id)` | Anyone | View function: returns the on-chain aggregate result |

**Yield/Resume flow:**
```
User calls start_coordination("compute average temperature")
  |
  v
Contract creates yielded promise
  --> yield_id stored with pending coordination
  --> Promise is "paused", waiting for data
  |
  (time passes... agents do work off-chain)
  |
Coordinator calls coordinator_resume(id, aggregate, config_hash, result_hash)
  |
  v
Contract validates:
  - Caller is a registered coordinator (TEE-verified in production)
  - config_hash matches original (prevents task tampering)
  - result_hash matches computed hash (ensures data integrity)
  |
  v
Contract calls env::promise_yield_resume(yield_id, data)
  --> Original promise resumes
  --> Callback stores finalized result
  --> Individual worker values NEVER appear on-chain
```

**What's stored on-chain:**
```json
{
  "aggregatedValue": 212,
  "workerCount": 3,
  "timestamp": "2026-02-07T20:57:12.844Z",
  "proposalId": 1
}
```

**What's NOT on-chain:** Which workers participated, what individual values they computed, processing times, error details. All of that stays in Ensue.

### 3. Coordinator Agent (Orchestration)

**What it is:** A Node.js/TypeScript HTTP server running in a TEE (Trusted Execution Environment) using the Shade Agent SDK. It orchestrates the entire coordination lifecycle.

**Port:** 3000

**Responsibilities:**
1. Poll the NEAR contract for pending coordinations
2. Trigger workers (write task config to Ensue + call worker APIs)
3. Monitor Ensue for worker completion (poll every second)
4. Read worker results from Ensue and compute aggregate
5. Resume the NEAR contract with ONLY the aggregate result
6. Handle timeouts and failures

**TEE verification (production):** The coordinator runs inside a Phala Network TEE. When it registers with the NEAR contract, the contract verifies its DCAP attestation quote to ensure:
- The agent code hasn't been tampered with
- The approved Docker image codehash matches
- Only verified coordinator code can resume coordinations

**Local development mode:** Set `LOCAL_MODE=true` to skip TEE registration and contract interactions. The coordinator runs the full Ensue-based workflow without needing a deployed contract.

### 4. Worker Agents (Computation)

**What they are:** Three independent Node.js/TypeScript HTTP servers, each running in its own TEE. They perform the actual computation work.

**Ports:** 3001, 3002, 3003

**Task execution flow:**
```
1. Receive task config (via HTTP or Ensue polling)
2. Update Ensue status: "processing"
3. Execute computation (configurable task types)
4. Write result to Ensue: { workerId, value, processingTime }
5. Update Ensue status: "completed"
```

**Task types (MVP):**
- `random`: Generate a random number 0-99
- `count`: Return a configured count value
- `multiply`: Multiply two parameters

**Privacy guarantee:** Workers write results ONLY to Ensue (off-chain, permissioned memory). Their individual values are never submitted to the blockchain. Only the Coordinator Agent reads them, and only the aggregate reaches the chain.

### 5. Frontend Dashboard

**What it is:** A Next.js web application for monitoring and controlling the coordination system in real-time.

**Port:** 3004

**Features:**
- Live status display for all agents (polls every 2 seconds)
- Trigger coordination flows
- Trigger individual worker tasks
- View aggregated tally results
- Reset Ensue memory for testing
- Event log with color-coded status changes

---

## Privacy Model: Why Individual Worker Values Stay Secret

### The Problem

In many multi-agent systems, all agent outputs are visible on-chain. This is problematic when:
- Individual votes should remain secret (like in a DAO)
- Worker computations contain sensitive data
- You want to prevent gaming (if you can see others' values, you can adjust yours)

### Our Solution: Off-Chain Compute, On-Chain Settlement

```
PRIVATE (Ensue only)              PUBLIC (NEAR blockchain)
========================          ==========================
Worker 1 value: 82                Aggregated value: 212
Worker 2 value: 44                Worker count: 3
Worker 3 value: 86                Timestamp
Processing times                  Proposal ID
Error details                     Config hash (integrity)
Intermediate statuses             Result hash (integrity)
```

**How privacy is maintained:**

1. **Worker isolation:** Each worker writes ONLY to its own Ensue namespace (`coordination/tasks/workerN/`). Workers cannot read each other's results.

2. **Coordinator aggregation:** The Coordinator reads all worker values in Ensue, computes the aggregate, and discards individual values before writing to the contract.

3. **On-chain data:** The contract stores `{aggregatedValue, workerCount, timestamp, proposalId}`. There is no way to reverse-engineer individual worker contributions from this.

4. **Hash integrity:** The `config_hash` proves the task wasn't tampered with. The `result_hash` proves the aggregate wasn't altered. Both are verified on-chain without revealing underlying data.

5. **TEE enforcement (production):** The Coordinator runs in a TEE with verified code. The contract checks the DCAP attestation before accepting results, ensuring only approved code performs the aggregation.

### Ensue Permission Model (Production)

In production, Ensue permissions would be configured as:

| Agent | Ensue Access | Scope |
|-------|-------------|-------|
| Worker 1 | `write` | `coordination/tasks/worker1/*` |
| Worker 2 | `write` | `coordination/tasks/worker2/*` |
| Worker 3 | `write` | `coordination/tasks/worker3/*` |
| Coordinator | `read` | `coordination/tasks/*` (all workers) |
| Coordinator | `write` | `coordination/coordinator/*` |
| Frontend | `read` | `coordination/*` (display only) |

Workers can only write to their own namespace. The Coordinator can read all worker data but workers cannot read each other. The frontend can only read (for dashboard display).

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Smart Contract | Rust + near-sdk 5.7.0 | On-chain settlement with yield/resume |
| Agents | TypeScript + Hono | HTTP servers for coordination/work |
| Shared Memory | Ensue Memory Network | Off-chain agent coordination |
| TEE Runtime | Phala Network / Shade Agent SDK | Trusted execution environment |
| Frontend | Next.js + React | Real-time monitoring dashboard |
| Build Tool | cargo-near | WASM compilation for NEAR |

## Local Development

```bash
# Start all agents (local mode, no TEE/contract needed)
./scripts/start-all.sh

# Test the full flow
./scripts/test-flow.sh

# Or manually:
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":{"type":"random","timeout":2000}}'

# Check results
curl http://localhost:3000/api/coordinate/status
curl http://localhost:3000/api/coordinate/workers
```

## File Structure

```
near-shade-coordination/
  coordinator-contract/     # NEAR smart contract (Rust)
    src/lib.rs              # Yield/resume pattern, hash verification
    target/near/*.wasm      # Compiled WASM binary
  coordinator-agent/        # Orchestrator agent (TypeScript)
    src/index.ts            # Entry point, local/production mode
    src/monitor/            # Ensue polling + aggregation logic
    src/routes/             # HTTP API endpoints
    src/contract/           # Contract resume handler
  worker-agent-{1,2,3}/    # Worker agents (TypeScript)
    src/index.ts            # Entry point
    src/workers/            # Task execution + Ensue status updates
    src/routes/             # HTTP API endpoints
  shared/                   # Shared libraries
    src/ensue-client.ts     # Ensue API client (JSON-RPC over SSE)
    src/constants.ts        # Memory key paths
    src/types.ts            # TypeScript interfaces
  frontend/                 # Next.js dashboard
    src/app/page.tsx        # Main dashboard
    src/app/components/     # UI components
    src/lib/api.ts          # Backend API client
  scripts/                  # Development scripts
    start-all.sh            # Start all services
    test-flow.sh            # End-to-end test
```
