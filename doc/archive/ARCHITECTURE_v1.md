# Architecture Guide

## The Simple Version (ELI5)

Three AI agents (Voter Agents) each independently read a DAO manifesto and a proposal, then vote Approved or Rejected with their reasoning. They write their votes to a private shared whiteboard (Ensue Memory Network) that only they and a teacher (Coordinator Agent) can see.

The teacher reads all three votes, counts the Approved vs Rejected, and records **only the final tally** in the official record book (NEAR Smart Contract). The individual votes and reasoning never appear in the record book — they stay private on the whiteboard.

Anyone can look at the record book to see "3 Approved, 0 Rejected — Decision: Approved", but nobody can see which agent voted which way or why.

## Technical Overview

The system implements a **privacy-preserving multi-agent voting protocol** with three layers:

- **Settlement layer (NEAR blockchain)** — A Rust smart contract using NEAR's [yield/resume](https://docs.near.org/ai/shade-agents/tutorials/ai-dao/overview) pattern. When a proposal is submitted, the contract creates a yielded promise that suspends execution until an off-chain coordinator provides the aggregated result. The contract enforces integrity via SHA256 hash verification of both the task configuration and the aggregated result, and prevents double-voting through a nullifier pattern (one submission hash per worker per proposal). Only TEE-registered coordinators with owner-approved codehashes can settle results.

- **Coordination layer (Ensue Memory Network)** — An off-chain, permissioned key-value store accessed via JSON-RPC 2.0 over SSE. Agents read and write to hierarchical namespaces (`coordination/tasks/workerN/*`). Ensue provides the asynchronous communication channel between TEE-isolated agents that cannot directly communicate. Individual votes, AI reasoning, and processing metadata live exclusively in this layer — they never reach the blockchain. Access is controlled by API key scoping and namespace-level permissions.

- **Computation layer (AI Voter Agents)** — Three independent TypeScript agents, each running in a Phala TEE (Intel TDX). Each agent fetches the DAO manifesto from the contract via NEAR RPC, then calls the NEAR AI API (DeepSeek-V3.1 with OpenAI-compatible function calling) to deliberate on the proposal. The AI returns a structured `{vote, reasoning}` response via a forced `dao_vote` tool call. Votes are written to each agent's private Ensue namespace. The coordinator reads all votes, computes an aggregate tally, records nullifier hashes on-chain, and resumes the contract with only `{approved, rejected, decision, workerCount}`.

**Key design properties:**
- **Ballot privacy** — Individual votes are never on-chain; only the aggregate tally is settled
- **Tamper resistance** — SHA256 hashes verify config and result integrity end-to-end
- **Double-vote prevention** — On-chain nullifier ensures each worker submits exactly once per proposal
- **Verifiable execution** — TEE attestation (DCAP) ensures only approved code can settle results
- **Asynchronous coordination** — Ensue decouples agents that can't directly communicate in TEE isolation

---

## System Overview

```
                      NEAR Blockchain (public)
                 ┌──────────────────────────────┐
                 │  Coordinator Contract         │
                 │  - Manifesto (DAO guidelines) │
                 │  - Proposal lifecycle         │
                 │  - Yield/resume pattern       │
                 │  - Hash verification          │
                 │  - Stores ONLY aggregate      │
                 └──────────────┬───────────────┘
                                │
                     resume(tally only)
                                │
                 ┌──────────────┴───────────────┐
                 │  Coordinator Agent (:3000)    │
                 │  - Polls contract for pending │
                 │  - Dispatches to voters       │
                 │  - Monitors Ensue completion  │
                 │  - Tallies votes              │
                 │  - Records nullifiers         │
                 │  - Resumes contract           │
                 └───┬──────────┬──────────┬────┘
                read │    read  │    read  │
                 ┌───┴──────────┴──────────┴────┐
                 │                               │
                 │   Ensue Shared Memory          │
                 │   (off-chain, permissioned)    │
                 │                               │
                 └───┬──────────┬──────────┬────┘
               write │    write │    write │
              ┌──────┴┐  ┌─────┴──┐  ┌────┴─────┐
              │Voter 1│  │Voter 2 │  │Voter 3   │
              │(:3001)│  │(:3002) │  │(:3003)   │
              │  AI   │  │  AI    │  │  AI      │
              └───────┘  └────────┘  └──────────┘
```

