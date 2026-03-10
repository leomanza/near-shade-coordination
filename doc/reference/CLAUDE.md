# Delibera — CLAUDE.md
**Privacy-preserving multi-agent DAO coordination on NEAR.**
Individual AI votes stay private; only aggregate tallies are settled on-chain via NEAR yield/resume.

---

## Project Name
The project is called **Delibera**. The repo folder is `near-shade-coordination`.

---

## ⚠️ V2 Migration Status (PL Genesis: Frontiers of Collaboration)

This project is being upgraded from V1 (NEAR Innovation Sandbox) to V2 (PL Genesis hackathon).
**Read this section first before touching any file.**

### What Changes
| Component | V1 (Keep running) | V2 (Build alongside) |
|---|---|---|
| NEAR Protocol | ✅ Core ledger — unchanged | ✅ Same |
| NEAR AI (DeepSeek-V3.1) | ✅ Voter AI — unchanged | ✅ Same |
| Phala TEE | ✅ Secure compute — **role narrows** | ✅ Vote finalizer only |
| Ensue Memory Network | ✅ Hot memory — unchanged | ✅ + Storacha backup |
| PingPay | ✅ Micropayments — unchanged | ✅ Same |
| NOVA SDK | ❌ **REMOVED** | Replaced by Storacha + Lit |
| Pinata/IPFS pinning | ❌ **DEPRECATED** | Replaced by Storacha hot storage |
| Ed25519 NEAR AccountID keys | V1 agent auth | Replaced by `did:key` + UCAN |

### What's New in V2
- **Storacha** — Hot decentralized storage for persistent agent memory
- **Lit Protocol** — Threshold key management replacing TEE-locked keys
- **Zama fhEVM** — FHE blind voting contracts (prevents vote sniping)
- **Filecoin Onchain Cloud** — Long-term archival of finalized deliberations
- **Flow VRF** — Verifiable randomness for fair jury selection

### Migration Rule
V1 voting flow (Ensue + Phala + NEAR contract) must remain functional throughout migration.
Build V2 primitives as additive layers. Do not break the existing flow.

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
    src/storacha/                   # [V2] Storacha client + Lit encryption
    .env.development.local

  worker-agent/               # Shared worker codebase (runs as 3 instances)
    src/index.ts
    src/workers/task-handler.ts  # Task exec, Ensue status tracking, polling loop
    src/workers/ai-voter.ts      # NEAR AI (DeepSeek-V3.1) + verification proof
    src/nova/                    # [DEAD CODE] Nova SDK — safe to delete
    src/storacha/identity.ts     # did:key + Storacha client creation
    src/storacha/agent-identity.ts  # Public API: loadIdentity, recordDecision, formatIdentityContext
    src/storacha/profile-client.ts  # StorachaProfileClient — persistent profile I/O via Ensue + Storacha
    src/storacha/vault.ts        # Encrypt/upload/decrypt via Lit + Storacha
    src/routes/task.ts
    config/profiles.json         # SEED FILE — not read at runtime after migration
    .env.worker1.local
    .env.worker2.local
    .env.worker3.local

  contracts/
    voting/                    # [V2] Zama fhEVM blind voting contract (Solidity)
      DeliberaVoting.sol
      hardhat.config.ts

  shared/                     # Shared TypeScript library
    src/ensue-client.ts
    src/constants.ts
    src/types.ts

  frontend/                   # Next.js 15 dashboard (port 3004)
    src/app/coordinator/
    src/app/worker/
    src/app/buy/
    src/app/components/

  .claude/
    skills/
      storacha-vault/          # Encrypt + upload to Storacha with Lit ACCs
      zama-blind-voting/       # Scaffold fhEVM voting contracts
      filecoin-archive/        # Archive CIDs to Filecoin
      flow-vrf/                # Flow VRF jury selection
      ensue-backup/            # Serialize Ensue tree to Storacha

  scripts/
    start-all.sh
    setup-local.sh
    test-flow.sh
    migrate-profiles-to-storacha.ts  # One-time seed migration to Ensue + Storacha

  mcp-storage-server/          # Cloned Storacha MCP server
  run-dev.sh
  ARCHITECTURE.md
  README.md
  delibera-v2-claude-code-plan.md   # Full V2 implementation plan
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
./run-dev.sh              # coordinator :3000, workers :3001-3003, frontend :3004
WORKER_COUNT=2 ./run-dev.sh   # run only 2 workers (permissionless: add more later)

