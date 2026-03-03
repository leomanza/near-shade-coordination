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

## Running Locally (V1 — still works)

```bash
./run-dev.sh   # coordinator :3000, workers :3001-3003, frontend :3004

# Trigger a vote:
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":"{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Fund a developer education program\"}}"}'

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
NEAR_API_KEY=...
WORKERS=worker1:3001,worker2:3002,worker3:3003
PINGPAY_API_KEY=...
PINGPAY_API_URL=https://pay.pingpay.io/api
PINGPAY_WEBHOOK_SECRET=...
# Production (Shade Agent / Phala):
AGENT_CONTRACT_ID=coordinator.agents-coordinator.testnet
SPONSOR_ACCOUNT_ID=agents-coordinator.testnet
SPONSOR_PRIVATE_KEY=...
# [V2] Storacha
STORACHA_AGENT_PRIVATE_KEY=...         # from: storacha key create
STORACHA_DELEGATION_PROOF=...          # from: storacha delegation create <DID> --base64
STORACHA_SPACE_DID=...                 # (optional) from: storacha space create
# [V2] Lit Protocol
LIT_RELAY_API_KEY=...
LIT_NETWORK=datil
# [V2] Filecoin
FILECOIN_ONCHAIN_API_KEY=...
```

### worker-agent/.env.worker1.local
```
WORKER_ID=worker1
PORT=3001
NEAR_NETWORK=testnet
ENSUE_API_KEY=...
ENSUE_TOKEN=...
NEAR_API_KEY=...
# Storacha worker identity (unique key + delegation per worker instance)
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
| Registry check | Skipped | Required |

**Critical (Phala/non-LOCAL_MODE):** Workers MUST poll Ensue (`workerKeys.STATUS`) every 3s via `startWorkerPollingLoop()`. Coordinator only writes `STATUS='pending'` — it does NOT HTTP-call workers.

---

## The Voting Flow — V1 (End-to-End, unchanged)

1. User calls `start_coordination(task_config)` on NEAR contract
2. Contract creates a **yielded promise** (~200 block timeout)
3. Coordinator polls contract every 5s for `Created` proposals
4. Coordinator writes task config to Ensue (`coordination/config/task_definition`)
5. Coordinator sets worker status keys to `pending`
6. Each worker independently:
   - Fetches DAO manifesto from contract (RPC view call)
   - Calls NEAR AI (DeepSeek-V3.1) via `dao_vote` tool
   - Gets NEAR AI verification proof (ECDSA-signed attestation)
   - Writes `{vote, reasoning}` to `coordination/tasks/workerN/result`
   - Sets `coordination/tasks/workerN/status = "completed"`
7. Coordinator detects all workers done (120s timeout)
8. Coordinator reads all votes, tallies Approved vs Rejected
9. Calls `record_worker_submissions` on-chain (nullifier hashes)
10. Calls `coordinator_resume` with ONLY `{approved, rejected, decision, workerCount}`
11. Contract validates hashes, resumes yield, stores finalized result

**Privacy guarantee:** Individual votes + reasoning stay in Ensue only.

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
| Hot | Ensue Memory Network | Real-time task state, agent working memory | Session |
| Warm | Storacha (UCAN-authorized) | Session summaries, agent preferences, encrypted transcripts | Persistent |
| Cold | Filecoin Onchain Cloud | Finalized deliberation records, Proof of Spacetime | Permanent |

**Sync rule:** When a deliberation cycle completes, Ensue knowledge tree MUST be serialized and backed up to Storacha. This is handled by the `ensue-backup` skill and triggered automatically every 50 agent turns.

---

## Worker Persistent Identity (Storacha-backed)

Each worker agent has a persistent identity that accumulates across restarts:

**Architecture:**
- `StorachaProfileClient` (`worker-agent/src/storacha/profile-client.ts`) — singleton, session-cached
- Profile data (manifesto, weights) sourced from `config/profiles.json` seed file
- Decision history persisted to **Ensue** (`agent/{workerId}/decisions`) as primary store
- Encrypted backup to **Storacha** via `vault.ts` on each vote (returns CID)
- Knowledge notes stored in Ensue (`agent/{workerId}/knowledge`)

**Ensue keys for persistent identity:**
```
agent/{workerId}/manifesto          # AgentManifesto JSON
agent/{workerId}/preferences        # AgentPreferences JSON (voting weights)
agent/{workerId}/decisions          # DecisionRecord[] JSON (last 20)
agent/{workerId}/knowledge          # string[] JSON (knowledge notes)
agent/{workerId}/storacha/decisions_cid   # CID of latest encrypted Storacha backup
agent/{workerId}/storacha/knowledge_cid   # CID of latest encrypted Storacha backup
```

**Fallback:** When `STORACHA_AGENT_PRIVATE_KEY` is not set, falls back to `profiles.json` + in-memory decisions (LOCAL_MODE compatible).

**Migration:** Run `scripts/migrate-profiles-to-storacha.ts --worker workerN` with each worker's env to seed Ensue + Storacha from `profiles.json`.

**Call flow:**
```
task-handler.ts → loadIdentity() → StorachaProfileClient.loadIdentity()
                                    ├── getManifesto()  → profiles.json seed (cached)
                                    ├── getPreferences() → profiles.json seed (cached)
                                    └── getRecentDecisions() → Ensue key (cached)
               → recordDecision() → StorachaProfileClient.saveDecision()
                                    ├── Ensue write (primary)
                                    └── encryptAndVault() → Storacha (backup)
