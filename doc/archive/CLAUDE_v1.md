# Delibera — CLAUDE.md

**Privacy-preserving multi-agent DAO coordination on NEAR.**
Individual AI votes stay private in Ensue off-chain memory; only aggregate tallies are settled on-chain via NEAR yield/resume.

---

## Project Name

The project is called **Delibera**. The repo folder is `near-shade-coordination`.

---

## Repository Layout

```
near-shade-coordination/
  coordinator-contract/       # Rust smart contract (yield/resume, nullifiers)
    src/lib.rs
    Cargo.toml                # near-sdk 5.7.0
    target/near/*.wasm

  registry-contract/          # Rust registry contract (coordinators + workers)
    src/lib.rs
    target/near/registry_contract.wasm

  coordinator-agent/          # Coordinator orchestrator (TypeScript, port 3000)
    src/index.ts
    src/monitor/memory-monitor.ts   # Core: Ensue poll, tally, contract resume
    src/contract/local-contract.ts  # near-api-js calls (LOCAL_MODE)
    src/contract/resume-handler.ts  # Shade Agent SDK calls (production)
    src/routes/coordinate.ts        # HTTP API: trigger, status, workers, reset
    src/phala/                      # Phala deploy + endpoint watching
    .env.development.local

  worker-agent/               # Shared worker codebase (runs as 3 instances)
    src/index.ts
    src/workers/task-handler.ts  # Task exec, Ensue status tracking, polling loop
    src/workers/ai-voter.ts      # NEAR AI (DeepSeek-V3.1) + verification proof
    src/nova/                    # Nova SDK integration (agent identity/memory)
    src/routes/task.ts           # HTTP API: execute, status, health
    .env.worker1.local           # WORKER_ID=worker1, PORT=3001
    .env.worker2.local           # WORKER_ID=worker2, PORT=3002
    .env.worker3.local           # WORKER_ID=worker3, PORT=3003

  shared/                     # Shared TypeScript library
    src/ensue-client.ts        # Ensue JSON-RPC 2.0 / SSE client
    src/constants.ts           # Memory key paths (MEMORY_KEYS, getWorkerKeys)
    src/types.ts               # VoteResult, TallyResult, etc.

  frontend/                   # Next.js 15 dashboard (port 3004)
    src/app/coordinator/       # Coordinator dashboard
    src/app/worker/            # Worker dashboards
    src/app/buy/               # Deploy coordinator/worker to Phala TEE
    src/app/components/        # CoordinatorPanel, WorkerCard, ContractStatePanel

  scripts/
    start-all.sh               # Start all services
    setup-local.sh
    test-flow.sh               # E2E test

  run-dev.sh                  # Main dev launcher (all 5 services)
  ARCHITECTURE.md              # Full deep-dive architecture doc
  README.md                   # Project overview
```

---

## Deployed Contracts (NEAR Testnet)

| Contract | Account ID |
|---|---|
| Coordinator | `coordinator.agents-coordinator.testnet` |
| Registry | `registry.agents-coordinator.testnet` |
| Master account | `agents-coordinator.testnet` |

- NEAR RPC: `https://test.rpc.fastnear.com` (old `rpc.testnet.near.org` is deprecated/rate-limited)
- near-cli-rs uses `archival-rpc.testnet.near.org` (still works)
- `NEXT_PUBLIC_contractId` env var overrides coordinator contract ID

---

## Running Locally

```bash
# Start all 5 services (coordinator :3000, workers :3001-3003, frontend :3004)
./run-dev.sh

# Or individually:
cd coordinator-agent && npm run dev       # uses .env.development.local
cd worker-agent && npm run dev:worker1    # uses .env.worker1.local
cd worker-agent && npm run dev:worker2
cd worker-agent && npm run dev:worker3
cd frontend && npm run dev

# Trigger a vote manually:
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":"{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Fund a developer education program\"}}"}'

# Check status:
curl http://localhost:3000/api/coordinate/status
curl http://localhost:3000/api/coordinate/workers
```

---

## Key Environment Variables

### coordinator-agent/.env.development.local
```
PORT=3000
LOCAL_MODE=true
NEAR_NETWORK=testnet
POLL_INTERVAL=5000
ENSUE_API_KEY=...
ENSUE_TOKEN=...
NEAR_ACCOUNT_ID=agents-coordinator.testnet
NEAR_SEED_PHRASE=...
NEXT_PUBLIC_contractId=coordinator.agents-coordinator.testnet
NEAR_API_KEY=...                   # NEAR AI API key (cloud-api.near.ai)
WORKERS=worker1:3001,worker2:3002,worker3:3003
PINGPAY_API_KEY=...
PINGPAY_API_URL=https://pay.pingpay.io/api
PINGPAY_WEBHOOK_SECRET=...
# Production (Shade Agent / Phala):
AGENT_CONTRACT_ID=coordinator.agents-coordinator.testnet
SPONSOR_ACCOUNT_ID=agents-coordinator.testnet
SPONSOR_PRIVATE_KEY=...
```

