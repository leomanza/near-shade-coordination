# Architecture Guide

## The Simple Version (ELI5)

Three AI agents (Voter Agents) each independently read a DAO manifesto and a proposal, then vote Approved or Rejected with their reasoning. They write their votes to a private shared whiteboard (Ensue Memory Network) that only they and a teacher (Coordinator Agent) can see.

The teacher reads all three votes, counts the Approved vs Rejected, and records **only the final tally** in the official record book (NEAR Smart Contract). The individual votes and reasoning never appear in the record book — they stay private on the whiteboard.

Anyone can look at the record book to see "3 Approved, 0 Rejected — Decision: Approved", but nobody can see which agent voted which way or why.

## Technical Overview

The system implements a **privacy-preserving multi-agent voting protocol** with multiple layers:

- **Settlement layer (NEAR blockchain)** — A Rust smart contract using NEAR's [yield/resume](https://docs.near.org/ai/shade-agents/tutorials/ai-dao/overview) pattern. When a proposal is submitted, the contract creates a yielded promise that suspends execution until an off-chain coordinator provides the aggregated result. The contract enforces integrity via SHA256 hash verification of both the task configuration and the aggregated result, and prevents double-voting through a nullifier pattern (one submission hash per worker per proposal). Only TEE-registered coordinators with owner-approved codehashes can settle results.

- **Coordination layer (Ensue Memory Network)** — An off-chain, permissioned key-value store accessed via JSON-RPC 2.0 over SSE. Agents read and write to hierarchical namespaces (`coordination/tasks/workerN/*`). Ensue provides the asynchronous communication channel between TEE-isolated agents that cannot directly communicate. Individual votes, AI reasoning, and processing metadata live exclusively in this layer — they never reach the blockchain. Access is controlled by API key scoping and namespace-level permissions.

- **Computation layer (AI Voter Agents)** — Three independent TypeScript agents, each running in a Phala TEE (Intel TDX). Each agent fetches the DAO manifesto from the contract via NEAR RPC, then calls the NEAR AI API (DeepSeek-V3.1 with OpenAI-compatible function calling) to deliberate on the proposal. The AI returns a structured `{vote, reasoning}` response via a forced `dao_vote` tool call. Votes are written to each agent's private Ensue namespace. The coordinator reads all votes, computes an aggregate tally, records nullifier hashes on-chain, and resumes the contract with only `{approved, rejected, decision, workerCount}`.

- **Encrypted persistence layer (Storacha + Lit Protocol)** — All sensitive deliberation data is encrypted with Lit Protocol threshold keys before being uploaded to Storacha for persistent, content-addressed storage. Access Control Conditions (ACCs) tied to NEAR contract state determine who can decrypt. Storacha automatically creates Filecoin storage deals for permanent archival.

- **Confidential voting layer (Zama fhEVM)** — For high-stakes proposals, votes are cast as Fully Homomorphic Encrypted (FHE) values on a Zama fhEVM chain. `FHE.add()` accumulates encrypted votes on-chain — no plaintext is ever visible. After the deadline, a Phala TEE finalizes and decrypts the aggregate.

- **Verifiable randomness layer (Flow VRF)** — Fair jury selection uses Flow blockchain's built-in VRF (`revertibleRandom`) to generate verifiable random seeds. A deterministic Fisher-Yates shuffle selects jurors from a candidate pool, and the same seed always produces the same jury for auditability.

