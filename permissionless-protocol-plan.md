# Plan: Evolve Delibera into a Permissionless Coordination Protocol

## Purpose
This document is for **Claude Code plan mode**.
Read it fully. Answer all audit questions from the codebase before writing any code.
Do not write code until the five confirmation questions at the bottom are answered
and the plan is explicitly confirmed.

At the end of this plan, Claude Code must also update:
1. `CLAUDE.md` — reflect the new permissionless architecture
2. `IMPLEMENTATION_PLAN.md` — add Phase 2 (this plan) and Phase 3 (Model C, future)

---

## The Core Problem: Delibera is Currently a Closed System

The current implementation hardcodes everything about who participates:

```bash
# coordinator-agent/.env.development.local
WORKERS=worker1:3001,worker2:3002,worker3:3003
```

```typescript
// Ensue memory layout — hardcoded worker names
coordination/tasks/worker1/status
coordination/tasks/worker2/status
coordination/tasks/worker3/status
```

This means:
- The operator decides who the voters are
- Adding a voter requires changing env files and redeploying
- The coordinator only knows workers it was configured with at boot
- There is no economic barrier or on-chain proof of participation

This contradicts the fundamental value proposition of Delibera.

---

## Participation Model: Model A (Open Self-Registration)

**This iteration implements Model A — the simplest permissionless model.**

A worker pays a deposit, picks a coordinator, and starts receiving proposals
immediately. No approval step. No coordinator dashboard for managing workers.
The coordinator discovers its workers from the registry at runtime.

**Model C (VRF-based global pool selection) is explicitly out of scope
for this iteration.** It is documented at the bottom of this plan
as the next iteration target.

### Why Model A first
- Fewest contract changes
- Fastest path to permissionless participation
- Proves the dynamic worker discovery works before adding VRF complexity
- Model C can be layered on top without breaking Model A

---

## Identity Principle: Every Participant Has a DID

Both workers and coordinators are full participants with sovereign identity.
The model is symmetric:

```
Every participant in Delibera has:
  - A sovereign did:key  (Storacha identity, self-generated)
  - A NEAR AccountID     (on-chain identity)
  - A registry record    linking both
  - A Storacha space     for persistent state
  - A deposit            proving skin-in-the-game
```

The coordinator is not a special privileged entity — it is a participant
with an orchestrator role. It has its own DID, its own Storacha space,
and its own persistent identity (accumulated knowledge about the DAOs
it has served, reputation score, past coordination history).

This means `coordinator_id` in the registry becomes `coordinator_did`,
and the coordinator's Storacha space is provisioned exactly like a worker's.

---

## Audit Required Before Planning

Claude Code must read and report on the following before proposing changes.

### 1. Registry Contract (`registry-contract/src/lib.rs`)
- What is the current `Worker` struct? List every field.
- What is the current `Coordinator` struct? List every field.
- Does a worker entry already include a `coordinator_id` or `coordinator_did` field?
- Does the contract already expose `get_workers_for_coordinator()`?
- What does `register_worker` currently require as arguments?
- What are the current `StorageKey` enum variants and their ordinal positions?
  **List them explicitly — this is critical for safe schema migration.**
- Is the 0.7 NEAR deposit enforced on-chain or just documented?

### 2. Coordinator Contract (`coordinator-contract/src/lib.rs`)
- Does `start_coordination` accept a `worker_count` parameter or is it hardcoded?
- Does `record_worker_submissions` validate against a known worker list
  or accept any worker ID?
- Does any assertion in the contract hardcode worker count = 3?
  Search for `== 3`, `!= 3`, `len() == 3`.

### 3. Coordinator Agent (`coordinator-agent/src/`)
- Where exactly is `WORKERS=worker1:3001,...` consumed? List file and line.
- Where are worker IDs used as Ensue key paths? List every occurrence.
- Does `memory-monitor.ts` hardcode `['worker1','worker2','worker3']`
  or derive them from env?