### worker-agent/.env.worker1.local
```
WORKER_ID=worker1
PORT=3001
NEAR_NETWORK=testnet
ENSUE_API_KEY=...
ENSUE_TOKEN=...
NEAR_API_KEY=...                   # NEAR AI API key
NOVA_API_KEY=...
NOVA_ACCOUNT_ID=manza.nova-sdk.near
NOVA_GROUP_ID=shadeboard-agents
```

---

## LOCAL_MODE vs Production

| | LOCAL_MODE=true | Production |
|---|---|---|
| Contract calls | `near-api-js` with seed phrase | Shade Agent SDK + DCAP attestation |
| Worker trigger | HTTP POST to workers | Write `STATUS=pending` to Ensue; workers self-poll |
| TEE | None | Phala Intel TDX |
| Registry check | Skipped | Required |

**Critical (Phala/non-LOCAL_MODE):** Workers MUST poll Ensue (`workerKeys.STATUS`) every 3s via `startWorkerPollingLoop()` in `task-handler.ts`. Coordinator only writes `STATUS='pending'` — it does NOT HTTP-call workers.

---

## The Voting Flow (End-to-End)

1. User calls `start_coordination(task_config)` on NEAR contract
2. Contract creates a **yielded promise** (pauses, ~200 block timeout)
3. Coordinator polls contract every 5s for `Created` proposals
4. Coordinator writes task config to Ensue (`coordination/config/task_definition`)
5. Coordinator sets worker status keys to `pending`
6. Each worker independently:
   - Fetches DAO manifesto from contract (RPC view call)
   - Calls NEAR AI (DeepSeek-V3.1) with manifesto + proposal via `dao_vote` tool
   - Gets NEAR AI verification proof (ECDSA-signed attestation)
   - Writes `{vote, reasoning}` to `coordination/tasks/workerN/result`
   - Sets `coordination/tasks/workerN/status = "completed"`
7. Coordinator detects all workers done (120s timeout)
8. Coordinator reads all votes, tallies Approved vs Rejected
9. Calls `record_worker_submissions` on-chain (nullifier hashes, prevents double-voting)
10. Calls `coordinator_resume` on-chain with ONLY `{approved, rejected, decision, workerCount}`
11. Contract validates hashes, resumes yield, stores finalized result

**Privacy guarantee:** Individual votes + reasoning stay in Ensue only. On-chain: aggregate tally + nullifier hashes + config/result integrity hashes.

---

## Ensue Memory Layout

```
coordination/
  tasks/
    worker1/
      status       "idle"|"pending"|"processing"|"completed"|"failed"
      result       {workerId, vote, reasoning, computedAt, processingTime}
      timestamp    unix ms
      error        null | "error message"
    worker2/...
    worker3/...
  coordinator/
    status         "idle"|"monitoring"|"recording_submissions"|"aggregating"|"resuming"|"completed"
    tally          {approved, rejected, decision, workerCount, workers, timestamp, proposalId}
    proposal_id    N
  config/
    task_definition  {"type":"vote","parameters":{"proposal":"..."}}
```

---

## Ensue API (JSON-RPC 2.0 over SSE)

- Endpoint: `POST https://api.ensue-network.ai/`
- Auth: `Bearer {ENSUE_API_KEY}` header
- Protocol: JSON-RPC 2.0 wrapped in SSE (`text/event-stream`)
- Response format: `data: {"jsonrpc":"2.0","id":N,"result":{"content":[...],"structuredContent":{...},"isError":false}}`
- Read uses `structuredContent.results[].value` (NOT `.memories`)
- `list_keys` uses `structuredContent.keys[]`
- JSON-RPC errors are at `parsed.error` (top level), NOT `result.isError`
- `update_memory` returns JSON-RPC error if key doesn't exist — catch and fallback to `create_memory`

---

## NEAR AI Integration

- API: `https://cloud-api.near.ai/v1` (OpenAI-compatible)
- Auth: `Authorization: Bearer {NEAR_API_KEY}`
- Model: `deepseek-ai/DeepSeek-V3.1`
- Forced tool call: `tool_choice: {type:"function", function:{name:"dao_vote"}}`
- Tool schema: `dao_vote({vote: "Approved"|"Rejected", reasoning: string})`
- Verification proof: after completion, `GET /v1/signature/{chat_id}?model={model_id}&signing_algo=ecdsa`
  - Returns `{text, signature, signing_address}` — verified with `ethers.verifyMessage(text, signature)`
  - Stored in Ensue under `coordination/tasks/{workerId}/verification_proof`

---

## Smart Contract Patterns (near-sdk 5.7.0)

```rust
#[near(contract_state)]          // NOT #[near_bindgen]
pub struct MyContract { ... }

#[near]                          // NOT #[near_bindgen]
impl MyContract { ... }

#[near(serializers = [json, borsh])]  // for data structs

use near_sdk::store::{IterableMap, IterableSet};  // NOT collections::

Gas::from_tgas(50)               // NOT Gas(50_000_000_000_000)

// Callback:
#[callback_result] response: Result<T, PromiseError>  // NOT env::promise_result(0)

// Yield ID:
env::read_register(YIELD_REGISTER).try_into()  // must read from register
```

