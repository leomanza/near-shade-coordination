# Plan: Migrate Worker Identity & Memory from Local JSON to Storacha Spaces

## Purpose
This document is intended for **Claude Code plan mode**.
Read it fully before proposing any file changes.
Do not write any code until the five confirmation questions at the bottom are answered
and the plan is explicitly confirmed.

---

## Known Completed Work (Skip These)
- **NOVA SDK is fully removed.** `src/nova/` does not exist. Skip any audit or
  cleanup tasks related to NOVA.
- **Storacha MCP server** is already cloned at `mcp-storage-server/`.
- **`@storacha/client`** and **`@storacha/encrypt-upload-client`** are already installed.

---

## Current State (What Exists Now)

### The seed file (kept, not deleted)
`config/profile.json` — a shared JSON file containing one entry per worker:

```json
{
  "worker1": {
    "identity": { ... },
    "knowledge": [ ... ],
    "priorReasoning": [ ... ],
    "historicalMemory": [ ... ],
    "persistentState": { ... }
  },
  "worker2": { ... },
  "worker3": { ... }
}
```

### The AI voter (ai-voter.ts — partially correct, needs completion)

The current `SYSTEM_MESSAGE` in `worker-agent/src/workers/ai-voter.ts`:

```typescript
const SYSTEM_MESSAGE =
  'You are a Decentralized Autonomous Organization (DAO) agent with a persistent identity. ' +
  'You have your own values, accumulated knowledge, and decision history that shape your reasoning. ' +
  'Each prompt will contain your agent identity (values, guidelines, voting weights, past decisions), ' +
  'the DAO manifesto, and a proposal to vote on. ' +
  'Vote on the proposal based on BOTH the DAO manifesto AND your personal agent identity. ' +
  'Your accumulated knowledge and past decisions should inform your reasoning. ' +
  'Provide both your vote (Approved or Rejected) and a clear explanation of your reasoning. ' +
  'You must keep responses under 10,000 characters.';
```

**What is correct:** The static instruction template. It belongs in `ai-voter.ts`
and stays there unchanged.

**What is broken:** The system message promises the model that its accumulated
knowledge and past decisions will be in the prompt — but currently this data
either comes from a static `profile.json` (same for all workers, never grows)
or is not injected at all. The model is told it has a persistent identity it
does not actually receive.

**What this plan fixes:** The runtime content that fulfills that promise —
the per-worker values, past decisions, and knowledge base — must be extracted
from `profile.json`, made genuinely distinct per worker, and injected into
every AI call via a `buildAgentContext()` function. Later, this data source
moves to Storacha so it actually accumulates over time.

---

## config/profile.json Retention Policy
`config/profile.json` is **NOT deleted**. It becomes a static seed file.

Its purpose after migration:
- Read **once** by the migration script to populate each worker's Storacha space
- **Never** read at runtime by any agent process
- Serves as the source of truth for future provider migrations
- Defines the canonical schema for the `WorkerProfile` type

Add this comment after migration:
```json
{
  "_comment": "SEED FILE — not read at runtime. Used only for initial Storacha provisioning and future provider migrations. Schema is canonical for WorkerProfile type.",
  "worker1": { ... }
}
```

---

## Audit Required Before Planning
Claude Code must identify every file that currently:
- Imports or `require()`s `config/profile.json`
- Uses `fs.readFileSync`, `fs.writeFileSync`, `JSON.parse`, or `JSON.stringify`
  on any path containing `profile`
- References any of these keys at runtime: `identity`, `knowledge`,
  `priorReasoning`, `historicalMemory`, `persistentState`
- Builds the user message or context passed to the NEAR AI API call

Produce this audit list and report findings before proposing any file changes.

---

## Architectural Constraints (Non-Negotiable)

1. **Each worker runs in its own Phala TEE.** Workers cannot share memory,
   filesystem, or secrets between enclaves.
2. **The coordinator has no access to worker private state.**
3. **No persistent state on local disk at runtime.** `config/profile.json`
   must not be read by any running agent process after migration.
4. **One Storacha space per worker.** Keys and delegations are never shared.
5. **UCAN delegation scope must be minimal.** Each worker's delegation grants
   only `space/blob/add`, `space/index/add`, `upload/add`, `upload/list`.
6. **Workers must be genuinely distinct.** `worker1`, `worker2`, `worker3`
   must have different values, knowledge, and reasoning styles in `profile.json`.
   If they are currently identical or near-identical, this must be fixed in
   Step 0 before any migration proceeds.