- How does the coordinator decide "all workers are done"?
  Is it a fixed count or derived from the worker list length?

### 4. Worker Agent (`worker-agent/src/`)
- Does a worker know its ID only from `WORKER_ID` env var?
- Does a worker register itself anywhere on startup?
- Is there any self-identification logic beyond the env var?

Report all findings before proposing any changes.

---

## Target Architecture

### Registry Contract (updated schema)

The registry becomes the runtime source of truth for all participants.

**Updated `Worker` struct:**
```rust
pub struct WorkerRecord {
    pub account_id: AccountId,
    pub coordinator_did: String,     // which coordinator this worker serves
    pub worker_did: String,          // sovereign did:key identity (new)
    pub endpoint_url: String,
    pub cvm_id: String,
    pub registered_at: u64,
    pub is_active: bool,
}
```

**Updated `Coordinator` struct:**
```rust
pub struct CoordinatorRecord {
    pub account_id: AccountId,
    pub coordinator_did: String,     // sovereign did:key identity (new)
    pub endpoint_url: String,
    pub cvm_id: String,
    pub min_workers: u8,             // minimum workers before accepting proposals
    pub max_workers: u8,             // maximum workers this coordinator will use
    pub registered_at: u64,
    pub is_active: bool,
}
```

**New view methods required:**
```rust
// Returns all active workers registered to a specific coordinator (by DID)
pub fn get_workers_for_coordinator(
    &self,
    coordinator_did: String
) -> Vec<WorkerRecord>

// Returns worker by DID (for self-registration check)
pub fn get_worker_by_did(
    &self,
    worker_did: String
) -> Option<WorkerRecord>

// Returns coordinator by DID
pub fn get_coordinator_by_did(
    &self,
    coordinator_did: String
) -> Option<CoordinatorRecord>
```

**Updated registration methods:**
```rust
// Worker self-registers under a coordinator (by coordinator DID)
// Anyone can call this — no coordinator approval needed (Model A)
pub fn register_worker(
    &mut self,
    coordinator_did: String,   // updated: was coordinator_id AccountId
    worker_did: String,        // new: sovereign identity
    endpoint_url: String,
    cvm_id: String,
) // 0.7 NEAR deposit enforced on-chain

// Coordinator self-registers
pub fn register_coordinator(
    &mut self,
    coordinator_did: String,   // new: sovereign identity
    endpoint_url: String,
    cvm_id: String,
    min_workers: u8,
    max_workers: u8,
) // 0.7 NEAR deposit enforced on-chain
```

**StorageKey migration — CRITICAL:**
Before writing any contract code, list the current ordinals.
New variants must be appended. Never reorder. Add `_Deprecated` placeholders
to burn any removed ordinals. Example safe pattern:

```rust
pub enum StorageKey {
    CoordinatorsV1,          // ordinal 0 — keep
    WorkersV1,               // ordinal 1 — keep
    // If adding new indexes:
    WorkersByCoordinatorV1,  // ordinal 2 — new
    CoordinatorsByDidV1,     // ordinal 3 — new
}
```

If existing records must be migrated to the new schema, add a one-time
`migrate_v1_to_v2()` owner-only function.

### Coordinator Contract (minimal change)

Only one change: proposals must store the expected worker count so the
contract can validate submissions correctly regardless of pool size.

```rust
pub struct Proposal {
    pub task_config: String,
    pub config_hash: String,
    pub state: ProposalState,
    pub expected_worker_count: u8,  // new: set at start_coordination time
    pub worker_submissions: Vec<WorkerSubmission>,
    pub finalized_result: Option<String>,
}
```

Updated `start_coordination`:
```rust
pub fn start_coordination(
    &mut self,
    task_config: String,
    expected_worker_count: u8,   // new parameter
) -> Promise
```

The coordinator passes this value after querying the registry.
`record_worker_submissions` validates that submissions received equals
`expected_worker_count` before allowing `coordinator_resume`.