**BorshStorageKey — CRITICAL:** Borsh serializes enum variants as ordinal index bytes (0, 1, 2...). Renaming a variant does NOT change its storage prefix. When migrating storage layouts, add `_Deprecated` placeholder variants to burn old ordinals.

Current contract uses V3 storage keys:
```rust
pub enum StorageKey {
    _Deprecated0, _Deprecated1, _Deprecated2, _Deprecated3,
    ApprovedCodehashesV3,       // ordinal 4
    CoordinatorByAccountIdV3,   // ordinal 5
    ProposalsV3,                // ordinal 6
}
```

Current codehash: `7173eea7b2fb1c7f76ad3b88d65fb23f50cbb465d42eeacd726623da643d666c`

---

## Building the NEAR Contract (WASM)

**Working build command** (avoids bulk-memory/sign-ext not supported on NEAR testnet):

```bash
# Must use rustup nightly (not Homebrew Rust)
PATH="$HOME/.rustup/toolchains/nightly-2025-01-07-.../bin:$HOME/.cargo/bin:/usr/bin:$PATH"

RUSTFLAGS='-C link-arg=-s -C target-cpu=mvp -C target-feature=-bulk-memory,-sign-ext,-multivalue,-reference-types' \
cargo build --target wasm32-unknown-unknown --release \
  -Z build-std=std,panic_abort -Z build-std-features=panic_immediate_abort

# Optimize:
wasm-opt -Oz input.wasm -o output.wasm

# Validate (must pass):
wasm-tools validate --features=mvp,mutable-global output.wasm
```

Notes:
- `-C target-cpu=mvp` alone is NOT enough (stdlib still includes bulk-memory)
- Use `-Z build-std` to rebuild stdlib without unsupported features
- near-sdk 5.17+ requires Rust >=1.85

---

## Phala TEE Deployment

- Deploy route: `POST /api/deploy` on coordinator agent
- Provision: `POST /api/v1/cvms/provision` with compose + envs → returns `compose_hash`
- Create: `POST /api/v1/cvms` → returns CVM record
- Auth: `x-api-key` header
- **Endpoint URL delay:** Phala CVM public URL takes 3-10+ minutes after provision
  - `deployCvm()` does 3×5s quick poll; returns `status:'deploying'` if not ready
  - `watchForEndpoint()` in `phala-client.ts`: background watcher (40×15s = 10min)
  - Frontend `/buy` page also polls `GET /api/deploy/status/:cvmId` every 15s
  - When URL found: calls `updateAgentEndpoint()` → registers on registry contract
- Free tier: $400 credits, $0.06/vCPU/hour

---

## Nova SDK Integration (Agent Identity)

- Each worker has a persistent Nova agent identity on NEAR
- `NOVA_API_KEY`, `NOVA_ACCOUNT_ID`, `NOVA_GROUP_ID` env vars
- Workers load past decision history / personal values from Nova before voting
- Nova NEAR mainnet: agent records stored on NEAR mainnet (`nova-sdk.near`)

---

## TypeScript dotenv Pattern

```typescript
// WRONG — import hoisting breaks env loading:
import { someModule } from './module';  // may init before dotenv runs
dotenv.config();

// CORRECT — preload via tsx flag:
// package.json: "dev": "DOTENV_CONFIG_PATH=.env.development.local tsx -r dotenv/config src/index.ts"
```

---

## Registry Contract

- Deployed: `registry.agents-coordinator.testnet`
- Admin: `agents-coordinator.testnet`
- Methods: `register_coordinator`, `register_worker` (both require 0.7 NEAR deposit)
- Stores: coordinator/worker accounts, endpoint URLs, CVM IDs
- Storage keys: ordinal 0 = Coordinators, ordinal 1 = Workers
- WASM: `registry-contract/target/near/registry_contract.wasm` (144K)

---

## Common Gotchas

1. **Yield timeout** — ~200 blocks on testnet (~200s). Contract starts vote with 15s timeout guard in `start_coordination`.

2. **Callback param names** — Must EXACTLY match JSON keys in `promise_yield_create` args. `_task_config` ≠ `task_config` causes silent deserialization failure.

3. **Worker polling loop** — In production (non-LOCAL_MODE), `triggerWorkers()` only writes `STATUS='pending'`. Workers must run `startWorkerPollingLoop()` to self-trigger.

4. **promise_yield_resume** — Returns `bool` (true=matched, false=expired). Check the return value.

5. **near-cli-rs TTY** — Requires TTY for seed phrase signing. Use near-api-js scripts instead for automation.

6. **NEAR RPC** — Use `https://test.rpc.fastnear.com`. The old `rpc.testnet.near.org` is deprecated and rate-limited.

7. **Coordinator contract** — `coordinator_resume` and `record_worker_submissions` require TEE-registered coordinator with approved codehash. In LOCAL_MODE this check is bypassed.
