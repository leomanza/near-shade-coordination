# ShadeBoard — Privacy-Preserving Multi-Agent Voting on NEAR

A multi-agent coordination system where AI agents independently deliberate and vote on DAO proposals, with individual reasoning kept private off-chain and only the aggregate tally settled on the NEAR blockchain.

Built with [NEAR Shade Agents](https://docs.near.org/ai/shade-agents/getting-started/introduction), [NEAR AI](https://near.ai/), [Ensue Memory Network](https://ensue.dev), and [Phala TEE](https://phala.network/).

## How It Works

```
1. User submits a proposal to the NEAR smart contract
2. Contract creates a yielded promise (pauses, waiting for result)
3. Coordinator agent detects the pending proposal
4. Coordinator dispatches the proposal to 3 independent AI voter agents
5. Each voter agent:
   - Fetches the DAO manifesto from the contract
   - Calls NEAR AI (DeepSeek-V3.1) to deliberate on the proposal
   - Writes its vote + reasoning to Ensue shared memory (private, off-chain)
6. Coordinator reads all votes from Ensue, tallies the result
7. Only the aggregate tally (Approved/Rejected count) goes on-chain
8. Contract resumes with the final decision
```

Individual AI reasoning and votes never touch the blockchain — they stay private in Ensue shared memory.

## Architecture

```
                      NEAR Blockchain (public)
                 ┌──────────────────────────────┐
                 │  Coordinator Contract         │
                 │  - Stores manifesto           │
                 │  - Yield/resume pattern       │
                 │  - Proposal lifecycle         │
                 │  - Only aggregate tally       │
                 └──────────────┬───────────────┘
                                │
                      resume(tally only)
                                │
                 ┌──────────────┴───────────────┐
                 │  Coordinator Agent (:3000)    │
                 │  - Dispatches proposals       │
                 │  - Monitors voter completion  │
                 │  - Tallies votes              │
                 │  - Settles on-chain           │
                 └───┬──────────┬──────────┬────┘
                read │    read  │    read  │
                 ┌───┴──────────┴──────────┴────┐
                 │   Ensue Shared Memory         │
                 │   (off-chain, permissioned)   │
                 └───┬──────────┬──────────┬────┘
               write │    write │    write │
              ┌──────┴┐  ┌─────┴──┐  ┌────┴─────┐
              │Voter 1│  │Voter 2 │  │Voter 3   │
              │(:3001)│  │(:3002) │  │(:3003)   │
              └───────┘  └────────┘  └──────────┘
```

## What Goes Where

| Data | Location | Visibility |
|------|----------|------------|
| Proposal text | NEAR blockchain | Public |
| DAO manifesto | NEAR blockchain | Public |
| Aggregate tally (3 Approved, 0 Rejected) | NEAR blockchain | Public |
| Final decision (Approved/Rejected) | NEAR blockchain | Public |
| Worker submission hashes (nullifier) | NEAR blockchain | Public |
| Individual AI votes | Ensue shared memory | Private |
| AI reasoning / deliberation | Ensue shared memory | Private |
| Processing metadata | Ensue shared memory | Private |

## Project Structure

```
near-shade-coordination/
├── coordinator-contract/     # NEAR smart contract (Rust)
│   └── src/lib.rs            # Yield/resume, manifesto, proposal lifecycle
├── coordinator-agent/        # Orchestrator (TypeScript + Hono)
│   └── src/monitor/          # Ensue polling, vote aggregation, contract resume
├── worker-agent-{1,2,3}/    # AI voter agents (TypeScript + Hono)
│   └── src/workers/
│       ├── task-handler.ts   # Task execution, Ensue status tracking
│       └── ai-voter.ts       # NEAR AI integration (DeepSeek-V3.1)
├── shared/                   # Shared library
│   └── src/
│       ├── ensue-client.ts   # Ensue JSON-RPC client
│       ├── constants.ts      # Memory key paths
│       └── types.ts          # TypeScript interfaces
├── frontend/                 # Next.js monitoring dashboard
│   └── src/app/
│       ├── page.tsx          # Dashboard with live voting flow
│       └── components/       # ContractStatePanel, WorkerCard, etc.
└── scripts/                  # Dev scripts (start-all, test-flow)
```

## Quick Start

### Prerequisites

- Node.js 22+
- Rust + `cargo-near` (for contract builds)
- NEAR testnet account
- [Ensue API key](https://ensue.dev)
- [NEAR AI API key](https://cloud-api.near.ai) (for AI voting)

### 1. Build Shared Library

```bash
cd shared && npm install && npm run build
```

### 2. Configure Environment

Copy `.env.development.local.example` to `.env.development.local` in each agent directory and fill in:

```bash
# All agents
ENSUE_API_KEY=your-ensue-api-key

# Workers (each worker)
WORKER_ID=worker1          # worker2, worker3
PORT=3001                  # 3002, 3003
NEAR_AI_API_KEY=your-near-ai-key
NEXT_PUBLIC_contractId=ac-proxy.agents-coordinator.testnet

# Coordinator
PORT=3000
LOCAL_MODE=true            # Skip TEE registration for local dev
NEAR_ACCOUNT_ID=agents-coordinator.testnet
NEAR_SEED_PHRASE="your seed phrase"
```

### 3. Start All Agents

```bash
# Terminal 1 — Coordinator
cd coordinator-agent && npm install && npm run dev

# Terminal 2-4 — Voter Agents
cd worker-agent-1 && npm install && npm run dev
cd worker-agent-2 && npm install && npm run dev
cd worker-agent-3 && npm install && npm run dev

# Terminal 5 — Frontend Dashboard
cd frontend && npm install && npm run dev
```

### 4. Submit a Proposal

```bash
# Via the coordinator API (local mode)
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":"{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Fund a developer grant program for 10,000 NEAR\"}}"}'

# Monitor the voting flow
curl http://localhost:3000/api/coordinate/status
curl http://localhost:3000/api/coordinate/workers

# Or open the dashboard at http://localhost:3004
```

## AI Voting Flow

Each voter agent follows this process:

1. **Fetch manifesto** — Reads the DAO manifesto from the NEAR contract via RPC
2. **AI deliberation** — Calls NEAR AI API (`cloud-api.near.ai/v1`) with the manifesto and proposal
3. **Structured vote** — The AI model (DeepSeek-V3.1) uses function calling to return `{vote: "Approved"|"Rejected", reasoning: "..."}`
4. **Write to Ensue** — Vote and reasoning are written to the worker's private Ensue namespace
5. **Coordinator tallies** — Reads all worker votes, counts Approved vs Rejected
6. **On-chain settlement** — Only `{approved: N, rejected: M, decision: "Approved"}` goes on-chain

The AI reasoning for each agent's vote stays entirely in Ensue and never reaches the blockchain.

## Ensue Memory Network

[Ensue](https://ensue.dev) is the off-chain coordination layer — a permissioned key-value memory network that agents use to share state without direct communication.

### Why Ensue

Agents running in Trusted Execution Environments (TEEs) can't directly talk to each other. Ensue provides a shared memory space where they read/write data asynchronously, coordinated by key namespaces.

### API Protocol

- **JSON-RPC 2.0 over SSE** — All operations are POST requests to `https://api.ensue-network.ai/`
- **Server-Sent Events** — Responses arrive as `text/event-stream` with `data: {jsonrpc payload}`
- **Bearer auth** — API key in the `Authorization` header

### Security Model

Ensue uses a **permissioned access model** with identity-based controls:

- **Memories are private by default** — only accessible to the creating agent unless explicitly shared
- **Namespace-level permissions** — access is governed by hierarchical key paths (e.g., `coordination/tasks/worker1/`)
- **Permission scopes** — `read`, `write`, `update`, `delete`, `share` with regex key patterns
- **TLS in transit** — all API communication is over HTTPS

**Regarding E2EE:** Ensue does not currently advertise end-to-end encryption. Data is protected by TLS in transit and access controls at the API layer. For our use case, the privacy guarantee comes from the combination of:
1. Ensue's permissioned access (agents can only access their own namespaces)
2. The coordinator only writing aggregate tallies on-chain (never individual votes)
3. TEE enforcement in production (verified code in the coordinator)

In production, Ensue permissions would be scoped per-agent:

| Agent | Access | Namespace |
|-------|--------|-----------|
| Voter 1 | write | `coordination/tasks/worker1/*` |
| Voter 2 | write | `coordination/tasks/worker2/*` |
| Voter 3 | write | `coordination/tasks/worker3/*` |
| Coordinator | read | `coordination/tasks/*` (all voters) |
| Coordinator | write | `coordination/coordinator/*` |
| Frontend | read | `coordination/*` (display only) |

### Data Layout

```
coordination/
  tasks/
    worker1/
      status       "idle" | "pending" | "processing" | "completed" | "failed"
      result       { workerId, vote, reasoning, processingTime }
      timestamp    1770497735701
      error        null | "error message"
    worker2/...
    worker3/...
  coordinator/
    status         "idle" | "monitoring" | "aggregating" | "completed"
    tally          { approved: 2, rejected: 1, decision: "Approved", ... }
    proposal_id    1
  config/
    task_definition  { type: "vote", parameters: { proposal: "..." } }
```

## Smart Contract

The NEAR smart contract (`coordinator-contract/src/lib.rs`) manages the full proposal lifecycle:

- **Manifesto** — DAO guidelines stored on-chain that AI agents reference when voting
- **Yield/Resume** — NEAR's unique pattern: contract pauses execution, waits for off-chain agents, then resumes
- **Proposal states** — `Created` -> `WorkersCompleted` -> `Finalized` (or `TimedOut`)
- **Nullifier pattern** — Worker submission hashes recorded on-chain to prevent double-voting, without revealing actual votes
- **Hash verification** — SHA256 checks on config and result to detect tampering

See [coordinator-contract/README.md](coordinator-contract/README.md) for detailed contract documentation.

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Smart Contract | Rust + near-sdk 5.7.0 | On-chain settlement, yield/resume |
| AI Model | DeepSeek-V3.1 via NEAR AI | Proposal deliberation and voting |
| Agents | TypeScript + Hono 4.8 | HTTP servers for coordination |
| Shared Memory | Ensue Memory Network | Off-chain agent coordination |
| TEE Runtime | Phala Network + Shade Agent SDK | Trusted execution environment |
| Frontend | Next.js 15 + React 19 | Real-time monitoring dashboard |
| Build | cargo-near + wasm-opt | WASM compilation for NEAR |

## Deployment

| Component | Address/Port |
|-----------|-------------|
| Contract | `ac-proxy.agents-coordinator.testnet` |
| Owner | `agents-coordinator.testnet` |
| Coordinator | `:3000` (local) / Phala TEE (production) |
| Voter Agents | `:3001-3003` (local) / Phala TEE (production) |
| Frontend | `:3004` (local) |
| NEAR RPC | `https://test.rpc.fastnear.com` |

## Current Status

### Completed

- Smart contract with manifesto, yield/resume, proposal lifecycle, nullifier pattern
- 3 AI voter agents with NEAR AI integration (DeepSeek-V3.1 function calling)
- Coordinator agent with Ensue monitoring, vote tallying, on-chain settlement
- Shared library with Ensue JSON-RPC client
- Frontend dashboard with live voting flow visualization
- E2E voting flow verified on NEAR testnet
- Privacy model: individual votes stay off-chain, only aggregate on-chain

### Next Steps

- **Phala TEE deployment** — Build Docker images, deploy to Phala Cloud, enable DCAP attestation
- **Scoped Ensue permissions** — Per-agent API keys with namespace restrictions
- **Mainnet preparation** — Reproducible WASM builds, gas optimization, result size limits
- **Enhanced frontend** — Wallet connection, direct proposal submission, historical results

## References

- [NEAR Shade Agents Documentation](https://docs.near.org/ai/shade-agents/getting-started/introduction)
- [Ensue Memory Network](https://ensue.dev)
- [NEAR AI API](https://cloud-api.near.ai)
- [AI DAO Tutorial](https://docs.near.org/ai/shade-agents/tutorials/ai-dao/overview)
- [Phala Network TEE](https://phala.network/)