# Trigger a vote (with per-proposal quorum config):
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":{"type":"vote","parameters":{"proposal":"Fund a developer education program","voting_config":{"min_workers":2,"quorum":2}}}}'

curl http://localhost:3000/api/coordinate/status
curl http://localhost:3000/api/coordinate/workers   # returns DID-keyed worker list
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
NEAR_API_KEY=...
REGISTRY_CONTRACT_ID=registry.agents-coordinator.testnet
COORDINATOR_ENDPOINT_URL=http://localhost:3000
MIN_WORKERS=1             # minimum workers before accepting a proposal
MAX_WORKERS=10
PINGPAY_API_KEY=...
PINGPAY_API_URL=https://pay.pingpay.io/api
PINGPAY_WEBHOOK_SECRET=...
# Production (Shade Agent / Phala):
AGENT_CONTRACT_ID=coordinator.agents-coordinator.testnet
SPONSOR_ACCOUNT_ID=agents-coordinator.testnet
SPONSOR_PRIVATE_KEY=...
# [V2] Storacha (DID derived from this key is the coordinator's sovereign identity)
STORACHA_AGENT_PRIVATE_KEY=...         # from: storacha key create
STORACHA_DELEGATION_PROOF=...          # from: storacha delegation create <DID> --base64
STORACHA_SPACE_DID=...                 # (optional) from: storacha space create
# [V2] Lit Protocol
LIT_RELAY_API_KEY=...
LIT_NETWORK=datil
# [V2] Filecoin
FILECOIN_ONCHAIN_API_KEY=...
```

### worker-agent/.env.worker1.local (permissionless — no WORKER_ID needed)
```
PORT=3001
NEAR_NETWORK=testnet
ENSUE_API_KEY=...
ENSUE_TOKEN=...
NEAR_API_KEY=...
# Self-registration: worker pays 0.1 NEAR deposit to join coordinator's pool
COORDINATOR_DID=did:key:z6Mk...        # coordinator's sovereign DID (from coordinator startup log)
WORKER_ENDPOINT_URL=http://localhost:3001
NEAR_ACCOUNT_ID=worker1.agents-coordinator.testnet   # pays registration deposit
NEAR_SEED_PHRASE=...
PHALA_CVM_ID=local
REGISTRY_CONTRACT_ID=registry.agents-coordinator.testnet
# Storacha worker identity (sovereign DID derived from this key)
STORACHA_AGENT_PRIVATE_KEY=...         # from: storacha key create (unique per worker)
STORACHA_DELEGATION_PROOF=...          # from: storacha delegation create <WORKER_DID> --base64
STORACHA_SPACE_DID=...                 # shared Delibera space DID
```

### [V2] .env additions (Zama + Flow)
```
ZAMA_RPC_URL=https://devnet.zama.ai
ZAMA_PRIVATE_KEY=0x...
PHALA_TEE_ADDRESS=0x...                # TEE wallet that can call finalize()
FLOW_ACCOUNT_ADDRESS=0x...
FLOW_PRIVATE_KEY=...
```

---

## LOCAL_MODE vs Production

| | LOCAL_MODE=true | Production |
|---|---|---|
| Contract calls | `near-api-js` with seed phrase | Shade Agent SDK + DCAP attestation |
| Worker trigger | HTTP POST to workers | Write `STATUS=pending` to Ensue; workers self-poll |
| TEE | None | Phala Intel TDX |
| Registry check | `localViewRegistry` + `localRegisterCoordinator` | Required |
| Worker discovery | Registry → fallback to `WORKERS` env | Registry only |

**Critical (Phala/non-LOCAL_MODE):** Workers MUST poll Ensue (`workerKeys.STATUS`) every 3s via `startWorkerPollingLoop()`. Coordinator only writes `STATUS='pending'` — it does NOT HTTP-call workers.

---

## The Voting Flow (Permissionless, Model A)

1. User calls `start_coordination(task_config, expected_worker_count, quorum)` on NEAR contract
2. Contract creates a **yielded promise** (~200 block timeout)
3. Coordinator queries registry: `get_workers_for_coordinator(coordinatorDID)` → takes snapshot
4. Coordinator stores snapshot DID list: `coordination/coordinator/worker_snapshot_{proposalId}`
5. Coordinator writes task config to Ensue (`coordination/config/task_definition`)
6. Coordinator sets DID-keyed status to `pending` for each snapshotted worker
7. Each worker independently (identified by `did:key:z6Mk...`):
   - Fetches DAO manifesto from contract (RPC view call)
   - Calls NEAR AI (DeepSeek-V3.1) via `dao_vote` tool
   - Gets NEAR AI verification proof (ECDSA-signed attestation)
   - Writes `{vote, reasoning}` to `coordination/tasks/{workerDID}/result`
   - Sets `coordination/tasks/{workerDID}/status = "completed"`
8. Coordinator detects all snapshotted workers done (120s timeout, quorum-aware)
9. Coordinator reads all votes, tallies Approved vs Rejected
10. Calls `record_worker_submissions` on-chain (count check, not per-ID validation)
11. Calls `coordinator_resume` with ONLY `{approved, rejected, decision, workerCount}`
12. Contract validates count, resumes yield, stores finalized result

**Privacy guarantee:** Individual votes + reasoning stay in Ensue only.

**Permissionless participation:** Any agent can pay 0.1 NEAR to `register_worker(coordinatorDID, workerDID, endpointUrl, cvmId)` and begin receiving proposals without coordinator restart.

**Quorum configuration** (per-proposal override via `voting_config`):
```json
{ "type": "vote", "parameters": { "proposal": "...", "voting_config": { "min_workers": 2, "quorum": 2 } } }
```

---

## The Voting Flow — V2 (Blind Voting with FHE, additive)

V2 adds a confidential governance path using Zama fhEVM for high-stakes proposals.
V1 flow remains available for standard proposals.

**Double-Layer Security Model:**
1. **FHE layer** — Voter agents (in Phala TEE) cast ballots as `euint32` to `DeliberaVoting.sol`
2. **Aggregation** — `FHE.add()` accumulates encrypted votes on-chain. No plaintext visible.
3. **TEE finalization** — After deadline, Phala TEE calls `finalize()`, retrieves Lit threshold key, decrypts aggregate locally, calls `publishResult()` on-chain
4. **Settlement** — Final tally written to NEAR coordinator contract as usual

**Trigger condition for V2 path:** `task_config.voting_mode === "confidential"`

---

## V2 Memory Architecture (Tiered)

| Tier | System | Data | Lifetime |
|---|---|---|---|
| Hot | Ensue Memory Network | Real-time coordination state, CID pointers | Session |
| Warm | Storacha (UCAN-authorized) | **Agent persistent memory**: manifesto, preferences, decisions, knowledge | Persistent |
| Cold | Filecoin Onchain Cloud | Finalized deliberation records, Proof of Spacetime | Permanent |

**Key concept:** Storacha is the agent's **persistent memory**, not just a backup tier.
Each agent accumulates knowledge, preferences, and values over time. Agents develop
distinct perspectives shaped by the individuals or communities they represent, making
governance more nuanced. Memory is read at deliberation START and updated at END.
Humans with UCAN permissions can also inject knowledge into an agent's Storacha space.

**Sync rule:** When a deliberation cycle completes, Ensue knowledge tree MUST be serialized and backed up to Storacha. This is handled by the `ensue-backup` skill and triggered automatically every 50 agent turns.

---

## Worker Persistent Identity (Storacha-backed)

Each worker agent has a **persistent identity that is its memory** — not just an archive.
Agents accumulate knowledge, preferences, and values over time, developing distinct
perspectives shaped by the individuals or communities they represent. This makes
governance more nuanced and authentic.

**Core principle:** Storacha IS the agent's memory. It is read at the START of each
deliberation (informing AI reasoning) and updated at the END (capturing new learnings).
Humans with UCAN permissions over a worker's Storacha space can also feed knowledge
to agents between deliberations.

**Architecture:**
- `StorachaProfileClient` (`worker-agent/src/storacha/profile-client.ts`) — singleton, session-cached
- Storacha = PRIMARY persistent store (all profile data encrypted via Lit + Storacha)
- Ensue = CID pointers ONLY (`agent/{workerId}/manifesto_cid`, etc.) + real-time coordination state
- Per-worker Storacha spaces for isolation and sovereignty

**Per-worker Storacha spaces (provisioned):**
| Worker | Space Name | Space DID |
|--------|------------|-----------|
| worker1 | delibera-w1-new | `did:key:z6MktJXkKhgNhK1ZiecfG39zhRyn7e88jaijhSkUj5jyPKmc` |
| worker2 | delibera-worker2 | `did:key:z6Mkovsb6rneiFNKNvPyksvLjWxkg5mwfQ8jSK1zgPamVpnF` |
| worker3 | delibera-worker3 | `did:key:z6MknVJzCLxyk2M8XQitmfzdZv6KdeVHkFhaNvHZPieCfFHt` |

**Ensue keys (CID pointers only):**
```
agent/{workerId}/manifesto_cid      # CID → encrypted AgentManifesto in Storacha
agent/{workerId}/preferences_cid    # CID → encrypted AgentPreferences in Storacha
agent/{workerId}/decisions_cid      # CID → encrypted DecisionRecord[] in Storacha (last 20)
agent/{workerId}/knowledge_cid      # CID → encrypted string[] in Storacha (knowledge notes)
```

**Fallback:** When `STORACHA_AGENT_PRIVATE_KEY` is not set, falls back to `profiles.json` + in-memory decisions (LOCAL_MODE compatible).

**Migration:** Run `scripts/migrate-profiles-to-storacha.ts --worker workerN` with each worker's env to seed Storacha from `profiles.json`.

**Call flow:**
```
task-handler.ts → loadIdentity() → StorachaProfileClient.loadIdentity()
                                    ├── getManifesto()     → Ensue CID → retrieveAndDecrypt() → AgentManifesto
                                    ├── getPreferences()   → Ensue CID → retrieveAndDecrypt() → AgentPreferences
                                    ├── getRecentDecisions() → Ensue CID → retrieveAndDecrypt() → DecisionRecord[]
                                    └── getKnowledgeNotes()  → Ensue CID → retrieveAndDecrypt() → string[]
               → recordDecision() → StorachaProfileClient.saveDecision()
                                    ├── encryptAndVault(updated_decisions) → Storacha → CID
                                    └── ensue.updateMemory(`agent/{did}/decisions_cid`, cid)