7. **The AI call must receive real context.** `buildAgentContext()` must be
   called with live profile data on every vote. The system message's promise
   must be fulfilled, not just stated.

---

## Target Architecture

### ai-voter.ts (final shape)

`SYSTEM_MESSAGE` stays exactly as-is. Two new constructs are added alongside it:

```typescript
// STAYS — static instruction template, correct as-is
const SYSTEM_MESSAGE = `...`

// NEW — builds runtime context from persistent worker profile
// Currently sourced from profile.json, later from StorachaProfileClient
function buildAgentContext(profile: WorkerProfile): string {
  return [
    `## Your Agent Identity (${profile.identity.workerId})`,
    `Values: ${profile.identity.values ?? 'not yet defined'}`,
    `Voting weight: ${profile.identity.votingWeight ?? 1}`,
    '',
    `## Your Recent Decisions (last 5)`,
    profile.priorReasoning.slice(-5).length > 0
      ? profile.priorReasoning.slice(-5).map(r =>
          `- Proposal ${r.proposalId}: ${r.vote} — ${r.reasoning.substring(0, 120)}...`
        ).join('\n')
      : 'No prior decisions yet.',
    '',
    `## Your Knowledge Base`,
    profile.knowledge.length > 0
      ? profile.knowledge.map(k => `- ${k.content}`).join('\n')
      : 'No accumulated knowledge yet.',
  ].join('\n')
}

// UPDATED — assembles the full user message for each vote
function buildVotePrompt(profile: WorkerProfile, manifesto: string, proposal: string): string {
  return [
    buildAgentContext(profile),
    '',
    '## DAO Manifesto',
    manifesto,
    '',
    '## Proposal to Vote On',
    proposal,
  ].join('\n')
}
```

The AI call becomes:
```typescript
const userMessage = buildVotePrompt(workerProfile, manifesto, proposal)

const response = await nearAI.chat.completions.create({
  model: 'deepseek-ai/DeepSeek-V3.1',
  messages: [
    { role: 'system', content: SYSTEM_MESSAGE },
    { role: 'user', content: userMessage },
  ],
  tool_choice: { type: 'function', function: { name: 'dao_vote' } },
  tools: [daoVoteTool],
})
```

After a vote completes, the result is saved back to the profile:
```typescript
await profileClient.saveReasoning(proposalId, {
  proposalId,
  vote: result.vote,
  reasoning: result.reasoning,
  computedAt: new Date().toISOString(),
})
```

This is how the identity actually accumulates — each vote adds to
`priorReasoning`, which is injected into the next vote via `buildAgentContext`.

### Per-Worker Storacha Space Layout

```
storacha-space (worker1)
  identity/
    did.json              # Worker's did:key and public key
    delegation.car        # UCAN delegation for this space
  knowledge/
    index.json            # CID list for all knowledge entries
    {cid}.json            # Knowledge fragments, one file per entry
  reasoning/
    {proposalId}.json     # Prior reasoning keyed by proposal ID
  memory/
    index.json            # CID list for all memory entries
    {sessionId}.json      # Historical memory per deliberation session
  state/
    current.json          # Current persistent state snapshot
```

### StorachaProfileClient (new abstraction)

```typescript
class StorachaProfileClient {
  static async fromEnv(workerId: string): Promise<StorachaProfileClient>

  async getIdentity(): Promise<WorkerIdentity>
  async setIdentity(identity: WorkerIdentity): Promise<CID>

  async getKnowledge(): Promise<KnowledgeEntry[]>
  async appendKnowledge(entry: KnowledgeEntry): Promise<CID>

  async getReasoningForProposal(proposalId: string): Promise<ReasoningEntry | null>
  async getAllReasoning(): Promise<ReasoningEntry[]>
  async saveReasoning(proposalId: string, reasoning: ReasoningEntry): Promise<CID>

  async getMemoryForSession(sessionId: string): Promise<MemoryEntry | null>
  async getAllMemory(): Promise<MemoryEntry[]>
  async appendMemory(sessionId: string, memory: MemoryEntry): Promise<CID>