### The Flow

1. A user (or dApp) calls `start_coordination(task_config)` on the NEAR contract with a proposal
2. The contract requires a manifesto to be set, then creates a **yielded promise** (pauses execution)
3. The Coordinator Agent detects the pending proposal by polling the contract
4. The Coordinator writes the task config to Ensue and triggers all 3 Voter Agents
5. Each Voter independently:
   - Fetches the DAO manifesto from the contract via RPC
   - Calls NEAR AI (DeepSeek-V3.1) with the manifesto + proposal
   - Receives a structured vote: `{vote: "Approved"|"Rejected", reasoning: "..."}`
   - Writes its vote and reasoning to its private Ensue key
6. The Coordinator monitors Ensue until all voters are done
7. The Coordinator reads all votes, tallies Approved vs Rejected
8. **Nullifier step**: Worker submission hashes are recorded on-chain (prevents double-voting without revealing votes)
9. **Privacy step**: The Coordinator sends ONLY `{approved, rejected, decision, workerCount, timestamp}` to the contract
10. The contract validates hashes and resumes its yielded promise with the aggregate
11. The finalized result is stored on-chain

---

## Component Deep Dive

### 1. NEAR Smart Contract (Settlement Layer)

**File:** `coordinator-contract/src/lib.rs`
**Deployed at:** `ac-proxy.agents-coordinator.testnet`

The contract manages the full proposal lifecycle using NEAR's yield/resume pattern.

**State:**

```rust
pub struct CoordinatorContract {
    owner: AccountId,
    approved_codehashes: IterableSet<String>,
    coordinator_by_account_id: IterableMap<AccountId, Worker>,
    current_proposal_id: u64,
    proposals: IterableMap<u64, Proposal>,
    manifesto: Option<Manifesto>,
}
```

**Proposal lifecycle:**

```
Created ──────────────> WorkersCompleted ──────────────> Finalized
(yield created,         (worker hashes              (aggregate result
 waiting for agents)     recorded on-chain)           stored on-chain)
       │
       └──────────────────────────────────────────> TimedOut
                    (yield expired, ~200 blocks)
```

**Key functions:**

| Function | Who calls it | What it does |
|----------|-------------|-------------|
| `set_manifesto(text)` | Owner | Stores DAO guidelines that agents reference |
| `start_coordination(task_config)` | Any user/dApp | Creates yielded promise, stores pending proposal |
| `record_worker_submissions(id, submissions)` | Coordinator (TEE) | Records worker hashes on-chain (nullifier) |
| `coordinator_resume(id, result, hashes)` | Coordinator (TEE) | Validates hashes, resumes yield with aggregate |
| `return_coordination_result(...)` | Contract callback | Stores finalized result, updates state |
| `get_pending_coordinations()` | Coordinator | View: returns proposals in `Created` state |
| `get_proposal(id)` | Anyone | View: full proposal details |

**What's stored on-chain per proposal:**
```json
{
  "task_config": "{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Fund grants\"}}",
  "config_hash": "a3f2...",
  "state": "Finalized",
  "worker_submissions": [
    {"worker_id": "worker1", "result_hash": "b4c5...", "timestamp": 1770497735},
    {"worker_id": "worker2", "result_hash": "d6e7...", "timestamp": 1770497736},
    {"worker_id": "worker3", "result_hash": "f8a9...", "timestamp": 1770497737}
  ],
  "finalized_result": "{\"approved\":2,\"rejected\":1,\"decision\":\"Approved\",\"workerCount\":3}"
}
```

**What's NOT on-chain:** Which worker voted which way, AI reasoning, processing times, error details. All private data stays in Ensue.

**Security:**
- Config hash validation — proves the task wasn't tampered with between submission and resolution
- Result hash validation — proves the aggregate result wasn't altered
- TEE verification — only registered coordinators with approved codehashes can call `coordinator_resume` and `record_worker_submissions`
- Nullifier pattern — each worker can only submit once per proposal (prevents double-voting)

### 2. Ensue Shared Memory (Coordination Layer)