```

**Human knowledge injection:** Anyone with UCAN delegation to a worker's space can upload
encrypted knowledge and update the CID pointer, feeding context to the agent.

---

## V2 Identity Model

**Current:** Agent identity = `did:key` (locally generated) + UCAN delegation for Storacha Space
**Old (removed):** ~~NOVA SDK with NEAR AccountID + Ed25519 signing key~~ — fully replaced

```bash
# Generate new agent identity
storacha key create
# → Private key: MgCZG7... (store in env, never commit)
# → Agent DID:   did:key:z6Mk...

# Create per-worker space + delegation (each worker gets its own space)
storacha space create delibera-worker{N}
storacha space provision --provider did:web:storacha.network
storacha delegation create <AGENT_DID> \
  --can 'space/blob/add' --can 'space/index/add' \
  --can 'upload/add' --can 'upload/list' \
  --can 'space/content/decrypt' \
  --base64
# → base64 string → STORACHA_DELEGATION_PROOF env var
```

**Authorization flow (V2):** Agent presents UCAN → Storacha validates capability chain → Lit ACC checked → threshold key released → local decryption. No on-chain lookup per interaction.

---

## V2 Privacy Model (Storacha + Lit)

All data written to Storacha MUST be encrypted with Lit Protocol before upload.

**Access Control Condition (ACC) template** — tied to NEAR contract state:
```json
{
  "contractAddress": "coordinator.agents-coordinator.testnet",
  "standardContractType": "NEAR",
  "chain": "near",
  "method": "is_group_member",
  "parameters": [":deliberationGroupId", ":userAddress"],
  "returnValueTest": { "comparator": "=", "value": "true" }
}
```

Use the `storacha-vault` skill (`/skill storacha-vault`) for all encrypt+upload operations.

---

## Ensue Memory Layout (DID-keyed, Model A)

```
coordination/
  tasks/
    did:key:z6Mk.../          ← worker sovereign DID (not worker1/2/3)
      status       "idle"|"pending"|"processing"|"completed"|"failed"
      result       {workerId: "did:key:...", vote, reasoning, computedAt, processingTime}
      timestamp    unix ms
      error        null | "error message"
      verification_proof  {chat_id, signature, signing_address}
    did:key:z6Mk.../...       ← second worker
  coordinator/
    status         "idle"|"monitoring"|"recording_submissions"|"aggregating"|"resuming"|"completed"
    tally          {approved, rejected, decision, workerCount, workers, workerNames, timestamp, proposalId}
    proposal_id    N
    worker_snapshot_{N}       ← JSON array of worker DIDs snapshotted at vote start
  config/
    task_definition  {"type":"vote","parameters":{"proposal":"...","voting_config":{"min_workers":2,"quorum":2}}}