  async getState(): Promise<PersistentState>
  async setState(state: PersistentState): Promise<CID>
}
```

### Encryption Requirement

All blobs uploaded to Storacha MUST be encrypted with Lit Protocol.
Access Control Condition:
```json
{
  "contractAddress": "coordinator.agents-coordinator.testnet",
  "standardContractType": "NEAR",
  "chain": "near",
  "method": "is_registered_worker",
  "parameters": [":workerId", ":userAddress"],
  "returnValueTest": { "comparator": "=", "value": "true" }
}
```

### In-Memory Cache

`StorachaProfileClient` maintains a session-level cache to avoid repeated
Storacha fetches within one task execution. Critical because `buildAgentContext`
is called on every AI inference.

```typescript
private cache: Map<string, unknown> = new Map()
// Populated on first read, invalidated on write
```

---

## Migration Steps

### Step 0 — Fix profile.json Content (before anything else)

**This step has no code changes to agent source files.**
It is a content fix to `config/profile.json`.

Audit the current profile entries for `worker1`, `worker2`, `worker3`:
- Are the `identity.values` distinct per worker? If not, define three genuinely
  different value sets (e.g., worker1 = fiscal conservatism, worker2 = growth
  focus, worker3 = community impact)
- Are `knowledge` entries distinct? If not, assign different knowledge domains
  per worker
- Is `priorReasoning` populated? If not, add 2-3 seed reasoning entries per
  worker to give the AI real context from the first vote

**Why this must come first:** If workers are identical in `profile.json`,
migrating identical data to Storacha produces identical Storacha spaces.
The three-voter privacy model only has value if the voters actually reason
differently. Fix the content before migrating it.

After this step, run a test vote and verify that the three workers produce
noticeably different reasoning in their Ensue outputs.

### Step 1 — Audit Call Sites (no code changes)

Claude Code must:
1. List every file referencing `profile.json` or the known key names
2. Identify the exact lines and what data is read or written
3. Identify whether `ai-voter.ts` currently injects profile data into the
   AI call or not — and if so, how
4. Identify where in `task-handler.ts` or `ai-voter.ts` a write-back
   after voting would go
5. Report findings and wait for confirmation before proceeding

### Step 2 — Update ai-voter.ts (profile.json as source)

**File to modify:** `worker-agent/src/workers/ai-voter.ts`

This step wires `profile.json` data into the AI call properly, before
Storacha exists. It makes the system message's promise true immediately.

Changes:
1. Import `WorkerProfile` type from `shared/src/types.ts`
2. Add `buildAgentContext(profile: WorkerProfile): string` function
3. Add `buildVotePrompt(profile, manifesto, proposal): string` function
4. Update the AI call to use `buildVotePrompt` for the user message
5. After vote result is received, append the result to `profile.priorReasoning`
   and write it back to `profile.json`

**Write-back pattern (temporary, profile.json as sink):**
```typescript
// After vote completes — append to profile and write back
const updatedProfile = {
  ...workerProfile,
  priorReasoning: [
    ...workerProfile.priorReasoning,
    {
      proposalId,
      vote: result.vote,
      reasoning: result.reasoning,
      computedAt: new Date().toISOString(),
    }
  ]
}
fs.writeFileSync(
  path.join(__dirname, '../../../config/profile.json'),
  JSON.stringify({ ...allProfiles, [workerId]: updatedProfile }, null, 2)
)
```

This write-back is temporary. It is replaced by `profileClient.saveReasoning()`
in Step 8. It exists so that identity accumulation works immediately, even
before Storacha is ready.

After this step: run two consecutive votes and verify that the second vote's
reasoning references the first vote's outcome in the AI output.

### Step 3 — Add Types to shared/src/types.ts

```typescript
export interface WorkerIdentity {
  did: string
  publicKey: string
  workerId: string
  values?: string
  votingWeight?: number
  createdAt: string
}

export interface KnowledgeEntry {
  id: string
  content: string
  source?: string
  addedAt: string
}

export interface ReasoningEntry {
  proposalId: string
  vote: 'Approved' | 'Rejected'
  reasoning: string
  computedAt: string
}

export interface MemoryEntry {
  sessionId: string
  summary: string
  proposalId: string
  timestamp: string
}

export interface PersistentState {
  lastProposalId?: string
  voteCount: number
  lastActiveAt: string
  customState: Record<string, unknown>
}

export interface WorkerProfile {
  identity: WorkerIdentity
  knowledge: KnowledgeEntry[]
  priorReasoning: ReasoningEntry[]
  historicalMemory: MemoryEntry[]
  persistentState: PersistentState
}
```

### Step 4 — Provision Storacha Spaces (CLI setup script)

**File to create:** `scripts/provision-storacha-spaces.sh`

```bash
#!/bin/bash
# Run once per worker. Output values go into worker-agent/.env.workerN.local