### Coordinator Agent (dynamic worker discovery)

The coordinator no longer reads `WORKERS` from env.
On each coordination cycle, it queries the registry:

```typescript
// coordinator-agent/src/monitor/memory-monitor.ts

async function getActiveWorkers(): Promise<WorkerRecord[]> {
  const coordinatorDID = deriveDidFromPrivateKey(
    process.env.COORDINATOR_STORACHA_PRIVATE_KEY!
  )
  const workers = await nearView({
    contractId: process.env.REGISTRY_CONTRACT_ID!,
    methodName: 'get_workers_for_coordinator',
    args: { coordinator_did: coordinatorDID }
  })
  return workers.filter((w: WorkerRecord) => w.is_active)
}
```

**Registry snapshot at vote start** — prevents mid-vote registration
from changing the expected worker count:

```typescript
async function startCoordinationCycle(proposalId: number, taskConfig: string) {
  // Take snapshot of current worker pool
  const workers = await getActiveWorkers()

  if (workers.length < MIN_WORKERS) {
    console.warn(`Not enough workers (${workers.length}). Skipping proposal ${proposalId}.`)
    return
  }

  // Store snapshot in Ensue for this cycle
  await ensue.set(
    `coordination/coordinator/worker_snapshot_${proposalId}`,
    JSON.stringify(workers.map(w => w.worker_did))
  )

  // Pass count to contract
  await nearCall({
    methodName: 'start_coordination',
    args: { task_config: taskConfig, expected_worker_count: workers.length }
  })

  // Set pending status for each worker in snapshot (by DID)
  for (const worker of workers) {
    await ensue.set(
      `coordination/tasks/${worker.worker_did}/status`,
      'pending'
    )
  }
}
```

**"All workers done" check** becomes dynamic:

```typescript
async function checkAllWorkersComplete(proposalId: number): Promise<boolean> {
  const snapshot = JSON.parse(
    await ensue.get(`coordination/coordinator/worker_snapshot_${proposalId}`)
  ) as string[]  // array of worker DIDs

  const statuses = await Promise.all(
    snapshot.map(did =>
      ensue.get(`coordination/tasks/${did}/status`)
    )
  )
  return statuses.every(s => s === 'completed')
}
```

### Worker Agent (self-registration on startup)

Workers register themselves on startup if not already registered.
The `WORKER_ID` env var is removed. Identity comes from the DID.

```typescript
// worker-agent/src/index.ts

async function ensureRegistered(): Promise<void> {
  const workerDID = deriveDidFromPrivateKey(
    process.env.WORKER_STORACHA_PRIVATE_KEY!
  )
  const coordinatorDID = process.env.COORDINATOR_DID!

  const existing = await nearView({
    contractId: process.env.REGISTRY_CONTRACT_ID!,
    methodName: 'get_worker_by_did',
    args: { worker_did: workerDID }
  })

  if (!existing) {
    await nearCall({
      contractId: process.env.REGISTRY_CONTRACT_ID!,
      methodName: 'register_worker',
      args: {
        coordinator_did: coordinatorDID,
        worker_did: workerDID,
        endpoint_url: process.env.WORKER_ENDPOINT_URL!,
        cvm_id: process.env.PHALA_CVM_ID ?? 'local',
      },
      deposit: '700000000000000000000000' // 0.7 NEAR
    })
    console.log(`✅ Worker ${workerDID} registered under coordinator ${coordinatorDID}`)
  } else {
    console.log(`✅ Worker ${workerDID} already registered`)
  }
}
```

Worker polls Ensue for its DID-keyed status path instead of `workerN`:

```typescript
// Before
const statusKey = `coordination/tasks/${process.env.WORKER_ID}/status`

// After
const workerDID = deriveDidFromPrivateKey(process.env.WORKER_STORACHA_PRIVATE_KEY!)
const statusKey = `coordination/tasks/${workerDID}/status`
```