agent/
  did:key:z6Mk.../
    display_name   "Alice's Voter"          ← human-readable name (public, unencrypted)
    manifesto_cid  bafy...                  ← CID → encrypted AgentManifesto in Storacha
    preferences_cid  bafy...                ← CID → encrypted AgentPreferences in Storacha
    decisions_cid  bafy...                  ← CID → encrypted DecisionRecord[] in Storacha
    knowledge_cid  bafy...                  ← CID → encrypted string[] in Storacha
proposals/
  {N}/
    config       task_definition JSON
    tally        TallyResult JSON
    status       "completed"
    workers/
      did:key:z6Mk.../
        result   WorkerResult JSON
        timestamp ISO string
proposal_index   JSON array of proposal IDs ["1","2",...]
```

---

## Ensue API (JSON-RPC 2.0 over SSE) — unchanged

- Endpoint: `POST https://api.ensue-network.ai/`
- Auth: `Bearer {ENSUE_API_KEY}` header
- Response: `data: {"jsonrpc":"2.0","id":N,"result":{"content":[...],"structuredContent":{...}}}`
- Read: use `structuredContent.results[].value` (NOT `.memories`)
- `list_keys` uses `structuredContent.keys[]`
- JSON-RPC errors at `parsed.error` (top level), NOT `result.isError`
- `update_memory` returns error if key doesn't exist — catch and fallback to `create_memory`