for WORKER_ID in worker1 worker2 worker3; do
  echo "=== Provisioning $WORKER_ID ==="

  storacha key create
  # → WORKER_STORACHA_PRIVATE_KEY, WORKER_STORACHA_DID

  storacha space create delibera-$WORKER_ID
  # → WORKER_STORACHA_SPACE_DID

  storacha delegation create $WORKER_DID \
    --can 'space/blob/add' \
    --can 'space/index/add' \
    --can 'upload/add' \
    --can 'upload/list' \
    -o $WORKER_ID-delegation.car

  base64 $WORKER_ID-delegation.car
  # → WORKER_STORACHA_DELEGATION_BASE64

  echo "Add above values to worker-agent/.env.$WORKER_ID.local"
done
```

### Step 5 — Create StorachaProfileClient

**File to create:** `shared/src/storacha-profile-client.ts`

Requirements:
- `fromEnv()` reads `WORKER_STORACHA_PRIVATE_KEY`, `WORKER_STORACHA_DELEGATION_BASE64`,
  `WORKER_STORACHA_SPACE_DID` — throws a named error if any are missing
- All uploads encrypted via `@storacha/encrypt-upload-client` + Lit Protocol
- All downloads decrypted via Lit before returning
- Index files maintained for list operations
- Session-level in-memory cache, invalidated on write

### Step 6 — Create Compatibility Shim (temporary)

**File to create:** `shared/src/profile-shim.ts`

```typescript
/**
 * @deprecated Compatibility shim. Replace all usages with StorachaProfileClient.
 * Deleted in Step 9.
 */
export async function getWorkerProfile(workerId: string): Promise<WorkerProfile> {
  const client = await StorachaProfileClient.fromEnv(workerId)
  return {
    identity: await client.getIdentity(),
    knowledge: await client.getKnowledge(),
    priorReasoning: await client.getAllReasoning(),
    historicalMemory: await client.getAllMemory(),
    persistentState: await client.getState(),
  }
}

export async function saveWorkerProfile(
  workerId: string,
  profile: Partial<WorkerProfile>
): Promise<void> {
  const client = await StorachaProfileClient.fromEnv(workerId)
  if (profile.identity) await client.setIdentity(profile.identity)
  if (profile.persistentState) await client.setState(profile.persistentState)
}
```

### Step 7 — One-Time Data Migration Script

**File to create:** `scripts/migrate-profile-to-storacha.ts`

1. Reads `config/profile.json`
2. For each worker, creates `StorachaProfileClient` from that worker's env vars
3. Uploads each section as a separate encrypted blob
4. Logs each returned CID
5. Outputs migration report: `{ worker, section, cid, success }[]`
6. Does NOT modify `config/profile.json`
7. Is idempotent

```bash
DOTENV_CONFIG_PATH=worker-agent/.env.worker1.local \
  tsx -r dotenv/config scripts/migrate-profile-to-storacha.ts --worker worker1
# Repeat for worker2, worker3
```

### Step 8 — Replace Call Sites with StorachaProfileClient

**Replacement order:**
1. `worker-agent/src/workers/ai-voter.ts` — replace profile.json read with
   `StorachaProfileClient.fromEnv()`, replace `fs.writeFileSync` write-back
   with `profileClient.saveReasoning()`
2. `worker-agent/src/workers/task-handler.ts` — replace profile reads/writes
3. Any remaining files from the Step 1 audit

**Final ai-voter.ts pattern:**
```typescript
// Read
const profileClient = await StorachaProfileClient.fromEnv(workerId)
const workerProfile = {
  identity: await profileClient.getIdentity(),
  knowledge: await profileClient.getKnowledge(),
  priorReasoning: await profileClient.getAllReasoning(),
  historicalMemory: await profileClient.getAllMemory(),
  persistentState: await profileClient.getState(),
}

// Use
const userMessage = buildVotePrompt(workerProfile, manifesto, proposal)

// Write back after vote
await profileClient.saveReasoning(proposalId, {
  proposalId,
  vote: result.vote,
  reasoning: result.reasoning,
  computedAt: new Date().toISOString(),
})
```

### Step 9 — Remove Legacy Artifacts

After all call sites replaced and tests pass:
1. Delete `shared/src/profile-shim.ts`
2. Remove all `fs` imports used only for profile reads/writes
3. Remove all `import profile from '../../config/profile.json'` statements
4. Add `_comment` seed file header to `config/profile.json`

### Step 10 — Update Env Vars and Docs

New vars per worker env file:
```bash
# [V2] Storacha worker identity
WORKER_STORACHA_PRIVATE_KEY=...
WORKER_STORACHA_DELEGATION_BASE64=...
WORKER_STORACHA_SPACE_DID=...
```

Update: `worker-agent/.env.worker{1,2,3}.local`, `CLAUDE.md`

### Step 11 — Verify End-to-End

```bash
./run-dev.sh