### Coordinator Self-Registration

The coordinator registers itself on startup too, same pattern as workers:

```typescript
// coordinator-agent/src/index.ts

async function ensureCoordinatorRegistered(): Promise<void> {
  const coordinatorDID = deriveDidFromPrivateKey(
    process.env.COORDINATOR_STORACHA_PRIVATE_KEY!
  )

  const existing = await nearView({
    contractId: process.env.REGISTRY_CONTRACT_ID!,
    methodName: 'get_coordinator_by_did',
    args: { coordinator_did: coordinatorDID }
  })

  if (!existing) {
    await nearCall({
      contractId: process.env.REGISTRY_CONTRACT_ID!,
      methodName: 'register_coordinator',
      args: {
        coordinator_did: coordinatorDID,
        endpoint_url: process.env.COORDINATOR_ENDPOINT_URL!,
        cvm_id: process.env.PHALA_CVM_ID ?? 'local',
        min_workers: parseInt(process.env.MIN_WORKERS ?? '1'),
        max_workers: parseInt(process.env.MAX_WORKERS ?? '10'),
      },
      deposit: '700000000000000000000000'
    })
    console.log(`✅ Coordinator ${coordinatorDID} registered`)
  }
}
```

### Shared DID Utility

Both coordinator and worker agents need to derive a DID from a Storacha
private key. This goes in `shared/`:

**File to create:** `shared/src/did-utils.ts`

```typescript
import { importDAGPBKey } from '@storacha/client/principal/ed25519'

export function deriveDidFromPrivateKey(privateKeyBase64: string): string {
  // Derives did:key from the Storacha private key
  // Used by both coordinator and worker for registry interactions
  const key = importDAGPBKey(privateKeyBase64)
  return key.did()
}
```

### Ensue Memory Layout (DID-keyed)

```
coordination/
  tasks/
    {workerDID}/          # was: worker1/, worker2/, worker3/
      status
      result
      timestamp
      error
  coordinator/
    status
    tally
    proposal_id
    worker_snapshot_{proposalId}   # new: registry snapshot per vote
  config/
    task_definition
```

---

## Migration Steps

### Step 0 — Audit (no code changes)
Answer all audit questions above. Report findings. Wait for confirmation.

### Step 1 — Update Registry Contract

**File:** `registry-contract/src/lib.rs`

1. Add `coordinator_did` and `worker_did` fields to structs
2. Add `min_workers`, `max_workers` to `CoordinatorRecord`
3. Add `get_workers_for_coordinator(coordinator_did)` view
4. Add `get_worker_by_did(worker_did)` view
5. Add `get_coordinator_by_did(coordinator_did)` view
6. Update `register_worker` and `register_coordinator` signatures
7. Append new `StorageKey` variants — never reorder existing
8. Add `migrate_v1_to_v2()` owner-only function if live data exists
9. Deploy to testnet, verify views return correct data

### Step 2 — Update Coordinator Contract

**File:** `coordinator-contract/src/lib.rs`

1. Add `expected_worker_count: u8` to `Proposal` struct
2. Add `expected_worker_count` parameter to `start_coordination`
3. In `record_worker_submissions`, validate submission count matches
   `expected_worker_count`
4. Append new `StorageKey` variants if needed
5. Deploy to testnet

### Step 3 — Create Shared DID Utility

**File to create:** `shared/src/did-utils.ts`

`deriveDidFromPrivateKey(privateKeyBase64: string): string`

Both coordinator and worker import this. Write a unit test confirming
the same key always produces the same DID.

### Step 4 — Add Coordinator Storacha Identity

**Files to modify:**
- `coordinator-agent/.env.development.local` — add `COORDINATOR_STORACHA_*` vars
- Run `scripts/provision-storacha-spaces.sh` for the coordinator