---

## NEAR AI Integration — unchanged

- API: `https://cloud-api.near.ai/v1` (OpenAI-compatible)
- Auth: `Authorization: Bearer {NEAR_API_KEY}`
- Model: `deepseek-ai/DeepSeek-V3.1`
- Tool call: `tool_choice: {type:"function", function:{name:"dao_vote"}}`
- Tool schema: `dao_vote({vote: "Approved"|"Rejected", reasoning: string})`
- Verification proof: `GET /v1/signature/{chat_id}?model={model_id}&signing_algo=ecdsa`
  - Returns `{text, signature, signing_address}` — verified with `ethers.verifyMessage(text, signature)`

---

## Smart Contract Patterns (near-sdk 5.7.0) — unchanged

```rust
#[near(contract_state)]          // NOT #[near_bindgen]
#[near]                          // NOT #[near_bindgen]
#[near(serializers = [json, borsh])]
use near_sdk::store::{IterableMap, IterableSet};
Gas::from_tgas(50)
#[callback_result] response: Result<T, PromiseError>
env::read_register(YIELD_REGISTER).try_into()  // for yield ID
```

**BorshStorageKey — CRITICAL:** Ordinals are fixed by position. Never reorder variants. Add `_Deprecated` placeholders to burn old ordinals. Current V3 storage keys:
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

## Building the NEAR Contract (WASM) — unchanged

```bash
PATH="$HOME/.rustup/toolchains/nightly-2025-01-07-.../bin:$HOME/.cargo/bin:/usr/bin:$PATH"

RUSTFLAGS='-C link-arg=-s -C target-cpu=mvp -C target-feature=-bulk-memory,-sign-ext,-multivalue,-reference-types' \
cargo build --target wasm32-unknown-unknown --release \
  -Z build-std=std,panic_abort -Z build-std-features=panic_immediate_abort

wasm-opt -Oz input.wasm -o output.wasm
wasm-tools validate --features=mvp,mutable-global output.wasm
```

Notes: `-C target-cpu=mvp` alone is NOT enough. Use `-Z build-std` to rebuild stdlib. near-sdk 5.17+ requires Rust >=1.85.