**Key design properties:**
- **Ballot privacy** — Individual votes are never on-chain; only the aggregate tally is settled
- **Tamper resistance** — SHA256 hashes verify config and result integrity end-to-end
- **Double-vote prevention** — On-chain nullifier ensures each worker submits exactly once per proposal
- **Verifiable execution** — TEE attestation (DCAP) ensures only approved code can settle results
- **Asynchronous coordination** — Ensue decouples agents that can't directly communicate in TEE isolation
- **Encrypted persistence** — All deliberation data is encrypted at rest with threshold keys
- **Permanent archival** — Finalized records are archived to Filecoin via Storacha's automatic deal pipeline
- **Verifiable fairness** — Flow VRF provides cryptographic proof of fair jury selection

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
                 │  - Backs up to Storacha       │
                 │  - Archives to Filecoin       │
                 └───┬──────────┬──────────┬────┘
                read │    read  │    read  │
                 ┌───┴──────────┴──────────┴────┐
                 │                               │
                 │   Ensue Shared Memory (Hot)   │
                 │   (off-chain, permissioned)   │
                 │                               │
                 └───┬──────────┬──────────┬────┘
               write │    write │    write │
              ┌──────┴┐  ┌─────┴──┐  ┌────┴─────┐
              │Voter 1│  │Voter 2 │  │Voter 3   │
              │(:3001)│  │(:3002) │  │(:3003)   │
              │  AI   │  │  AI    │  │  AI      │
              │did:key│  │did:key │  │did:key   │
              └───────┘  └────────┘  └──────────┘

       ┌──────────────────────────────────────────────┐
       │      Storacha (Warm — Persistent Storage)    │
       │   - Encrypted with Lit threshold keys        │
       │   - UCAN-authorized per-agent access         │
       │   - Content-addressed (CID)                  │
       │   - Auto Filecoin deals (Cold archival)      │
       └──────────────────────────────────────────────┘

       ┌──────────────────────────────────────────────┐
       │     Zama fhEVM (Confidential Voting)         │
       │   - FHE-encrypted ballots (euint32)          │
       │   - Homomorphic tally (no plaintext)         │
       │   - TEE-only finalization                    │
       └──────────────────────────────────────────────┘

       ┌──────────────────────────────────────────────┐
       │     Flow VRF (Verifiable Randomness)         │
       │   - revertibleRandom from Flow beacon        │
       │   - Deterministic Fisher-Yates shuffle       │
       │   - Fair jury selection with proof            │
       └──────────────────────────────────────────────┘
```

### The Flow (Standard Voting — V1)

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
12. **Backup step**: Coordinator encrypts the deliberation transcript with Lit Protocol, uploads to Storacha, and archives to Filecoin

### The Flow (Confidential Voting — V2)

For high-stakes proposals (`voting_mode: "confidential"`):

1. Coordinator creates a proposal on `DeliberaVoting.sol` (Zama fhEVM)
2. Each voter agent (inside Phala TEE) casts an FHE-encrypted ballot via `castVote()`
3. `FHE.add()` accumulates encrypted votes on-chain — no plaintext visible
4. After the deadline, the Phala TEE calls `finalize()` and `publishResult()`
5. The decrypted aggregate is written back to the NEAR coordinator contract

### Jury Selection (Flow VRF)

For proposals requiring a subset of voters:

1. Coordinator calls `POST /api/coordinate/select-jury` with a candidate pool
2. Flow VRF provides a verifiable random seed via `revertibleRandom<UInt64>()`
3. Fisher-Yates shuffle (seeded by VRF output) selects the jury
4. The VRF seed and proof are recorded for auditability
5. Same seed always produces the same jury (deterministic, verifiable)

---

## Tiered Storage Architecture

| Tier | System | Data | Lifetime | Encryption |
|------|--------|------|----------|------------|
| Hot | Ensue Memory Network | Real-time task state, agent working memory | Session | Permissioned access |
| Warm | Storacha (UCAN-authorized) | Session summaries, encrypted transcripts | Persistent | Lit threshold encryption |
| Cold | Filecoin (Proof of Spacetime) | Finalized deliberation records | Permanent | Inherited from Storacha |

**Sync rules:**
- After each deliberation cycle, Ensue tree is serialized and backed up to Storacha
- Storacha CIDs are archived to Filecoin via IPNI verification + gateway confirmation
- Archival records are logged to Ensue under `coordination/archival/{proposalId}`

---

## Component Deep Dive

### 1. NEAR Smart Contract (Settlement Layer)

**File:** `coordinator-contract/src/lib.rs`
**Deployed at:** `coordinator.agents-coordinator.testnet`

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

### 2. Ensue Shared Memory (Hot Coordination Layer)

**What it is:** A permissioned, off-chain key-value memory network with a JSON-RPC 2.0 API over Server-Sent Events (SSE).

**Why we use it:** Agents running in TEEs can't directly communicate with each other. Ensue provides a shared memory space where they read/write data asynchronously, coordinated by hierarchical key namespaces.

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
  archival/
    {proposalId}   {"cid":"bafy...","dealReference":"fil-...","archivedAt":"..."}
```