New env vars:
```bash
# coordinator-agent/.env.development.local

# [V2] Coordinator sovereign identity
COORDINATOR_STORACHA_PRIVATE_KEY=...
COORDINATOR_STORACHA_DELEGATION_BASE64=...
COORDINATOR_STORACHA_SPACE_DID=...
COORDINATOR_ENDPOINT_URL=http://localhost:3000
MIN_WORKERS=1
MAX_WORKERS=10
REGISTRY_CONTRACT_ID=registry.agents-coordinator.testnet

# Remove:
# WORKERS=worker1:3001,worker2:3002,worker3:3003
```

### Step 5 — Add Coordinator Self-Registration

**File:** `coordinator-agent/src/index.ts`

Add `ensureCoordinatorRegistered()` at startup before the polling loop.

### Step 6 — Replace Worker Discovery in Coordinator

**File:** `coordinator-agent/src/monitor/memory-monitor.ts`

1. Remove `WORKERS` env var parsing
2. Add `getActiveWorkers()` registry query
3. Add `startCoordinationCycle()` with registry snapshot
4. Replace fixed-count "all done" check with `checkAllWorkersComplete()`
5. Change all Ensue key paths from hardcoded names to `{workerDID}`
6. Pass `workers.length` as `expected_worker_count` to `start_coordination`

### Step 7 — Update Worker Agent

**Files:** `worker-agent/src/index.ts`, `worker-agent/src/workers/task-handler.ts`

1. Remove `WORKER_ID` env var usage everywhere
2. Add `ensureRegistered()` at startup
3. Change Ensue key paths from `process.env.WORKER_ID` to derived DID
4. Update `getWorkerKeys()` call to pass DID instead of `WORKER_ID`

New env vars per worker:
```bash
# worker-agent/.env.workerN.local

# Add:
COORDINATOR_DID=did:key:z6Mk...    # coordinator's DID
WORKER_ENDPOINT_URL=http://localhost:300N
PHALA_CVM_ID=local
REGISTRY_CONTRACT_ID=registry.agents-coordinator.testnet

# Remove:
# WORKER_ID=workerN
# WORKERS=...  (was never here but confirm)
```

### Step 8 — Update Shared Constants

**File:** `shared/src/constants.ts`

```typescript
// Before
export const getWorkerKeys = (workerId: string) => ({
  STATUS: `coordination/tasks/${workerId}/status`,
  RESULT: `coordination/tasks/${workerId}/result`,
  TIMESTAMP: `coordination/tasks/${workerId}/timestamp`,
  ERROR: `coordination/tasks/${workerId}/error`,
})
// Called as: getWorkerKeys('worker1')

// After — same function, caller passes DID instead of name
// Called as: getWorkerKeys(workerDID)
// No change to the function itself — just the values passed to it change
```

Also add:
```typescript
export const getCoordinatorSnapshotKey = (proposalId: number) =>
  `coordination/coordinator/worker_snapshot_${proposalId}`
```

### Step 9 — Update Frontend

**Files:** `frontend/src/app/coordinator/`, `frontend/src/app/worker/`

1. Replace hardcoded `worker1/2/3` references with registry query
2. Fetch active workers from registry at page load
3. Display truncated DID as worker identifier
4. Show worker registration date and coordinator association

### Step 10 — Update run-dev.sh

```bash
# run-dev.sh
WORKER_COUNT=${WORKER_COUNT:-3}
for i in $(seq 1 $WORKER_COUNT); do
  cd worker-agent && npm run dev:worker$i &
done
```

For local dev, worker env files are `.env.worker1.local` through
`.env.worker{N}.local`. Each must have unique `WORKER_STORACHA_PRIVATE_KEY`.

### Step 11 — Update CLAUDE.md

Claude Code must update `CLAUDE.md` with:
- Remove all references to `worker1`, `worker2`, `worker3` as fixed identities
- Remove `WORKERS=worker1:3001,...` from env var section
- Add `COORDINATOR_STORACHA_*`, `COORDINATOR_DID`, `REGISTRY_CONTRACT_ID`
  to coordinator env vars