**What it is:** A permissioned, off-chain key-value memory network with a JSON-RPC 2.0 API over Server-Sent Events (SSE).

**Why we use it:** Agents running in TEEs can't directly communicate with each other. Ensue provides a shared memory space where they read/write data asynchronously, coordinated by hierarchical key namespaces.

**API protocol:**
- All operations are `POST https://api.ensue-network.ai/` with Bearer token auth
- Request body: JSON-RPC 2.0 with `method: "tools/call"` and tool name in `params.name`
- Response: SSE (`text/event-stream`) with `data: {jsonrpc payload}`
- Operations: `create_memory`, `get_memory`, `update_memory`, `delete_memory`, `list_keys`, `search_memories`

**Data layout:**

```
coordination/
  tasks/
    worker1/
      status       "idle" | "pending" | "processing" | "completed" | "failed"
      result       {
                     workerId: "worker1",
                     taskType: "vote",
                     output: {
                       value: 1,
                       vote: "Approved",
                       reasoning: "The proposal aligns with the manifesto because...",
                       computedAt: "2026-02-07T20:57:12.844Z"
                     },
                     processingTime: 3421
                   }
      timestamp    1770497735701
      error        null | "error message"
    worker2/...
    worker3/...
  coordinator/
    status         "idle" | "monitoring" | "recording_submissions" | "aggregating" | "resuming" | "completed"
    tally          {
                     aggregatedValue: 2,
                     approved: 2,
                     rejected: 1,
                     decision: "Approved",
                     workerCount: 3,
                     workers: [...full details...],
                     timestamp: "2026-02-07T20:57:15.000Z",
                     proposalId: 1
                   }
    proposal_id    1
  config/
    task_definition  {"type":"vote","parameters":{"proposal":"Fund grants..."}}
```

**Security model:**

Ensue uses a **permissioned access model** with identity-based controls:

- **Private by default** — memories are only accessible to the creating agent unless explicitly shared
- **Namespace permissions** — access governed by hierarchical key paths with regex patterns
- **Permission scopes** — `read`, `write`, `update`, `delete`, `share`
- **TLS in transit** — all communication over HTTPS
- **Bearer token auth** — API key identifies the agent

**On E2EE:** Ensue does not currently advertise end-to-end encryption as a feature. Data is protected by:
- TLS encryption in transit (HTTPS)
- Permissioned access controls at the API layer
- Private-by-default memory model

For this project, the privacy guarantee is layered:
1. **Ensue access controls** — agents can only access their own namespaces
2. **Architectural design** — the coordinator only writes aggregate tallies on-chain, never individual votes
3. **TEE enforcement** — in production, the coordinator runs in a verified TEE (Phala), so even the operator can't tamper with the aggregation logic
4. **Nullifier hashes** — on-chain submission hashes prove participation without revealing vote content

**Production permission scoping:**

| Agent | Access | Namespace |
|-------|--------|-----------|
| Voter 1 | write | `coordination/tasks/worker1/*` |
| Voter 2 | write | `coordination/tasks/worker2/*` |
| Voter 3 | write | `coordination/tasks/worker3/*` |
| Coordinator | read | `coordination/tasks/*` (all voters) |
| Coordinator | write | `coordination/coordinator/*` |
| Frontend | read | `coordination/*` (display only) |

Workers can only write to their own namespace. The Coordinator can read all worker data but workers cannot read each other. The frontend can only read.

### 3. Coordinator Agent (Orchestration)

**File:** `coordinator-agent/src/monitor/memory-monitor.ts`
**Port:** 3000

The coordinator is the orchestration brain. It bridges the NEAR contract and Ensue.

**Coordination lifecycle:**

```
Poll contract (every 5s)
  └─> Found pending proposal
        └─> Write task config to Ensue
        └─> Reset all worker statuses to "pending"
        └─> Trigger workers via HTTP (local mode)
        └─> Monitor Ensue for completion (poll every 1s, 30s timeout)
              └─> All workers completed
                    └─> Read worker results from Ensue
                    └─> Record worker submission hashes on-chain (nullifier)
                    └─> Tally votes: count Approved vs Rejected
                    └─> Write full tally to Ensue (private)
                    └─> Resume contract with ONLY aggregate result
                    └─> Update status to "completed"
```