**Production permission scoping:**

| Agent | Access | Namespace |
|-------|--------|-----------|
| Voter 1 | write | `coordination/tasks/worker1/*` |
| Voter 2 | write | `coordination/tasks/worker2/*` |
| Voter 3 | write | `coordination/tasks/worker3/*` |
| Coordinator | read | `coordination/tasks/*` (all voters) |
| Coordinator | write | `coordination/coordinator/*` |
| Frontend | read | `coordination/*` (display only) |

### 3. Storacha (Warm Persistence Layer)

**What it is:** Decentralized, content-addressed storage with UCAN authorization and automatic Filecoin deals.

**Why we use it:** Ensue is session-scoped hot memory. Storacha provides persistent, encrypted storage for deliberation transcripts, agent preferences, and session summaries that survive across sessions.

**Identity model:** Each agent has a `did:key` identity derived from an Ed25519 private key. UCAN delegations grant capabilities (upload, list, decrypt) scoped per agent role.

**Encryption:** All sensitive data is encrypted with Lit Protocol threshold keys before upload. Access Control Conditions (ACCs) tied to NEAR contract state determine who can decrypt.

**Implementation files:**
- `coordinator-agent/src/storacha/identity.ts` — Coordinator Storacha client
- `coordinator-agent/src/storacha/vault.ts` — Encrypt + upload with Lit ACCs
- `coordinator-agent/src/storacha/ensue-backup.ts` — Serialize Ensue tree to Storacha
- `worker-agent/src/storacha/identity.ts` — Worker Storacha client
- `worker-agent/src/storacha/agent-identity.ts` — Agent identity (profiles, decisions)

### 4. Filecoin (Cold Archival Layer)

**What it is:** Permanent storage with cryptographic Proof of Spacetime guarantees.

**Why we use it:** Storacha automatically creates Filecoin deals for all uploaded content. The archiver confirms this pipeline is working and creates verifiable records for the NEAR ledger.

**Flow:**
1. Confirm CID exists in Storacha space
2. Query IPNI (cid.contact) to verify content is indexed across Filecoin infrastructure
3. Verify retrieval via w3s.link gateway
4. Generate deterministic deal reference (SHA256 of CID + provider IDs)
5. Log archival record to Ensue

**Implementation:** `coordinator-agent/src/filecoin/archiver.ts`

### 5. Zama fhEVM (Confidential Voting)

**What it is:** Fully Homomorphic Encryption on EVM — allows computation on encrypted data without decryption.

**Contract:** `contracts/voting/DeliberaVoting.sol`

**How it works:**
- Voters cast ballots as `euint32` (encrypted 32-bit integers): 1 = Approved, 0 = Rejected
- `FHE.add()` accumulates the encrypted tally on-chain
- Nobody (not even the contract owner) can see individual votes or the running tally
- After the deadline, only the authorized TEE address can call `finalize()` + `publishResult()`
- The TEE decrypts the aggregate locally and publishes the plaintext result

### 6. Flow VRF (Verifiable Randomness)

**What it is:** Verifiable Random Function backed by Flow blockchain's distributed randomness beacon.

**Implementation:** `coordinator-agent/src/vrf/flow-vrf.ts` + `jury-selector.ts`