- Add `COORDINATOR_DID`, `WORKER_ENDPOINT_URL`, `REGISTRY_CONTRACT_ID`
  to worker env vars
- Remove `WORKER_ID` from worker env vars
- Update Ensue memory layout to show `{workerDID}` paths
- Update "The Voting Flow" section: coordinator now queries registry
  and takes a snapshot before each vote
- Update "Identity" section: both coordinator and workers have
  sovereign DIDs and Storacha spaces
- Add "Permissionless Participation" section explaining how to register
  as a worker or coordinator
- Add "Future: Model C" note pointing to next iteration plan

### Step 12 — Update IMPLEMENTATION_PLAN.md

Claude Code must update `IMPLEMENTATION_PLAN.md` with:
- Mark Phase 1 (original hardcoded setup) as ✅ Complete
- Add Phase 2 — Permissionless Protocol (Model A): this plan
- Add Phase 3 — VRF-Based Global Pool (Model C): future iteration (see below)
- Update architecture diagram to show dynamic worker pool
- Update success criteria

### Step 13 — Verify End-to-End

```bash
# Start with only 2 workers to prove count is not hardcoded
WORKER_COUNT=2 ./run-dev.sh

# Trigger a vote — coordinator should find 2 workers from registry
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":"{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Fund developer education\"}}"}'

curl http://localhost:3000/api/coordinate/status
# Verify: tally shows workerCount: 2, two DID-keyed results

# Start a 3rd worker (simulates a new participant joining)
cd worker-agent && DOTENV_CONFIG_PATH=.env.worker3.local npm run dev &
# Worker self-registers on startup

# Trigger a second vote — coordinator should now find 3 workers
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":"{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Reduce gas budget\"}}"}'

# Verify: tally shows workerCount: 3
```

Verification checklist:
- [ ] `WORKERS` env var removed from all config files
- [ ] `WORKER_ID=worker1/2/3` removed from all config files
- [ ] Coordinator discovers workers from registry at runtime
- [ ] Ensue keys use worker DIDs, not hardcoded names
- [ ] Registry snapshot stored per proposal in Ensue
- [ ] A vote with 2 workers completes correctly
- [ ] A vote with 3 workers (after new worker joins) completes correctly
- [ ] New worker can join without coordinator restart or config change
- [ ] Coordinator has its own DID and Storacha space
- [ ] Frontend shows dynamic worker list from registry
- [ ] `CLAUDE.md` updated
- [ ] `IMPLEMENTATION_PLAN.md` updated with Phase 2 and Phase 3

---

## Files Summary

### Files to Create
| File | Purpose | Step |
|---|---|---|
| `shared/src/did-utils.ts` | Derive DID from Storacha private key | 3 |

### Files to Modify
| File | Change | Step |
|---|---|---|
| `registry-contract/src/lib.rs` | Add DID fields, new view methods, updated registration | 1 |
| `coordinator-contract/src/lib.rs` | Add `expected_worker_count` to proposals | 2 |
| `coordinator-agent/.env.development.local` | Add `COORDINATOR_STORACHA_*`, remove `WORKERS` | 4 |
| `coordinator-agent/src/index.ts` | Add `ensureCoordinatorRegistered()` | 5 |
| `coordinator-agent/src/monitor/memory-monitor.ts` | Registry query, snapshot, DID-keyed Ensue paths | 6 |
| `worker-agent/src/index.ts` | Add `ensureRegistered()`, remove `WORKER_ID` | 7 |
| `worker-agent/src/workers/task-handler.ts` | DID-keyed Ensue paths, remove `WORKER_ID` | 7 |
| `worker-agent/.env.worker{1,2,3}.local` | Add `COORDINATOR_DID`, remove `WORKER_ID` | 7 |
| `shared/src/constants.ts` | Add snapshot key, confirm `getWorkerKeys` is DID-ready | 8 |
| `frontend/src/app/coordinator/` | Dynamic worker list from registry | 9 |
| `run-dev.sh` | `WORKER_COUNT` configurable | 10 |
| `CLAUDE.md` | Reflect permissionless architecture | 11 |
| `IMPLEMENTATION_PLAN.md` | Add Phase 2 and Phase 3 | 12 |