**Two modes:**
- `LOCAL_MODE=true` — Skips TEE registration. Coordinator triggers workers via HTTP and calls contract via `near-api-js`. Used for development.
- Production — Coordinator registers via Shade Agent SDK with DCAP attestation. Contract verifies TEE before accepting results.

**Privacy enforcement:** The coordinator reads full worker results from Ensue (including individual votes and reasoning) but constructs an `onChainResult` that strips all individual data:

```typescript
const onChainResult = JSON.stringify({
  aggregatedValue: tally.aggregatedValue,
  approved: tally.approved,
  rejected: tally.rejected,
  decision: tally.decision,
  workerCount: tally.workerCount,
  timestamp: tally.timestamp,
  proposalId,
});
```

Individual votes, reasoning, and processing details are written to Ensue only.

### 4. Voter Agents (AI Deliberation)

**Files:** `worker-agent-{1,2,3}/src/workers/task-handler.ts` + `ai-voter.ts`
**Ports:** 3001, 3002, 3003

Each voter agent is an independent AI-powered decision maker.

**Vote task flow:**

```
Receive task config {type: "vote", parameters: {proposal: "..."}}
  └─> Update Ensue status: "processing"
  └─> Fetch DAO manifesto from contract (RPC view call)
  └─> Call NEAR AI API:
        Model: deepseek-ai/DeepSeek-V3.1
        System: "You are a DAO agent. Vote based on the manifesto..."
        User: "Manifesto: {text}\nProposal: {proposal}"
        Tool: dao_vote({vote, reasoning})
  └─> Parse structured response: {vote: "Approved", reasoning: "..."}
  └─> Write result to Ensue: {workerId, vote, reasoning, processingTime}
  └─> Update Ensue status: "completed"
```

**NEAR AI integration (`ai-voter.ts`):**
- Uses OpenAI-compatible API at `https://cloud-api.near.ai/v1`
- Model: `deepseek-ai/DeepSeek-V3.1` with function calling
- Forces structured output via `tool_choice: {type: "function", function: {name: "dao_vote"}}`
- Returns `{vote: "Approved"|"Rejected", reasoning: string}`

**Legacy task types** (kept for testing):
- `random` — Generate a random number 0-99
- `count` — Return a configured count value
- `multiply` — Multiply two parameters

### 5. Frontend Dashboard

**File:** `frontend/src/app/page.tsx`
**Port:** 3004

A Next.js application that provides real-time monitoring of the voting flow.

**Features:**
- Live status indicators for coordinator + all 3 voter agents (polls every 2s)
- Voting flow visualization with active step highlighting
- Contract state panel (reads proposals directly from NEAR RPC)
- Coordinator panel for triggering proposals
- Event log with color-coded status transitions
- Memory reset button for testing

---

## Privacy Model

### The Problem

In many multi-agent systems, all agent outputs are visible on-chain. This is problematic when:
- Individual votes should remain secret (ballot privacy)
- Worker computations contain sensitive reasoning
- Visible votes enable strategic voting (adjusting your vote after seeing others)

### Our Solution: Off-Chain Deliberation, On-Chain Settlement

```
PRIVATE (Ensue only)                PUBLIC (NEAR blockchain)
================================    ================================
Worker 1: Approved                  Approved: 2
  "Aligns with manifesto            Rejected: 1
   section 3 on education..."       Decision: Approved
Worker 2: Rejected                  Worker count: 3
  "Budget exceeds our               Config hash (integrity)
   fiscal guidelines..."            Result hash (integrity)
Worker 3: Approved                  Worker submission hashes (nullifier)
  "Community impact justifies
   the investment..."
Processing times
Error details
Intermediate statuses
```

### How Privacy Is Maintained

1. **Worker isolation** — Each voter writes ONLY to its own Ensue namespace (`coordination/tasks/workerN/`). Voters cannot read each other's results.

2. **Coordinator aggregation** — The Coordinator reads all voter results from Ensue, counts Approved vs Rejected, and constructs an aggregate. Individual votes and reasoning are discarded before writing to the contract.

3. **On-chain data** — The contract stores `{approved, rejected, decision, workerCount, timestamp, proposalId}`. There is no way to determine individual worker votes from this.