---

## Phala TEE Deployment — unchanged

- Deploy route: `POST /api/deploy`
- Provision: `POST /api/v1/cvms/provision` → returns `compose_hash`
- Auth: `x-api-key` header
- Endpoint URL delay: 3–10+ minutes after provision
- `deployCvm()` does 3×5s quick poll; returns `status:'deploying'` if not ready
- `watchForEndpoint()`: background watcher (40×15s = 10min)
- Free tier: $400 credits, $0.06/vCPU/hour

**V2 Phala role shift:** TEE is the sole authorized caller of `DeliberaVoting.finalize()` and `publishResult()`. `PHALA_TEE_ADDRESS` env var must match the address in the deployed Zama contract constructor.

---

## TypeScript dotenv Pattern — unchanged

```typescript
// CORRECT — preload via tsx flag:
// package.json: "dev": "DOTENV_CONFIG_PATH=.env.development.local tsx -r dotenv/config src/index.ts"
// WRONG — import hoisting breaks env loading before dotenv runs
```

---

## Registry Contract (Permissionless, Model A)

- Deployed: `registry.agents-coordinator.testnet`
- Methods: `register_coordinator`, `register_worker` (both require **0.1 NEAR** deposit)
- New structs: `WorkerRecord { account_id, coordinator_did, worker_did, endpoint_url, cvm_id, registered_at, is_active }`, `CoordinatorRecord`
- View methods: `get_workers_for_coordinator(coordinator_did)`, `get_worker_by_did(worker_did)`, `get_coordinator_by_did(coordinator_did)`
- Storage keys: ordinals 0-3 deprecated, ordinal 4=`WorkersByDid`, ordinal 5=`CoordinatorsByDid`
- Workers self-register on startup via `ensureRegistered()` in `task-handler.ts`
- Coordinator self-registers on startup via `ensureCoordinatorRegistered()` in `index.ts`

---

## Custom Skills (V2)

Skills live in `.claude/skills/`. Invoke with `/skill <name>`.

| Skill | Trigger | What it does |
|---|---|---|
| `storacha-vault` | "Securely persist agent memory" | Encrypt with Lit ACCs + upload to Storacha |
| `zama-blind-voting` | "Implement confidential governance" | Scaffold `DeliberaVoting.sol` fhEVM contract |
| `filecoin-archive` | "Archive to Filecoin" | Pin CID to Filecoin Onchain Cloud |
| `flow-vrf` | "Select jury" / "Fair leader election" | Flow VRF → Fisher-Yates jury selection |
| `ensue-backup` | "Back up agent memory" | Serialize Ensue tree → encrypt → Storacha |

---

## One-Click Worker Buy Flow (V2.5)

The `/buy` page provides a zero-config worker deployment flow:

**Frontend screens:** Entry → Config → Provisioning → AwaitingSignature → Success | Error

**Backend:** `protocol-api/src/routes/provision.ts` — 3 endpoints:
- `POST /api/provision/worker` — Start provisioning (generates identity, deploys to Phala)
- `GET /api/provision/status/:jobId` — Poll progress (frontend polls every 5s)
- `POST /api/provision/register` — Mark complete after wallet sign

**Flow:**
1. User connects NEAR wallet, enters worker name, selects coordinator
2. Backend generates ed25519 keypair via `@ucanto/principal`, derives `did:key`
3. Backend creates per-worker UCAN delegation from coordinator's Storacha space → worker DID
4. Backend deploys Phala CVM with all env vars (worker key, delegation, Ensue creds, etc.)
5. Backend polls for endpoint URL (up to 15 min via `watchForEndpoint()`)
6. Frontend shows progress, then prompts user to sign `register_worker` tx (0.1 NEAR)
7. User signs via `@hot-labs/near-connect` wallet
8. Success screen shows DID + endpoint + recovery file download

**Storacha isolation:** Each worker gets a unique UCAN delegation scoped to the coordinator's space. Creating separate spaces programmatically requires email auth (not suitable for automation), so sub-delegation provides identity-level isolation. Ensue keys are namespaced by worker DID.

**Docker image:** `leomanza/delibera-worker:latest` (DockerHub, NOT ghcr.io)