**How it works:**
1. Query Flow testnet for `revertibleRandom<UInt64>()` — a VRF-backed random seed
2. Use the seed to initialize a deterministic LCG PRNG
3. Fisher-Yates shuffle the candidate pool
4. Select the first N candidates as the jury
5. Record the seed and proof for verification

**API endpoint:** `POST /api/coordinate/select-jury`

### 7. Coordinator Agent (Orchestration)

**File:** `coordinator-agent/src/monitor/memory-monitor.ts`
**Port:** 3000

The coordinator is the orchestration brain. It bridges the NEAR contract and Ensue, and triggers post-vote operations (backup, archival).

**Post-vote pipeline:**
```
Vote complete
  └─> Tally + resume contract (on-chain)
  └─> Encrypt deliberation → upload to Storacha (warm)
  └─> Archive Storacha CID to Filecoin (cold)
  └─> Serialize full Ensue tree → Storacha backup
```

**Two modes:**
- `LOCAL_MODE=true` — Skips TEE registration. Coordinator triggers workers via HTTP and calls contract via `near-api-js`. Used for development.
- Production — Coordinator registers via Shade Agent SDK with DCAP attestation. Contract verifies TEE before accepting results.

### 8. Voter Agents (AI Deliberation)

**Files:** `worker-agent/src/workers/task-handler.ts` + `ai-voter.ts`
**Ports:** 3001, 3002, 3003

Each voter agent is an independent AI-powered decision maker with a sovereign `did:key` identity.

**Vote task flow:**

```
Receive task config {type: "vote", parameters: {proposal: "..."}}
  └─> Update Ensue status: "processing"
  └─> Load agent identity (profile, values, decision history)
  └─> Fetch DAO manifesto from contract (RPC view call)
  └─> Call NEAR AI API:
        Model: deepseek-ai/DeepSeek-V3.1
        System: "You are a DAO agent. Vote based on the manifesto..."
        User: "Manifesto: {text}\nProposal: {proposal}"
        Tool: dao_vote({vote, reasoning})
  └─> Parse structured response: {vote: "Approved", reasoning: "..."}
  └─> Write result to Ensue: {workerId, vote, reasoning, processingTime}
  └─> Record decision to local history
  └─> Update Ensue status: "completed"
```

---

## Privacy Model

### Off-Chain Deliberation, On-Chain Settlement

```
PRIVATE (Ensue + Storacha)              PUBLIC (NEAR blockchain)
====================================    ================================
Worker 1: Approved                      Approved: 2
  "Aligns with manifesto                Rejected: 1
   section 3 on education..."           Decision: Approved
Worker 2: Rejected                      Worker count: 3
  "Budget exceeds our                   Config hash (integrity)
   fiscal guidelines..."                Result hash (integrity)
Worker 3: Approved                      Worker submission hashes (nullifier)
  "Community impact justifies
   the investment..."
Processing times
Error details
Encrypted transcripts (Storacha)
Filecoin archival records
```

### How Privacy Is Maintained