4. **Nullifier pattern** — Worker submission hashes are recorded on-chain to prevent double-voting. The hash proves a worker participated and committed to a specific result, without revealing what that result was.

5. **Hash integrity** — `config_hash` proves the task wasn't tampered with. `result_hash` proves the aggregate wasn't altered. Both are verified on-chain without revealing underlying data.

6. **TEE enforcement (production)** — The Coordinator runs in a Phala Network TEE with verified code. The contract checks the DCAP attestation before accepting results, ensuring only approved code performs the aggregation.

### Ensue Security Considerations

Ensue's current security model provides:
- **TLS encryption in transit** — All API communication is HTTPS
- **Private-by-default memories** — Data only accessible to the creating agent
- **Namespace access controls** — Permissions scoped to key path patterns
- **Bearer token authentication** — API keys identify agents

**E2EE is not currently a feature** of Ensue. This means:
- Ensue (the service operator) could theoretically access stored data
- Privacy relies on access controls + architectural design (not cryptographic guarantees)
- For stronger privacy guarantees, future work could encrypt vote data client-side before writing to Ensue

For the current use case, the practical privacy guarantee is strong:
- Even if Ensue data were exposed, the on-chain record only shows aggregates
- The TEE ensures the coordinator code faithfully aggregates without leaking individual votes
- The nullifier prevents any agent from voting twice

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Smart Contract | Rust + near-sdk 5.7.0 | On-chain settlement with yield/resume |
| AI Model | DeepSeek-V3.1 via NEAR AI | Proposal deliberation and structured voting |
| Agents | TypeScript + Hono 4.8 | HTTP servers for coordination and voting |
| Shared Memory | Ensue Memory Network | Off-chain agent coordination (JSON-RPC 2.0/SSE) |
| TEE Runtime | Phala Network + Shade Agent SDK | Trusted execution environment |
| Frontend | Next.js 15 + React 19 | Real-time monitoring dashboard |
| Build | cargo-near + wasm-opt | WASM compilation for NEAR |

## Local Development

```bash
# Start all agents (local mode, no TEE/contract needed)
./scripts/start-all.sh

# Test the full voting flow
./scripts/test-flow.sh

# Or manually trigger a vote:
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":"{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Fund a developer education program\"}}"}'

# Check results
curl http://localhost:3000/api/coordinate/status
curl http://localhost:3000/api/coordinate/workers
```

## File Map

```
near-shade-coordination/
  coordinator-contract/       # NEAR smart contract (Rust)
    src/lib.rs                # Yield/resume, manifesto, proposal lifecycle, nullifier
    Cargo.toml                # near-sdk 5.7.0, sha2, hex, serde_json
    target/near/*.wasm        # Compiled WASM binary

  coordinator-agent/          # Orchestrator agent (TypeScript)
    src/index.ts              # Entry point, local/production mode switch
    src/monitor/
      memory-monitor.ts       # Core: Ensue polling, vote tally, contract resume
    src/contract/
      resume-handler.ts       # Shade Agent SDK contract calls
      local-contract.ts       # near-api-js calls for local mode
    src/routes/
      coordinate.ts           # HTTP API: trigger, status, workers, reset

  worker-agent-{1,2,3}/      # AI voter agents (TypeScript)
    src/index.ts              # Entry point (Hono server)
    src/workers/
      task-handler.ts         # Task execution, Ensue status tracking
      ai-voter.ts             # NEAR AI integration (DeepSeek-V3.1)
    src/routes/
      task.ts                 # HTTP API: execute, status, health

  shared/                     # Shared library
    src/ensue-client.ts       # Ensue JSON-RPC client (SSE parsing)
    src/constants.ts          # Memory key paths, worker IDs
    src/types.ts              # TypeScript interfaces (VoteResult, TallyResult, etc.)

  frontend/                   # Next.js 15 monitoring dashboard
    src/app/page.tsx          # Main dashboard layout
    src/app/components/       # CoordinatorPanel, WorkerCard, ContractStatePanel, EventLog
    src/lib/api.ts            # Backend API client
    src/lib/use-polling.ts    # React polling hook

  scripts/                    # Development scripts
    start-all.sh              # Start all services
    test-flow.sh              # End-to-end test
```