**Recovery file:** `worker-recovery.json` contains workerDid, storachaPrivateKey, phalaEndpoint, etc.

**localStorage persistence:** `delibera_provision_job_id` survives tab close for resumption.

---

## Human-Readable Worker Names (V2.5)

Display names are mutable labels stored in Ensue at `agent/{did}/display_name`.
They are public metadata (not encrypted) — anyone can read, only the owner can write.

**NameResolver** (`shared/src/name-resolver.ts`):
- Cache-first resolution: Ensue → truncated DID fallback
- Used in coordinator's `aggregateResults()` to include names in tally
- Used in `/api/coordinate/workers` endpoint to include `display_name` per worker

**Setting names:**
- One-click flow: Set automatically via `WORKER_DISPLAY_NAME` env var on worker init
- API: `PATCH /api/coordinate/workers/:did/name` with `{ name: "..." }`
- Frontend: `setWorkerDisplayName(did, name)` in `api.ts`

**Display:** Worker cards show name prominently, truncated DID as secondary info.

---

## Common Gotchas — V1 (still applies)

1. **Yield timeout** — ~200 blocks. On testnet blocks are ~0.5s so real timeout is **~100s, NOT 200s**. `localStartCoordination` fires the tx in the background and polls for the proposal ID (takes ~4s). Do NOT add sleeps/waits that eat into this budget.
2. **Callback param names** — Must EXACTLY match JSON keys. `_task_config` ≠ `task_config`.
3. **Worker polling loop** — In production, `triggerWorkers()` only writes `STATUS='pending'`. Workers must run `startWorkerPollingLoop()`.
4. **promise_yield_resume** — Returns `bool` (true=matched, false=expired). Check the return.
5. **near-cli-rs TTY** — Requires TTY for seed phrase. Use near-api-js scripts for automation.
6. **NEAR RPC** — Use `https://test.rpc.fastnear.com`. Old `rpc.testnet.near.org` is rate-limited.
7. **Coordinator contract** — `coordinator_resume` requires TEE-registered coordinator with approved codehash. Bypassed in LOCAL_MODE.

## Common Gotchas — V2 (new)