# First vote
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":"{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Fund developer education\"}}"}'

# Second vote — must show prior reasoning in AI output
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":"{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Reduce coordinator gas budget\"}}"}'
```

Verification checklist:
- [ ] Three workers produce noticeably different reasoning (distinct identities)
- [ ] Second vote AI output references the first vote outcome
- [ ] Each worker logs a Storacha CID when saving reasoning after voting
- [ ] No `fs.readFileSync` or `fs.writeFileSync` remain for profile data
- [ ] `config/profile.json` has `_comment` header and is not opened at runtime
- [ ] `profile-shim.ts` does not exist
- [ ] All three workers produce CIDs visible in Storacha space listings

---

## Files Summary

### Files to Create

| File | Purpose | Step |
|---|---|---|
| `scripts/provision-storacha-spaces.sh` | One-time space + delegation setup | 4 |
| `shared/src/storacha-profile-client.ts` | Core new abstraction — all profile I/O | 5 |
| `shared/src/profile-shim.ts` | Temporary compatibility layer (deleted in Step 9) | 6 |
| `scripts/migrate-profile-to-storacha.ts` | One-time data migration from seed file | 7 |

### Files to Modify

| File | Change | Step |
|---|---|---|
| `config/profile.json` | Fix distinct worker identities, add seed reasoning entries | 0 |
| `shared/src/types.ts` | Add `WorkerIdentity`, `KnowledgeEntry`, `ReasoningEntry`, `MemoryEntry`, `PersistentState`, `WorkerProfile` | 3 |
| `worker-agent/src/workers/ai-voter.ts` | Add `buildAgentContext`, `buildVotePrompt`, wire profile into AI call, add write-back | 2 then 8 |
| `worker-agent/src/workers/task-handler.ts` | Replace profile.json reads/writes with `StorachaProfileClient` | 8 |
| `worker-agent/.env.worker{1,2,3}.local` | Add `WORKER_STORACHA_*` env vars | 10 |
| `shared/src/constants.ts` | Add Storacha path constants | 5 |
| `CLAUDE.md` | Update env vars table, worker memory section | 10 |

### Files to Delete

| File | When |
|---|---|
| `shared/src/profile-shim.ts` | Step 9 |

### Files Explicitly NOT Deleted

| File | Reason |
|---|---|
| `config/profile.json` | Retained as static seed file for future provider migrations |

---

## Decisions That Need Confirmation Before Coding

1. **Does `config/profile.json` exist and are the three worker entries currently
   distinct?** If workers share identical values/knowledge, Step 0 must define
   genuinely different personas before any other step proceeds.

2. **Does `ai-voter.ts` currently inject any profile data into the AI call?**
   If the context injection is already partially implemented, Step 2 must
   extend it rather than replace it. Audit the exact user message construction.

3. **Where does `task-handler.ts` call into `ai-voter.ts`?**
   The `workerProfile` object must be loaded before this call and passed through.
   Identify the exact call site to determine the right injection point.

4. **Is `LOCAL_MODE=true` relevant to profile reads?**
   Recommendation: require real Storacha credentials even locally to avoid
   two code paths. Confirm before implementing.

5. **Are there files beyond `task-handler.ts` and `ai-voter.ts` that read
   profile data?** The Step 1 audit determines this. All additional files must
   be added to the Step 8 replacement order before coding begins.

---

## Definition of Done

- [ ] Three workers have distinct identities, values, and seed reasoning in `config/profile.json`
- [ ] `buildAgentContext()` and `buildVotePrompt()` exist in `ai-voter.ts`
- [ ] Every AI vote call receives real per-worker context from persistent storage
- [ ] After each vote, the result is saved back to the worker's persistent store
- [ ] Second vote run shows prior reasoning influencing AI output
- [ ] `StorachaProfileClient` is the sole interface for persistent worker state
- [ ] `config/profile.json` exists with `_comment` header, never opened at runtime
- [ ] No `fs.readFileSync` or `fs.writeFileSync` remain for profile data
- [ ] `profile-shim.ts` is deleted
- [ ] Migration report shows all sections uploaded for all three workers
- [ ] `CLAUDE.md` updated to reflect new storage model