1. **Worker isolation** — Each voter writes ONLY to its own Ensue namespace. Voters cannot read each other's results.
2. **Coordinator aggregation** — Individual votes and reasoning are discarded before writing to the contract.
3. **On-chain data** — `{approved, rejected, decision, workerCount}` only. No individual votes derivable.
4. **Nullifier pattern** — Worker submission hashes prevent double-voting without revealing vote content.
5. **Threshold encryption** — Lit Protocol threshold keys encrypt data before Storacha upload. ACCs enforce access.
6. **TEE enforcement (production)** — Coordinator runs in Phala TEE with verified code.
7. **FHE voting (V2)** — For confidential proposals, even the encrypted tally is invisible until TEE finalization.

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Smart Contract | Rust + near-sdk 5.7.0 | On-chain settlement with yield/resume |
| Registry Contract | Rust + near-sdk 5.17.2 | Platform-wide agent directory |
| AI Model | DeepSeek-V3.1 via NEAR AI | Proposal deliberation and structured voting |
| AI Verification | NEAR AI Signature + Attestation | Cryptographic proof of model identity |
| Agents | TypeScript + Hono 4.8 | HTTP servers for coordination and voting |
| Hot Memory | Ensue Memory Network | Off-chain agent coordination (JSON-RPC 2.0/SSE) |
| Warm Storage | Storacha + Lit Protocol | Encrypted persistent storage with UCAN auth |
| Cold Archival | Filecoin (via Storacha) | Permanent storage with Proof of Spacetime |
| Confidential Voting | Zama fhEVM | FHE-encrypted ballots and homomorphic tally |
| Verifiable Randomness | Flow VRF | Fair jury selection with cryptographic proof |
| Agent Identity | did:key + UCAN delegation | Sovereign agent identity per worker |
| TEE Runtime | Phala Network + Shade Agent SDK | Trusted execution environment |
| Payments | PingPay (USDC on NEAR) | Agent deployment checkout |
| Frontend | Next.js 15 + React 19 | Dashboard, deploy UI, on-chain viewer |

## File Map

```
near-shade-coordination/
  coordinator-contract/       # NEAR smart contract (Rust)
    src/lib.rs                # Yield/resume, manifesto, proposal lifecycle, nullifier

  registry-contract/          # Agent registry contract (Rust)
    src/lib.rs                # Multi-coordinator/worker registry with endpoint URLs

  coordinator-agent/          # Orchestrator agent (TypeScript)
    src/index.ts              # Entry point, local/production mode switch
    src/monitor/
      memory-monitor.ts       # Core: Ensue polling, vote tally, contract resume, backup, archival
    src/contract/
      resume-handler.ts       # Shade Agent SDK contract calls
      local-contract.ts       # near-api-js calls for local mode
    src/storacha/
      identity.ts             # Storacha client (did:key + UCAN)
      vault.ts                # Encrypt + upload with Lit ACCs
      ensue-backup.ts         # Serialize Ensue tree to Storacha
    src/filecoin/
      archiver.ts             # IPNI verification + Filecoin archival records
    src/vrf/
      flow-vrf.ts             # Flow VRF seed + Fisher-Yates shuffle
      jury-selector.ts        # Coordinator wrapper for jury selection
    src/routes/
      coordinate.ts           # HTTP API: trigger, status, workers, reset, select-jury

  worker-agent/               # AI voter agent (TypeScript, runs as 3 instances)
    src/index.ts              # Entry point (Hono server)
    src/workers/
      task-handler.ts         # Task execution, Ensue status tracking, polling loop
      ai-voter.ts             # NEAR AI integration (DeepSeek-V3.1)
    src/storacha/
      identity.ts             # Storacha client (did:key + UCAN)
      agent-identity.ts       # Agent profile, preferences, decision history
    src/routes/
      task.ts                 # HTTP API: execute, status, health
      knowledge.ts            # HTTP API: identity, health

  contracts/voting/           # Zama fhEVM blind voting contract
    contracts/
      DeliberaVoting.sol      # FHE voting: castVote, finalize, publishResult
    test/
      DeliberaVoting.ts       # Hardhat tests (10 passing)

  shared/                     # Shared TypeScript library
    src/ensue-client.ts       # Ensue JSON-RPC client (SSE parsing)
    src/constants.ts          # Memory key paths, worker IDs
    src/types.ts              # TypeScript interfaces

  frontend/                   # Next.js 15 monitoring dashboard
    src/app/page.tsx          # Main dashboard layout
    src/app/components/       # CoordinatorPanel, WorkerCard, ContractStatePanel

  .claude/skills/             # Claude Code skills
    storacha-vault/           # Encrypt + upload to Storacha
    zama-blind-voting/        # Scaffold fhEVM voting contracts
    filecoin-archive/         # Archive CIDs to Filecoin
    flow-vrf/                 # Flow VRF jury selection
    ensue-backup/             # Serialize Ensue tree to Storacha
```
