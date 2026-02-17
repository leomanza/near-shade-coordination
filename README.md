# Delibera -- Privacy-Preserving Multi-Agent DAO Coordination on NEAR

A decentralized platform where independent AI agents deliberate and vote on DAO proposals. Individual reasoning stays private off-chain in Ensue shared memory, while only aggregate tallies are settled on the NEAR blockchain. Anyone can deploy their own coordinator or worker agents through the platform -- each running autonomously inside Phala TEE containers.

Built with [NEAR Shade Agents](https://docs.near.org/ai/shade-agents/getting-started/introduction), [NEAR AI](https://near.ai/), [Ensue Memory Network](https://ensue.dev), [Phala TEE](https://phala.network/), and [PingPay](https://pingpay.io/).

## How It Works

```
1. User submits a proposal to the NEAR smart contract
2. Contract creates a yielded promise (pauses execution, waiting for off-chain result)
3. Coordinator agent detects the pending proposal via Ensue polling
4. Coordinator dispatches the proposal to N independent AI voter agents
5. Each voter agent:
   - Fetches the DAO manifesto from the NEAR contract
   - Loads its persistent agent identity (values, knowledge, decision history)
   - Calls NEAR AI (DeepSeek-V3.1) to deliberate on the proposal
   - Receives a NEAR AI verification proof (TEE-signed attestation of which model ran)
   - Writes its vote + reasoning to Ensue shared memory (private, off-chain)
6. Coordinator reads all votes from Ensue, tallies the result
7. Only the aggregate tally (Approved/Rejected count) goes on-chain
8. Contract resumes with the final decision
```

Individual AI reasoning and votes never touch the blockchain -- they stay private in Ensue shared memory. NEAR AI verification proofs cryptographically link each vote to a specific model running inside verified TEE hardware.

## Architecture

```
                        NEAR Blockchain (public, testnet)
           ┌─────────────────────────────────────────────────┐
           │  Coordinator Contract          Registry Contract │
           │  - Stores manifesto            - All coordinators│
           │  - Yield/resume pattern        - All workers     │
           │  - Proposal lifecycle          - Endpoint URLs   │
           │  - Only aggregate tally        - CVM IDs         │
           └──────────────┬──────────────────────────────────┘
                          │
                resume(tally only)
                          │
           ┌──────────────┴──────────────┐
           │    Coordinator Agent (:3000) │──── Phala TEE (production)
           │    - Dispatches proposals    │
           │    - Monitors completion     │
           │    - Tallies votes           │
           │    - Settles on-chain        │
           └──┬──────────┬──────────┬────┘
         read │    read  │    read  │
           ┌──┴──────────┴──────────┴────┐
           │   Ensue Shared Memory        │
           │   (off-chain, permissioned)  │
           └──┬──────────┬──────────┬────┘
         write│    write │    write │
        ┌─────┴──┐ ┌─────┴──┐ ┌─────┴──┐
        │Voter 1 │ │Voter 2 │ │Voter N │──── Phala TEE (production)
        │(:3001) │ │(:3002) │ │(:300N) │
        └────────┘ └────────┘ └────────┘

           ┌─────────────────────────────┐
           │  Protocol API (:3005)       │
           │  - Agent deploy (Phala)     │
           │  - PingPay payments         │
           │  - Registry reads/writes    │
           │  - Worker registration      │
           └─────────────────────────────┘

           ┌─────────────────────────────┐
           │  Frontend (:3004)           │
           │  - Public dashboard         │
           │  - Deploy/buy agents        │
           │  - Coordinator panel        │
           │  - On-chain state viewer    │
           └─────────────────────────────┘
```

## Data Privacy Model

| Data | Location | Visibility |
|------|----------|------------|
| Proposal text | NEAR blockchain | Public |
| DAO manifesto | NEAR blockchain | Public |
| Aggregate tally (N Approved, M Rejected) | NEAR blockchain | Public |
| Final decision (Approved/Rejected) | NEAR blockchain | Public |
| Worker submission hashes (nullifier) | NEAR blockchain | Public |
| Coordinator & worker endpoint URLs | NEAR blockchain (registry) | Public |
| Individual AI votes | Ensue shared memory | Private |
| AI reasoning / deliberation | Ensue shared memory | Private |
| Agent identity & knowledge | Ensue shared memory | Private |
| NEAR AI verification proofs | Ensue shared memory | Private |
| Processing metadata | Ensue shared memory | Private |

## Project Structure

```
near-shade-coordination/
├── coordinator-contract/        # NEAR smart contract (Rust, near-sdk 5.7.0)
│   └── src/lib.rs               # Yield/resume, manifesto, proposal lifecycle, nullifier
├── registry-contract/           # Agent registry contract (Rust, near-sdk 5.17.2)
│   └── src/lib.rs               # Multi-coordinator/worker registry with endpoint URLs
├── coordinator-agent/           # Orchestrator agent (TypeScript + Hono)
│   └── src/
│       ├── index.ts             # Shade Agent v2 init, local/production modes
│       ├── routes/coordinate.ts # Coordination API (trigger, status, proposals)
│       └── monitor/             # Ensue polling, vote aggregation, contract resume
├── worker-agent/                # AI voter agent template (TypeScript + Hono)
│   └── src/
│       ├── workers/ai-voter.ts  # NEAR AI integration (DeepSeek-V3.1 + verification)
│       └── workers/task-handler.ts  # Task execution, Ensue status tracking
├── protocol-api/                # Central platform API (TypeScript + Hono)
│   └── src/
│       ├── routes/deploy.ts     # Phala CVM deploy + registry contract updates
│       ├── routes/agents.ts     # Agent endpoint reads/writes (on-chain registry)
│       ├── routes/workers.ts    # Worker registration (coordinator contract)
│       ├── routes/payments.ts   # PingPay checkout + webhooks
│       └── phala/phala-client.ts # Phala Cloud SDK + endpoint discovery
├── shared/                      # Shared library (@near-shade-coordination/shared)
│   └── src/
│       ├── ensue-client.ts      # Ensue JSON-RPC 2.0 over SSE client
│       ├── constants.ts         # Memory key paths
│       └── types.ts             # Shared TypeScript interfaces
├── frontend/                    # Next.js 15 dashboard + deploy UI
│   └── src/
│       ├── app/page.tsx         # Public dashboard (on-chain state, proposals)
│       ├── app/coordinator/     # Coordinator management panel
│       ├── app/worker/          # Worker management panel
│       └── lib/api.ts           # API client (protocol + coordinator + NEAR RPC)
├── templates/                   # Docker Compose templates for Phala deployment
│   ├── coordinator-compose.yml  # Coordinator agent container definition
│   └── worker-compose.yml       # Worker agent container definition
└── scripts/                     # Development utilities
```

## Smart Contracts

### Coordinator Contract

**Address:** `coordinator.agents-coordinator.testnet` (testnet) | `coordinator.agents-coordinator.near` (mainnet)
**Owner:** `agents-coordinator.testnet`

The coordinator contract manages the full proposal lifecycle using NEAR's yield/resume pattern:

- **Manifesto** -- DAO guidelines stored on-chain that AI agents reference when voting
- **Yield/Resume** -- Contract pauses execution with `promise_yield_create`, waits for off-chain agents to deliberate, then resumes with `promise_yield_resume` when the coordinator submits the tally
- **Proposal states** -- `Created` -> `WorkersCompleted` -> `Finalized` (or `TimedOut` after ~200 blocks)
- **Nullifier pattern** -- Worker submission hashes (SHA256 of result) recorded on-chain to prevent double-voting, without revealing actual votes
- **Hash verification** -- SHA256 on config and result payloads to detect tampering between off-chain and on-chain

Key methods:

| Method | Type | Description |
|--------|------|-------------|
| `submit_proposal` | change | Submit a new proposal (creates yielded promise) |
| `resume_with_result` | change | Coordinator submits aggregate tally to resume contract |
| `set_manifesto` | change | Owner sets/updates the DAO manifesto |
| `register_worker` | change | Register a worker agent on-chain |
| `get_manifesto` | view | Read the current manifesto |
| `get_all_proposals` | view | List all proposals with state |
| `get_registered_workers` | view | List registered worker agents |

### Registry Contract

**Address:** `registry.agents-coordinator.testnet` (testnet)
**Owner:** `agents-coordinator.testnet`

The registry contract is the platform-level directory of all coordinators and workers across the Delibera ecosystem. It tracks deployment metadata and endpoint URLs on-chain.

Storage uses V2 keys (ordinals 2, 3) with the following entry schemas:

**CoordinatorEntry:**
```
coordinator_id, owner, contract_id, phala_cvm_id,
ensue_configured, endpoint_url, created_at, active
```

**WorkerEntry:**
```
worker_id, owner, coordinator_id, phala_cvm_id,
nova_group_id, endpoint_url, created_at, active
```

Key methods:

| Method | Type | Description |
|--------|------|-------------|
| `register_coordinator` | change (payable, 0.1 NEAR) | Register a new coordinator |
| `register_worker` | change (payable, 0.1 NEAR) | Register a new worker (auto-generates `{name}-{seq}` ID) |
| `update_coordinator` | change | Update coordinator metadata (endpoint_url, phala_cvm_id, etc.) |
| `update_worker` | change | Update worker metadata |
| `list_active_coordinators` | view | All active coordinators with endpoint URLs |
| `list_active_workers` | view | All active workers |
| `list_workers_by_coordinator` | view | Workers linked to a specific coordinator |
| `get_stats` | view | Total/active counts for coordinators and workers |

The `endpoint_url` field is set automatically after a successful Phala deployment -- the Protocol API polls for the public URL and writes it to the registry once the agent is operational.

## Deploy (Buy) Flow

The platform allows anyone to deploy a new coordinator or worker agent through a self-service buy flow. The sequence is:

```
User fills deploy form (name, API keys, type)
       │
       ▼
Frontend creates PingPay checkout session ──► PingPay hosted payment page
       │                                              │
       │                                     User pays (USDC on NEAR)
       │                                              │
       ▼                                              ▼
Payment confirmed ◄────────────── PingPay webhook (HMAC-verified)
       │
       ▼
Protocol API: POST /api/deploy
       │
       ├─► 1. Register on registry contract (register_coordinator / register_worker)
       │      - Requires 0.1 NEAR deposit (paid by platform signer)
       │      - Returns the on-chain entry with generated IDs
       │
       ├─► 2. Register on coordinator contract (workers only, if coordinator specified)
       │      - Links the worker to a specific coordinator for vote dispatching
       │
       ├─► 3. Deploy to Phala Cloud (if Phala API key provided)
       │      a. Provision CVM (docker compose + TEE instance type)
       │      b. Encrypt env vars with TEE public key
       │      c. Commit CVM provision (creates the container)
       │      d. Poll for public endpoint URL (up to 10 attempts, 3s apart)
       │         GET /api/v1/cvms/{id} → public_urls[].app
       │      e. Wait for app ready (up to 20 attempts, 10s apart)
       │         GET {endpoint}/ → health check returns "running"
       │
       └─► 4. Update registry contract with endpoint_url + phala_cvm_id
              - Calls update_coordinator / update_worker on-chain
              - Frontend can now resolve the agent's live URL from on-chain data
```

### Endpoint URL Lifecycle

Agent endpoint URLs are stored on-chain in the registry contract, not in Ensue. This means:

- **After deploy:** The Protocol API writes the Phala endpoint URL to the registry contract once the agent health check passes
- **Frontend resolution:** The dashboard reads `endpoint_url` from `list_active_coordinators` / `list_active_workers` via NEAR RPC view calls
- **Manual override:** The `PUT /api/agents/:agentId/endpoint` route allows updating an agent's endpoint URL (calls `update_coordinator`/`update_worker` on-chain)
- **Persistence:** Endpoint URLs survive across frontend sessions since they're stored on NEAR blockchain

### Phala Endpoint Discovery

When deploying to Phala Cloud, the system automatically discovers the public endpoint using the pattern from shade-agent-cli:

1. After CVM creation, poll `GET /api/v1/cvms/{id}` with `X-API-Key` header
2. Look for non-empty `public_urls[].app` entries
3. Once a URL is found, ping it repeatedly until the health check responds with `"running"`
4. Write the verified endpoint URL to the registry contract

## AI Voting Flow

Each voter agent follows this process:

1. **Fetch manifesto** -- Reads the DAO manifesto from the NEAR contract via RPC
2. **Load agent identity** -- Persistent identity from Ensue: values, guidelines, voting weights, past decisions
3. **AI deliberation** -- Calls NEAR AI API (`cloud-api.near.ai/v1`) with manifesto + proposal + agent context
4. **Structured vote** -- DeepSeek-V3.1 uses function calling (`dao_vote` tool) to return `{vote: "Approved"|"Rejected", reasoning: "..."}`
5. **Verification proof** -- Fetches NEAR AI cryptographic proof:
   - `GET /v1/signature/{chatId}` -- TEE-signed hash of request+response (proves which model was used)
   - `GET /v1/attestation/report` -- Links signing address to verified TEE hardware (Intel TDX / NVIDIA)
6. **Write to Ensue** -- Vote, reasoning, and verification proof written to private namespace
7. **Coordinator tallies** -- Reads all worker votes, counts Approved vs Rejected
8. **On-chain settlement** -- Only `{approved: N, rejected: M, decision: "Approved"}` goes on-chain

## Services

### Protocol API (`:3005`)

Central platform service for deployment, payments, and agent registry operations. Runs as a single instance.

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/deploy` | Deploy coordinator or worker to Phala + register on-chain |
| GET | `/api/deploy/status/:cvmId` | Check Phala CVM deployment status |
| GET | `/api/agents/endpoints` | All agent endpoint URLs from registry contract |
| GET | `/api/agents/:agentId/endpoint` | Specific agent's endpoint |
| PUT | `/api/agents/:agentId/endpoint` | Update an agent's endpoint URL on-chain |
| GET | `/api/workers/registered` | Registered workers from coordinator contract |
| POST | `/api/workers/register` | Register a worker on coordinator contract |
| DELETE | `/api/workers/:workerId` | Remove a worker |
| POST | `/api/payments/checkout` | Create PingPay checkout session |
| POST | `/api/payments/webhook` | Receive PingPay payment events |

### Coordinator Agent (`:3000`)

Per-DAO orchestrator. Each coordinator manages its own set of workers and proposals.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Health check (reports mode: local/production/degraded) |
| GET | `/api/coordinate/status` | Current coordinator status + latest tally |
| GET | `/api/coordinate/workers` | Worker statuses from Ensue |
| GET | `/api/coordinate/pending` | Pending coordination requests |
| POST | `/api/coordinate/trigger` | Trigger a vote on a proposal |
| POST | `/api/coordinate/reset` | Reset Ensue memory state |
| GET | `/api/coordinate/proposals` | Proposal history |
| GET | `/api/coordinate/proposals/:id` | Proposal detail with worker results |

### Worker Agent (`:3001-300N`)

Independent AI voter agents. Each worker has its own persistent identity and deliberates autonomously.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/task/health` | Worker health check |
| POST | `/api/task/execute` | Execute a task (vote on proposal) |
| GET | `/api/knowledge/identity` | Worker's agent identity (manifesto, preferences, history) |
| POST | `/api/knowledge/feed` | Feed knowledge notes or voting weights |
| POST | `/api/knowledge/manifesto` | Update agent manifesto (name, role, values) |

## Ensue Memory Network

[Ensue](https://ensue.dev) is the off-chain coordination layer -- a permissioned key-value memory network that agents use to share state without direct communication.

### Why Ensue

Agents running in Trusted Execution Environments (TEEs) can't directly talk to each other. Ensue provides a shared memory space where they read/write data asynchronously, coordinated by key namespaces.

### Protocol

- **JSON-RPC 2.0 over SSE** -- All operations are POST to `https://api.ensue-network.ai/`
- **Server-Sent Events** -- Responses arrive as `text/event-stream` with `data: {jsonrpc payload}`
- **Bearer auth** -- API key in the `Authorization` header
- **Operations:** `create_memory`, `read_memory`, `update_memory`, `delete_memory`, `list_keys`

### Data Layout

```
coordination/
  tasks/
    worker1/
      status       "idle" | "pending" | "processing" | "completed" | "failed"
      result       { workerId, vote, reasoning, processingTime, verificationProof }
      timestamp    1770497735701
      error        null | "error message"
    worker2/...
    workerN/...
  coordinator/
    status         "idle" | "monitoring" | "aggregating" | "completed"
    tally          { approved: 2, rejected: 1, decision: "Approved", ... }
    proposal_id    1
  config/
    task_definition  { type: "vote", parameters: { proposal: "..." } }
```

### Security Model

| Agent | Access | Namespace |
|-------|--------|-----------|
| Voter N | write | `coordination/tasks/workerN/*` |
| Coordinator | read | `coordination/tasks/*` (all voters) |
| Coordinator | write | `coordination/coordinator/*` |
| Frontend | read | `coordination/*` (display only) |

## Production Vision

When fully deployed, Delibera operates as a permissionless platform:

1. **Anyone can create a coordinator** -- Deploy a new DAO coordinator through the buy flow. It gets its own Phala TEE container, NEAR contract integration, and Ensue namespace. The coordinator appears in the on-chain registry.

2. **Anyone can add workers** -- Deploy independent voter agents that join an existing coordinator. Each worker has its own persistent AI identity, knowledge base, and voting history. Workers deliberate autonomously based on their unique values and the DAO manifesto.

3. **Fully autonomous operation** -- Once deployed, coordinators automatically detect on-chain proposals, dispatch to workers, collect votes, and settle results. No human intervention needed.

4. **Verifiable AI inference** -- Every AI vote includes a NEAR AI verification proof: a TEE-signed attestation linking the vote to a specific model running inside verified hardware. This proves which model was used without exposing the actual vote content.

5. **Privacy by design** -- Individual votes and reasoning never leave the private Ensue namespace. Only aggregate tallies (N approved, M rejected) are recorded on-chain. The coordinator itself runs in a TEE, so even the tally aggregation happens in trusted hardware.

6. **On-chain discoverability** -- The registry contract serves as a public directory. Anyone can query `list_active_coordinators` or `list_active_workers` to discover running agents, their endpoint URLs, and which coordinator they belong to.

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Coordinator Contract | Rust + near-sdk 5.7.0 | On-chain settlement, yield/resume |
| Registry Contract | Rust + near-sdk 5.17.2 | Platform-wide agent directory |
| AI Model | DeepSeek-V3.1 via NEAR AI | Proposal deliberation and voting |
| AI Verification | NEAR AI Signature + Attestation API | Cryptographic proof of model identity |
| Agents | TypeScript + Hono 4.8 | HTTP servers for coordination |
| Shared Memory | Ensue Memory Network | Off-chain agent coordination |
| TEE Runtime | Phala Network + Shade Agent SDK v2 | Trusted execution environment |
| Payments | PingPay (USDC on NEAR) | Agent deployment checkout |
| Frontend | Next.js 15 + React 19 | Dashboard, deploy UI, on-chain viewer |
| WASM Build | nightly Rust + build-std + wasm-opt | NEAR-compatible WASM (no bulk-memory) |

## Quick Start

### Prerequisites

- Node.js 22+
- Rust + wasm32-unknown-unknown target (for contract builds)
- NEAR testnet account with credentials in keychain
- [Ensue API key](https://ensue.dev)
- [NEAR AI API key](https://cloud-api.near.ai) (for AI voting)

### 1. Build Shared Library

```bash
cd shared && npm install && npm run build
```

### 2. Configure Environment

Each service has its own `.env.development.local`. Key variables:

**Coordinator agent** (`coordinator-agent/.env.development.local`):
```bash
PORT=3000
LOCAL_MODE=true                    # Skip TEE registration for local dev
ENSUE_API_KEY=your-ensue-api-key
NEAR_NETWORK=testnet
NEAR_ACCOUNT_ID=agents-coordinator.testnet
NEXT_PUBLIC_contractId=coordinator.agents-coordinator.testnet
```

**Workers** (`worker-agent/.env.worker1.local`, `.env.worker2.local`, `.env.worker3.local`):
```bash
WORKER_ID=worker1                  # worker2, worker3
PORT=3001                          # 3002, 3003
ENSUE_API_KEY=your-ensue-api-key
NEAR_AI_API_KEY=your-near-ai-key   # or NEAR_API_KEY
NEXT_PUBLIC_contractId=coordinator.agents-coordinator.testnet
```

**Protocol API** (`protocol-api/.env.development.local`):
```bash
PORT=3005
NEAR_NETWORK=testnet
NEAR_ACCOUNT_ID=agents-coordinator.testnet
NEXT_PUBLIC_contractId=coordinator.agents-coordinator.testnet
NEXT_PUBLIC_REGISTRY_CONTRACT_ID=registry.agents-coordinator.testnet
PINGPAY_API_KEY=your-pingpay-key   # optional, for payments
```

**Frontend** (`frontend/.env.local`):
```bash
NEXT_PUBLIC_COORDINATOR_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3005
NEXT_PUBLIC_NEAR_NETWORK=testnet
NEXT_PUBLIC_contractId=coordinator.agents-coordinator.testnet
NEXT_PUBLIC_REGISTRY_CONTRACT_ID=registry.agents-coordinator.testnet
```

### 3. Start All Services

```bash
# Terminal 1 -- Coordinator
cd coordinator-agent && npm install && npm run dev

# Terminal 2 -- Worker 1
cd worker-agent && npm run dev:worker1

# Terminal 3 -- Worker 2
cd worker-agent && npm run dev:worker2

# Terminal 4 -- Worker 3
cd worker-agent && npm run dev:worker3

# Terminal 5 -- Protocol API
cd protocol-api && npm install && npm run dev

# Terminal 6 -- Frontend
cd frontend && npm install && npm run dev
```

### 4. Submit a Proposal

```bash
# Via the coordinator API
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":{"type":"vote","parameters":{"proposal":"Fund a developer grant program for 10,000 NEAR"},"timeout":30000}}'

# Monitor the voting flow
curl http://localhost:3000/api/coordinate/status
curl http://localhost:3000/api/coordinate/workers

# Or open the dashboard at http://localhost:3004
```

## Building Contracts

### WASM Build (NEAR-compatible)

NEAR testnet does not support bulk-memory or sign-ext WebAssembly features. Use the nightly toolchain with `build-std` to produce compatible WASM:

```bash
# Registry contract (near-sdk 5.17.2)
cd registry-contract

PATH="$HOME/.rustup/toolchains/nightly-2025-01-07-aarch64-apple-darwin/bin:$HOME/.cargo/bin:/usr/bin:/bin" \
RUSTFLAGS='-C link-arg=-s -C target-cpu=mvp -C target-feature=-bulk-memory,-sign-ext,-multivalue,-reference-types' \
cargo build --target wasm32-unknown-unknown --release \
  -Z build-std=std,panic_abort \
  -Z build-std-features=panic_immediate_abort

# Optimize (use --mvp-features to prevent wasm-opt from reintroducing sign-ext)
wasm-opt -Oz --mvp-features --enable-mutable-globals \
  target/wasm32-unknown-unknown/release/registry_contract.wasm \
  -o target/registry_contract_optimized.wasm

# Validate
wasm-tools validate --features=mvp,mutable-global target/registry_contract_optimized.wasm
```

### Deploy to Testnet

```bash
near contract deploy registry.agents-coordinator.testnet \
  use-file target/registry_contract_optimized.wasm \
  with-init-call migrate json-args '{"admin":"agents-coordinator.testnet"}' \
  prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-keychain send
```

## Deployments

### Testnet Contracts

| Contract | Account | Description |
|----------|---------|-------------|
| Coordinator | `coordinator.agents-coordinator.testnet` | Proposal lifecycle, yield/resume |
| Registry | `registry.agents-coordinator.testnet` | Agent directory with endpoint URLs |
| Owner | `agents-coordinator.testnet` | Admin account for both contracts |

### NEAR RPC

| Network | Endpoint |
|---------|----------|
| Testnet | `https://test.rpc.fastnear.com` |
| Mainnet | `https://rpc.fastnear.com` |

### Railway (Demo)

| Service | URL |
|---------|-----|
| Frontend | https://frontend-production-a40a1.up.railway.app |
| Protocol API | https://protocol-api-production.up.railway.app |
| Coordinator | https://coordinator-agent-production-49b6.up.railway.app |

## References

- [NEAR Shade Agents Documentation](https://docs.near.org/ai/shade-agents/getting-started/introduction)
- [NEAR AI API](https://cloud-api.near.ai)
- [NEAR AI Verification (Signature + Attestation)](https://docs.near.ai/cloud/verification/chat)
- [Ensue Memory Network](https://ensue.dev)
- [Phala Network TEE / Cloud](https://phala.network/)
- [PingPay Payments](https://pingpay.io/)
- [AI DAO Tutorial](https://docs.near.org/ai/shade-agents/tutorials/ai-dao/overview)

## License

MIT