```

---

## V2 Identity Model

**Current:** Agent identity = `did:key` (locally generated) + UCAN delegation for Storacha Space
**Old (removed):** ~~NOVA SDK with NEAR AccountID + Ed25519 signing key~~ — fully replaced

```bash
# Generate new agent identity
storacha key create
# → Private key: MgCZG7... (store in env, never commit)
# → Agent DID:   did:key:z6Mk...

# Create space and delegation
storacha space create delibera-v2-main
storacha delegation create <AGENT_DID> \
  --can 'space/blob/add' --can 'space/index/add' \
  --can 'upload/add' --can 'upload/list' \
  -o delegation.car
base64 delegation.car  # → DELIBERA_UCAN_DELEGATION_BASE64
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

## Ensue Memory Layout (unchanged from V1)

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

## Registry Contract — unchanged

- Deployed: `registry.agents-coordinator.testnet`
- Methods: `register_coordinator`, `register_worker` (both require 0.7 NEAR deposit)
- Storage keys: ordinal 0 = Coordinators, ordinal 1 = Workers

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
16. **@storacha/client is ESM-only** — This project uses `"type": "commonjs"`. Static imports of `@storacha/client` (or its subpath exports like `./stores/memory`, `./principal/ed25519`, `./proof`) will fail at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED` because the package only has `import` conditions in its exports map. **Fix:** Use dynamic `import()` inside async functions with lazy caching. See `coordinator-agent/src/storacha/identity.ts` for the canonical pattern. This same pattern will be required for `@storacha/encrypt-upload-client` and any other ESM-only Storacha/Lit packages.
17. **MCP storage server build** — `mcp-storage-server/` has TypeScript errors in its `test/` directory. The default `npm run build` includes tests and fails. **Fix:** Use `tsconfig.build.json` (already created) which excludes `test/`. Build with `npx tsc -p tsconfig.build.json`.
18. **Storacha test scripts must be .mjs** — Because `@storacha/client` is ESM-only, standalone test scripts that directly import it must use `.mjs` extension (or live in an ESM package). CJS `.ts` files can only access Storacha through the dynamic `import()` wrapper in `identity.ts`.
19. **taskConfig double-stringify** — The `/api/coordinate/trigger` route receives `taskConfig` as either a string (curl) or object (frontend). `coordinate.ts` normalizes with `typeof taskConfig === 'string' ? taskConfig : JSON.stringify(taskConfig)`. The worker polling loop in `task-handler.ts` also has a defensive guard: `if (typeof taskConfig === 'string') taskConfig = JSON.parse(taskConfig)`. Without both guards, workers execute the `default` random task instead of the vote task (because `config.type` is undefined on a string).
20. **localStartCoordination timing** — `start_coordination` creates a yielded promise that blocks for ~200 blocks. The function fires the tx in the background (don't await) and polls `get_current_proposal_id` every 500ms for up to 8s to detect the new proposal. Never add `await` on the `contractCall` or add sleeps — the previous 15s+5s approach wasted ~40 blocks and caused proposals to time out before `coordinator_resume` could be called.
21. **Testnet block timing** — NEAR testnet blocks average ~0.5s, NOT 1s. The 200-block yield timeout is ~100 seconds real time. AI voting takes ~25-80s depending on NEAR AI load. The total pipeline (proposal creation + voting + tally + resume) must complete within this window.
22. **Frontend Nova→Storacha migration** — All Nova SDK references were removed from the frontend (8 files, 43 references). When changing identity/storage systems, always check BOTH backend AND frontend — labels, badges, form fields, deploy payloads, API types, log messages, footers, and flow diagrams all need updating.
23. **Worker profile persistence** — `StorachaProfileClient` uses Ensue as primary persistence and Storacha as encrypted backup. Decision history is stored in `agent/{workerId}/decisions` Ensue key. The client is a singleton with session-level caching. `config/profiles.json` is a seed file — it is only read as fallback when Storacha is not configured (LOCAL_MODE). After migration, runtime reads go to Ensue.
24. **Worker vault.ts** — Both coordinator and worker have their own `vault.ts` files (ported, not shared). Each uses per-worker `appName` and `storagePath` for Lit auth storage to avoid conflicts when running multiple workers on the same machine.