8. **NOVA SDK is fully replaced** — All Nova imports removed from worker-agent (task-handler, index, knowledge routes) and frontend (all pages, components, deploy form, api.ts). `src/nova/` files are dead code (safe to delete). The replacement is `src/storacha/agent-identity.ts` which uses `did:key` identity from `@storacha/client`. **Do not re-introduce any Nova references** — check all layers (backend + frontend) when making identity changes.
9. **Storacha upload = plaintext by default** — Always use `@storacha/encrypt-upload-client` with Lit. Never call `client.uploadFile()` directly for sensitive data.
10. **UCAN delegation scope** — Generate separate delegations per agent role. The coordinator gets `upload/list`; workers get only `space/blob/add` + `upload/add`.
11. **Lit threshold network** — SDK v8+ renamed networks: `datil`→`naga`, `datil-dev`→`naga-dev`. Use `naga` for production, `naga-dev` for testing (FREE, no relay key needed). New packages: `@lit-protocol/lit-client`, `@lit-protocol/auth`, `@lit-protocol/networks`, `@lit-protocol/access-control-conditions` + `viem` peer dep. ACC chain must be `near`, not `ethereum`.
12. **Zama fhEVM** — `FHE.allowThis()` must be called before `FHE.allow(encryptedTally, phalaTEEAddress)`. Order matters.
13. **Flow VRF seed** — The VRF seed is a `UFix64` string. Strip the decimal before using as an integer seed for shuffles.
14. **Filecoin deal activation** — Deals take minutes to activate. Log the deal ID immediately; verify status asynchronously.
15. **Ensue backup trigger** — The `ensue-backup` skill must run at deliberation cycle end AND every 50 turns. Configure both triggers in `.claude.json` plugin config.
16. **@storacha/client is ESM-only** — This project uses `"type": "commonjs"` and `"module": "commonjs"` in tsconfig. Plain `await import('...')` gets compiled by `tsc` to `require('...')`, which fails at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED` for ESM-only packages. **Fix:** Use `const dynamicImport = new Function('specifier', 'return import(specifier)')` then call `await dynamicImport('...')`. This prevents `tsc` from transforming the import. Applied to all files importing ESM-only packages: `@storacha/client`, `@storacha/encrypt-upload-client`, `@lit-protocol/*`, `@ucanto/principal`, `multiformats`, `viem`. See `worker-agent/src/storacha/identity.ts` for the canonical pattern.
17. **MCP storage server build** — `mcp-storage-server/` has TypeScript errors in its `test/` directory. The default `npm run build` includes tests and fails. **Fix:** Use `tsconfig.build.json` (already created) which excludes `test/`. Build with `npx tsc -p tsconfig.build.json`.
18. **Storacha test scripts must be .mjs** — Because `@storacha/client` is ESM-only, standalone test scripts that directly import it must use `.mjs` extension (or live in an ESM package). CJS `.ts` files can only access Storacha through the dynamic `import()` wrapper in `identity.ts`.
19. **taskConfig double-stringify** — The `/api/coordinate/trigger` route receives `taskConfig` as either a string (curl) or object (frontend). `coordinate.ts` normalizes with `typeof taskConfig === 'string' ? taskConfig : JSON.stringify(taskConfig)`. The worker polling loop in `task-handler.ts` also has a defensive guard: `if (typeof taskConfig === 'string') taskConfig = JSON.parse(taskConfig)`. Without both guards, workers execute the `default` random task instead of the vote task (because `config.type` is undefined on a string).
20. **localStartCoordination timing** — `start_coordination` creates a yielded promise that blocks for ~200 blocks. The function fires the tx in the background (don't await) and polls `get_current_proposal_id` every 500ms for up to 8s to detect the new proposal. Never add `await` on the `contractCall` or add sleeps — the previous 15s+5s approach wasted ~40 blocks and caused proposals to time out before `coordinator_resume` could be called.
21. **Testnet block timing** — NEAR testnet blocks average ~0.5s, NOT 1s. The 200-block yield timeout is ~100 seconds real time. AI voting takes ~25-80s depending on NEAR AI load. The total pipeline (proposal creation + voting + tally + resume) must complete within this window.
22. **Frontend Nova→Storacha migration** — All Nova SDK references were removed from the frontend (8 files, 43 references). When changing identity/storage systems, always check BOTH backend AND frontend — labels, badges, form fields, deploy payloads, API types, log messages, footers, and flow diagrams all need updating.
23. **Worker profile persistence** — `StorachaProfileClient` uses the worker's **DID** (`did:key:z6Mk...`) as the Ensue key prefix, NOT the legacy `WORKER_ID` (`worker1`/`worker2`/`worker3`). **Storacha is the PRIMARY persistent store** — read order is: Storacha → Ensue cache → empty (blank identity for new workers). Ensue is a write-through cache for fast reads. `profiles.json` is NOT used — freshly deployed workers start with a blank identity that the owner fills in via the app. The `saveManifesto()` and `savePreferences()` methods persist to Storacha first, then cache to Ensue.
24. **Worker vault.ts** — Both coordinator and worker have their own `vault.ts` files (ported, not shared). Each uses per-worker `appName` and `storagePath` for Lit auth storage to avoid conflicts when running multiple workers on the same machine.
25. **Provisioning API in protocol-api** — The one-click worker provisioning routes live in `protocol-api/src/routes/provision.ts` (NOT coordinator-agent). This is because the Phala deploy logic (`deployCvm`, `watchForEndpoint`) already lives in `protocol-api/src/phala/phala-client.ts`. The provisioning flow generates keys server-side via `@ucanto/principal/ed25519` (dynamic import for ESM). **Docker image:** `leomanza/delibera-worker:latest` — NOT `ghcr.io/delibera-ai/worker-agent:latest` which doesn't exist. **Storacha:** Per-worker UCAN delegation is created programmatically from the coordinator's space (can't create spaces without email auth). Protocol-api env MUST have `STORACHA_AGENT_PRIVATE_KEY` and `STORACHA_DELEGATION_PROOF` (coordinator's credentials).
26. **Display names in Ensue** — Worker display names are stored in Ensue at `agent/{did}/display_name` (NOT in Storacha). This was chosen because Storacha gateway retrieval is unreliable (documented in FIXES.md), and display names are public metadata that don't need encryption. The `NameResolver` in `shared/src/name-resolver.ts` provides cache-first resolution.