### Files NOT Changed
| File | Reason |
|---|---|
| `shared/src/ensue-client.ts` | Protocol unchanged, only key values change |
| `coordinator-agent/src/contract/resume-handler.ts` | Only `expected_worker_count` arg added |
| `worker-agent/src/workers/ai-voter.ts` | Handled in profile migration plan |

---

## Confirmation Questions Before Coding

1. **Does the registry contract already have `coordinator_id` on worker records?**
   If yes, Step 1 is an extension (add `worker_did`, rename field).
   If no, it is a new field requiring a migration function for live data.
   List current `StorageKey` ordinals explicitly.

2. **Does the coordinator contract assert worker count = 3 anywhere?**
   Search for `== 3`, `!= 3`, `len() == 3` in `coordinator-contract/src/lib.rs`.
   If found, Step 2 must replace that assertion with the dynamic count check.

3. **Is `WORKERS` env var parsed as a simple list or as `id:port` pairs?**
   The answer determines how `getActiveWorkers()` replaces it — whether
   port mapping needs to move to the registry or to worker env vars.

4. **What is `MIN_WORKERS` for the coordinator?**
   If the registry returns 0 active workers, should the coordinator:
   a) Skip the proposal and retry later
   b) Error and alert
   c) Wait up to a timeout for workers to appear
   Recommendation: skip and retry on next poll cycle. Confirm.

5. **Are there live registrations in the registry contract on testnet?**
   If yes, `migrate_v1_to_v2()` must be written before any schema changes.
   If no, the contract can be redeployed fresh.

---

## Phase 3 Preview: Model C (Next Iteration)

**Do not implement this now. Document it for future planning.**

Model C replaces coordinator↔worker association with a global pool and
VRF-based selection:

- Workers register globally — no `coordinator_did` at registration time
- Each proposal triggers a Flow VRF call to select N workers from the pool
- Selected workers are notified via Ensue and have a time window to accept
- Unselected workers remain eligible for future proposals
- Stake tiers determine eligibility for high-stakes proposals
- Workers don't know in advance if they'll be selected (collusion resistance)

**What changes from Model A to Model C:**
- Registry: remove `coordinator_did` from `WorkerRecord`, add `stake_tier`
- Registry: add global pool queries `get_eligible_workers(min_stake)`
- Coordinator: replace `get_workers_for_coordinator()` with VRF selection
- Flow VRF: becomes load-bearing for every vote, not optional
- Worker: no longer configured with a specific coordinator

**Model A is forward-compatible with Model C.** The DID identity model,
Storacha spaces, and DID-keyed Ensue paths all carry forward unchanged.
Model C is purely additive at the registry and coordinator level.

---

## Definition of Done

- [ ] Registry stores both `coordinator_did` and `worker_did` on all records
- [ ] Registry has `get_workers_for_coordinator(coordinator_did)` view
- [ ] Coordinator discovers workers from registry at runtime
- [ ] Coordinator has its own DID and Storacha space
- [ ] Worker IDs in Ensue are DIDs, not `worker1/2/3`
- [ ] Registry snapshot stored per proposal in Ensue
- [ ] `WORKERS` env var removed from all config files
- [ ] `WORKER_ID` env var removed from all config files
- [ ] A vote completes correctly with any number of registered workers
- [ ] A new worker can join without restarting the coordinator
- [ ] Frontend shows dynamic worker list from registry
- [ ] `CLAUDE.md` updated to reflect permissionless model
- [ ] `IMPLEMENTATION_PLAN.md` updated with Phase 2 (this) and Phase 3 (Model C)