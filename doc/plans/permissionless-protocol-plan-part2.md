# Plan: Buy Flow — Worker and Coordinator Deploy Pages

## Purpose
This document is for **Claude Code plan mode**.
Read it fully before proposing any changes.
Answer all audit questions from the codebase before writing any code.

This plan extends the existing `/buy` worker flow to support two separate
deploy experiences:
- `/buy/worker` — deploy and register a voter worker (existing, needs cleanup)
- `/buy/coordinator` — deploy and register a coordinator (new)

Both follow the same permissionless model: pay a deposit, deploy infrastructure,
register on-chain, done. No approval needed.

The two flows differ significantly in complexity:

```
Worker flow:
  1. Generate Storacha identity (client-side)
  2. Create Storacha space (backend)
  3. Deploy worker agent to Phala CVM (backend)
  4. Sign register_worker tx with NEAR wallet (frontend)

Coordinator flow:
  1. Generate Storacha identity (client-side)
  2. Create Storacha space (backend)
  3. Provision Ensue org + API key via agent-register (backend)
  4. Deploy coordinator contract on NEAR — wallet is owner (frontend wallet tx)
  5. Deploy coordinator agent to Phala CVM (backend)
  6. Sign register_coordinator tx with NEAR wallet (frontend)
```

✅ **Ensue provisioning is resolved.** Each coordinator self-registers a new
Ensue org via `POST /auth/agent-register` — no admin key needed. The API key
is injected into the Phala env vars immediately but remains inactive until
the operator claims it via email. See the Ensue section below for full details.

---

## Audit Required Before Planning

Claude Code must read and report on the following before writing any code.

### 1. Existing /buy page
Read `frontend/src/app/buy/page.tsx` in full.
Report:
- What does it currently render?
- Does it already handle worker provisioning or is it a placeholder?
- What Phala deploy logic is already wired?
- What NEAR wallet integration exists?

### 2. Existing provisioning backend
Search `coordinator-agent/src/` for:
- Any existing provision/deploy API routes
- `watchForEndpoint`, `deployPhalaCvm`, or any Phala deploy logic
- Any registry contract call helpers

Report exactly what exists so nothing gets duplicated.

### 3. Registry contract
Read `registry-contract/src/lib.rs`.
Report:
- Current `register_worker` arguments and deposit requirement
- Current `register_coordinator` arguments and deposit requirement
- Whether `min_workers` and `max_workers` are already on `CoordinatorRecord`
- Current deposit amounts for each role

### 4. Coordinator contract
Read `coordinator-contract/src/lib.rs`.
Report whether any coordinator-specific setup is needed at registration time
beyond what the registry stores.

Do not write any code until audit findings are reported and confirmed.

---

## Page Structure

### Entry Point: /buy

`/buy` is a simple landing page that presents the two roles and routes to
the correct flow. It does not have its own provisioning logic.

```
frontend/src/app/buy/
  page.tsx                          # Landing — choose Worker or Coordinator
  worker/
    page.tsx                        # Worker deploy flow
    components/
      EntryScreen.tsx
      ConfigScreen.tsx
      ProgressScreen.tsx
      AwaitingSignatureScreen.tsx
      SuccessScreen.tsx
      ErrorScreen.tsx
    hooks/
      useProvisionJob.ts
      useWorkerKeyGen.ts
    utils/
      recovery-file.ts
      near-tx.ts
  coordinator/
    page.tsx                        # Coordinator deploy flow
    components/
      EntryScreen.tsx
      ConfigScreen.tsx
      ProgressScreen.tsx
      AwaitingSignatureScreen.tsx
      SuccessScreen.tsx
      ErrorScreen.tsx
    hooks/
      useProvisionJob.ts
      useCoordinatorKeyGen.ts
    utils/
      recovery-file.ts
      near-tx.ts
```

Shared hooks and utils that are identical between the two flows live in:
```
frontend/src/app/buy/shared/
  useKeyGen.ts                      # Web Crypto keygen — same for both roles
  useProvisionJob.ts                # Job polling — same for both roles
  recovery-file.ts                  # Recovery file generator — parameterized
  near-tx.ts                        # Tx builder — parameterized by role
```

---

## /buy Landing Page

Simple role selector. No wallet connection needed yet.

```
┌─────────────────────────────────────────────────┐
│  🤖 Join Delibera                               │
│                                                 │
│  What would you like to deploy?                 │
│                                                 │
│  ┌─────────────────────┐ ┌───────────────────┐  │
│  │  🗳️ Worker          │ │  🏛️ Coordinator   │  │
│  │                     │ │                   │  │
│  │  Vote on governance │ │  Run a            │  │
│  │  proposals on       │ │  coordination     │  │
│  │  behalf of others   │ │  network for      │  │
│  │                     │ │  a DAO or         │  │
│  │  Deposit: 0.7 NEAR  │ │  community        │  │
│  │                     │ │                   │  │
│  │                     │ │  Deposit: 2 NEAR  │  │
│  │  [Deploy Worker →]  │ │  [Deploy Coord →] │  │
│  └─────────────────────┘ └───────────────────┘  │
└─────────────────────────────────────────────────┘
```

Clicking either card navigates to `/buy/worker` or `/buy/coordinator`.

---

## /buy/worker Flow

This is the flow already planned in `plan-stabilization.md`.
Reproduced here for completeness with one structural change:
the flow now lives at `/buy/worker` not `/buy`.

### Screens (same as stabilization plan)

**Screen 1 — Entry:** Connect NEAR wallet
**Screen 2 — Config:**
```
  Worker name         [Alice's Voter        ]
  Join coordinator    [Delibera Default ▼   ]  ← dropdown from registry
```
**Screen 3 — Progress:** Step-by-step deploy status
**Screen 4 — Awaiting signature:** NEAR wallet signs register_worker tx
**Screen 5 — Success:** Worker DID, Phala endpoint, recovery file download
**Screen 6 — Error:** Timeout / retry

### Worker Config Fields
| Field | Type | Source |
|---|---|---|
| Worker name | Text input | User |
| Coordinator | Dropdown | Registry: `get_active_coordinators()` |

### Worker Deposit
0.7 NEAR (confirm exact amount from registry contract audit)

---

## /buy/coordinator Flow

Same structure as the worker flow. Different config fields, larger deposit,
different Phala compose file, different registry call.

### Coordinator Contract Deploy

Each coordinator owns their own instance of the coordinator contract.
The wallet that signs and pays for the deploy transaction is set as the
contract owner. This gives each coordinator full sovereignty over their
deliberation network — their proposals, their workers, their state.

**What this means for the flow:**
The coordinator contract deploy is a NEAR transaction that happens
*before* the Phala CVM is deployed. The contract address (AccountID)
is then injected as an env var into the Phala coordinator agent so
it knows which contract to interact with.

The deploy uses NEAR's `create_account` + `deploy_contract` pattern:
```
coordinator-{randomSuffix}.agents-coordinator.testnet
  owner: alice.testnet (the connected wallet)
  contract: coordinator contract WASM (pinned version)
```

This transaction is the first wallet signature step — before Phala,
before registry. The flow becomes:

```
Screen 2 (config) → Screen 3 (deploy contract — wallet signs) →
Screen 4 (Phala deploy progress) → Screen 5 (register — wallet signs) →
Screen 6 (success)
```

Two wallet signatures total for coordinators (vs one for workers):
1. Deploy coordinator contract (creates their sovereign contract instance)
2. Register on the registry with 2 NEAR deposit

**Contract AccountID** is shown on the success screen and included
in the recovery file. It's the address DAOs will use to submit proposals.

---

### Ensue Org Provisioning

✅ **Resolved — Outcome A.** Each coordinator gets their own isolated Ensue org
via the `agent-register` endpoint. No admin key needed. No external dependency.

Each coordinator agent needs its own Ensue org to avoid state collision with
other coordinators. The provisioning backend calls `agent-register` during
the deploy flow to create a new org and obtain an API key.

**Important caveat:** The API key is **inactive** until a human claims it
via email verification. The buy flow must surface the claim URL and
verification code on the success screen so the operator can activate it.
The coordinator agent will deploy and register successfully, but Ensue
memory will not work until the claim step is complete.

```typescript
// coordinator-agent/src/lib/ensue.ts

export async function provisionCoordinatorEnsueOrg(coordinatorDid: string): Promise<{
  apiKey: string,
  claimUrl: string,
  verificationCode: string,
  orgName: string,
}> {
  // No auth needed — agent-register is a public endpoint
  const res = await fetch('https://api.ensue-network.ai/auth/agent-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // alphanumeric + hyphens/underscores, max 64 chars
      name: `delibera-coord-${coordinatorDid.slice(-12).replace(/[^a-z0-9]/gi, '')}`,
    }),
  })
  const data = await res.json()

  // API key is shown ONCE — must be stored immediately
  return {
    apiKey: data.agent.api_key,
    claimUrl: data.agent.claim_url,
    verificationCode: data.agent.verification_code,
    orgName: `delibera-coord-${coordinatorDid.slice(-12).replace(/[^a-z0-9]/gi, '')}`,
  }
}
```

**Once the coordinator is live, run these one-time setup calls** to grant
workers read access and make proposal results publicly readable:

```typescript
// coordinator-agent/src/lib/ensue.ts

export async function setupCoordinatorEnsuePermissions(apiKey: string): Promise<void> {
  // Called automatically by the coordinator agent on first startup
  // after the operator has claimed the Ensue org

  const call = (tool: string, args: object) => fetch('https://api.ensue-network.ai/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: tool, arguments: args }, id: 1 }),
  })

  // Create a group for workers to auto-join
  await call('share', { command: JSON.stringify({ command: 'create_group', group_name: 'workers' }) })

  // Grant workers read access to coordination namespace
  await call('share', { command: JSON.stringify({
    command: 'grant',
    target: { type: 'group', group_name: 'workers' },
    action: 'read',
    key_pattern: 'coordination/',
  })})

  // Auto-assign external orgs (workers) to the workers group
  await call('share', { command: JSON.stringify({ command: 'set_external_group', group_name: 'workers' }) })

  // Make proposal results publicly readable (no API key needed)
  await call('share', { command: JSON.stringify({ command: 'make_public', key_pattern: 'public/proposals/' }) })
}
```

**`setupCoordinatorEnsuePermissions` is called once on coordinator startup**
after detecting the Ensue org is active (API key works). Store a flag in
Storacha (`identity/ensue-setup-complete`) to avoid running it more than once.

---

### Screens

**Screen 1 — Entry**
```
┌─────────────────────────────────────┐
│  🏛️ Deploy a Coordinator           │
│                                     │
│  Run a coordination network.        │
│  Workers will join your network     │
│  and vote on proposals you receive  │
│  from DAOs and communities.         │
│                                     │
│  Deposit: 2 NEAR                    │
│                                     │
│  [Connect NEAR Wallet]              │
└─────────────────────────────────────┘
```

**Screen 2 — Config**
```
┌─────────────────────────────────────┐
│  Configure Your Coordinator         │
│                                     │
│  Coordinator name                   │
│  [My Coordination Network    ]      │
│                                     │
│  Minimum workers to accept votes    │
│  [  1  ] ▲▼                        │
│                                     │
│  Maximum workers in your network   │
│  [ 10  ] ▲▼                        │
│                                     │
│  Your NEAR account                  │
│  alice.testnet ✓ (5.1 NEAR)        │
│                                     │
│  [Deploy Coordinator →]             │
└─────────────────────────────────────┘
```

**Screen 3 — Sign Contract Deploy (wallet tx #1)**
```
┌─────────────────────────────────────┐
│  Step 1 of 2: Deploy your contract  │
│                                     │
│  This creates your own coordinator  │
│  contract on NEAR. You will be      │
│  the owner.                         │
│                                     │
│  Contract address:                  │
│  coord-x7k2.agents-coord.testnet    │
│                                     │
│  [Sign with NEAR Wallet →]          │
└─────────────────────────────────────┘
```

**Screen 4 — Progress (Phala deploy)**
```
┌─────────────────────────────────────┐
│  Deploying your coordinator...      │
│                                     │
│  ✅ Generating coordinator identity │
│  ✅ Creating Storacha space         │
│  ✅ Generating UCAN delegation      │
│  ✅ Provisioning coordination state │
│  ✅ Deploying coordinator contract  │
│  ⏳ Deploying to Phala TEE...       │
│     (this takes 3–10 minutes)       │
│  ○  Waiting for public URL          │
│  ○  Registering on NEAR             │
│  ○  Saving coordinator identity     │
│  ○  Verifying                       │
│                                     │
│  You can close this tab.            │
└─────────────────────────────────────┘
```

**Screen 5 — Sign Registry Registration (wallet tx #2)**
```
┌─────────────────────────────────────┐
│  Step 2 of 2: Activate your         │
│  coordinator                        │
│                                     │
│  ✅ Phala agent is live             │
│  https://coord-xyz.phala.network    │
│                                     │
│  Sign to register on the network    │
│  and pay the 2 NEAR deposit.        │
│                                     │
│  [Sign with NEAR Wallet →]          │
└─────────────────────────────────────┘
```

**Screen 6 — Success**
```
┌─────────────────────────────────────┐
│  ✅ Coordinator Active!             │
│                                     │
│  My Coordination Network is live.   │
│                                     │
│  Coordinator DID                    │
│  did:key:z6Mk...hX9a  [copy]       │
│                                     │
│  Contract address                   │
│  coord-x7k2.agents-coord.testnet    │
│                                     │
│  Phala endpoint                     │
│  https://coord-xyz.phala.network    │
│                                     │
│  Min workers: 1  /  Max: 10        │
│                                     │
│  ────────────────────────────────── │
│  ⚠️ One more step — activate memory │
│                                     │
│  Your coordinator needs memory      │
│  to function. Visit this link and   │
│  enter the code to activate it:     │
│                                     │
│  https://ensue-network.ai/claim?... │
│  Code: a1b2c3d4          [copy]    │
│                                     │
│  (included in your recovery file)   │
│  ────────────────────────────────── │
│                                     │
│  ⬇ Download recovery file          │
│                                     │
│  [View in Dashboard →]              │
└─────────────────────────────────────┘
```

**Screen 6 — Error / Retry** (same pattern as worker)

### Coordinator Config Fields
| Field | Type | Validation | Default |
|---|---|---|---|
| Coordinator name | Text input | Required, max 50 chars | — |
| Min workers | Number input | 1–20, must be ≤ max | 1 |
| Max workers | Number input | 1–50, must be ≥ min | 10 |

### Coordinator Deposit
2 NEAR (confirm exact amount from registry contract audit — if not set,
recommend 2 NEAR as it reflects higher responsibility than a worker)

---

## Backend Provisioning API

Both roles use the same API shape. Role is passed as a parameter.

### Shared API Routes

```
POST /api/provision/worker
POST /api/provision/coordinator

  Both accept:
  {
    did: string,              // generated client-side
    displayName: string,
    nearAccount: string,
    didSignature: string,     // Option B DID↔NEAR binding
    role: "worker" | "coordinator"
  }

  Worker-specific fields:
  {
    coordinatorDid: string,   // which coordinator to join
  }

  Coordinator-specific fields:
  {
    minWorkers: number,
    maxWorkers: number,
  }

  Response: { jobId: string, status: "provisioning" }

GET /api/provision/status/:jobId
  Response: {
    jobId: string,
    role: "worker" | "coordinator",
    status: "creating_space" | "deploying_phala" | "waiting_for_url"
          | "awaiting_near_signature" | "registering" | "saving_identity"
          | "verifying" | "complete" | "failed",
    step: string,
    phalaEndpoint?: string,
    unsignedTx?: object,
    cvmId?: string,
    error?: string,
  }

POST /api/provision/register
  Body: { jobId: string, signedTransaction: string }
  Response: { status: "registered", txHash: string }
```

### Provisioning Job Lifecycle

The worker and coordinator flows are identical except for:
1. Which Phala compose file is used (worker vs coordinator image)
2. Which env vars are assembled (coordinator gets `MIN_WORKERS`, `MAX_WORKERS`)
3. Which registry method is called (`register_worker` vs `register_coordinator`)
4. Deposit amount

```typescript
// coordinator-agent/src/lib/provision.ts

async function provisionRole(job: ProvisionJob): Promise<void> {
  // 1. Create Storacha space (same for both roles)
  await updateJob(job.id, "creating_space")
  const { spaceDid, delegationBase64 } = await createStorachaSpace(job.did)

  // 1b. Provision Ensue org (coordinator only)
  let ensueApiKey: string | undefined
  let ensueOrgName: string | undefined
  let ensueClaimUrl: string | undefined
  let ensueVerificationCode: string | undefined

  if (job.role === "coordinator") {
    await updateJob(job.id, "provisioning_ensue")
    const ensueOrg = await provisionCoordinatorEnsueOrg(job.did)
    ensueApiKey = ensueOrg.apiKey          // inactive until claimed — store it now
    ensueOrgName = ensueOrg.orgName
    ensueClaimUrl = ensueOrg.claimUrl      // shown on success screen
    ensueVerificationCode = ensueOrg.verificationCode  // shown on success screen
  }

  // 2. Assemble env vars — role-specific
  await updateJob(job.id, "preparing_phala")
  const envVars = job.role === "worker"
    ? assembleWorkerEnvVars({ ...job, spaceDid, delegationBase64 })
    : assembleCoordinatorEnvVars({ ...job, spaceDid, delegationBase64, ensueApiKey, ensueOrgName })

  // 3. Deploy correct Phala image for role
  await updateJob(job.id, "deploying_phala")
  const composeFile = job.role === "worker"
    ? process.env.WORKER_PHALA_COMPOSE_FILE
    : process.env.COORDINATOR_PHALA_COMPOSE_FILE
  const { cvmId } = await deployPhalaCvm(envVars, composeFile)

  // 4. Poll for URL (same for both)
  await updateJob(job.id, "waiting_for_url")
  const endpoint = await waitForPhalaEndpoint(cvmId)

  // 5. Build unsigned NEAR tx — role-specific method and deposit
  const unsignedTx = job.role === "worker"
    ? buildRegisterWorkerTx({ ...job, endpoint, cvmId })
    : buildRegisterCoordinatorTx({ ...job, endpoint, cvmId })

  await updateJob(job.id, "awaiting_near_signature", { phalaEndpoint: endpoint, unsignedTx })
}

async function completeRegistration(job: ProvisionJob, signedTx: string): Promise<void> {
  await updateJob(job.id, "registering")
  const txHash = await broadcastNearTx(signedTx)

  await updateJob(job.id, "saving_identity")
  await saveDisplayName(job.did, job.displayName, job.role)

  await updateJob(job.id, "verifying")
  await verifyRegistered(job.did, job.role)

  // For coordinators: include Ensue claim info in completion payload
  // so the success screen can display it to the operator
  await updateJob(job.id, "complete", {
    txHash,
    ...(job.role === "coordinator" && {
      ensueClaimUrl: job.ensueClaimUrl,
      ensueVerificationCode: job.ensueVerificationCode,
      ensueOrgName: job.ensueOrgName,
    })
  })
}
```

### Coordinator-Specific Env Vars for Phala

```typescript
function assembleCoordinatorEnvVars(job: CoordinatorProvisionJob) {
  return {
    COORDINATOR_STORACHA_PRIVATE_KEY: job.privateKeyBase64,  // not stored server-side
    COORDINATOR_STORACHA_SPACE_DID: job.spaceDid,
    COORDINATOR_STORACHA_DELEGATION_BASE64: job.delegationBase64,
    COORDINATOR_DID: job.did,
    NEAR_ACCOUNT_ID: job.nearAccount,
    MIN_WORKERS: String(job.minWorkers),
    MAX_WORKERS: String(job.maxWorkers),
    REGISTRY_CONTRACT_ID: process.env.REGISTRY_CONTRACT_ID,
    NEAR_NETWORK: process.env.NEAR_NETWORK,
    NEAR_RPC_URL: process.env.NEAR_RPC_URL,
    // Each coordinator has their own Ensue org — NOT the shared system key
    ENSUE_API_KEY: job.ensueApiKey,
    ENSUE_ORG_NAME: job.ensueOrgName,
  }
}
```

---

## Recovery Files

**Worker recovery file** (`worker-recovery.json`):
```json
{
  "role": "worker",
  "workerDid": "did:key:z6Mk...",
  "displayName": "Alice's Voter",
  "coordinatorDid": "did:key:z6Mk...",
  "phalaEndpoint": "https://worker-xyz.phala.network",
  "cvmId": "cvm_abc123",
  "nearAccount": "alice.testnet",
  "registeredAt": "2026-03-11T10:00:00.000Z"
}
```

**Coordinator recovery file** (`coordinator-recovery.json`):
```json
{
  "role": "coordinator",
  "coordinatorDid": "did:key:z6Mk...",
  "displayName": "My Coordination Network",
  "contractAddress": "coord-x7k2.agents-coordinator.testnet",
  "minWorkers": 1,
  "maxWorkers": 10,
  "phalaEndpoint": "https://coord-xyz.phala.network",
  "cvmId": "cvm_def456",
  "ensueTreeId": "tree_abc123",
  "nearAccount": "alice.testnet",
  "registeredAt": "2026-03-11T10:00:00.000Z",
  "note": "contractAddress is what DAOs use to submit proposals to your network."
}
```

Both files exclude the private key. Private key is shown once on the
success screen and the user is responsible for saving it separately.

---

## Shared Logic — What Can Be Reused

The following is identical between worker and coordinator flows and must
NOT be duplicated:

| Module | Location | Reused by |
|---|---|---|
| Web Crypto keygen | `buy/shared/useKeyGen.ts` | Both flows |
| Job status polling | `buy/shared/useProvisionJob.ts` | Both flows |
| Storacha space creation | `coordinator-agent/src/lib/storacha.ts` | Both flows |
| Phala deploy + URL polling | `coordinator-agent/src/lib/phala.ts` | Both flows |
| NEAR tx broadcast | `coordinator-agent/src/lib/near.ts` | Both flows |
| Display name save | `coordinator-agent/src/lib/identity.ts` | Both flows |
| DID signature (Option B) | `buy/shared/near-tx.ts` | Both flows |

---

## Files to Create / Modify

### New Files
| File | Purpose |
|---|---|
| `frontend/src/app/buy/page.tsx` | Landing — role selector |
| `frontend/src/app/buy/shared/useKeyGen.ts` | Shared Web Crypto keygen |
| `frontend/src/app/buy/shared/useProvisionJob.ts` | Shared job polling |
| `frontend/src/app/buy/shared/near-tx.ts` | Shared tx builder (parameterized) |
| `frontend/src/app/buy/shared/recovery-file.ts` | Shared recovery file (parameterized) |
| `frontend/src/app/buy/worker/page.tsx` | Worker flow state machine |
| `frontend/src/app/buy/worker/components/*.tsx` | 6 worker screens |
| `frontend/src/app/buy/coordinator/page.tsx` | Coordinator flow state machine |
| `frontend/src/app/buy/coordinator/components/*.tsx` | 6 coordinator screens |
| `coordinator-agent/src/routes/provision.ts` | Provision API routes |
| `coordinator-agent/src/lib/provision.ts` | Job lifecycle (role-parameterized) |

### Files to Modify
| File | Change |
|---|---|
| `frontend/src/app/buy/page.tsx` | Replace with landing/role selector (if currently worker flow) |
| `coordinator-agent/src/routes/index.ts` | Register new provision routes |

---

## Implementation Steps

### Step 1 — Audit (no code)
Answer all audit questions above. Report findings before proceeding.

### Step 2 — Shared backend lib
Extract or create shared provisioning logic in `coordinator-agent/src/lib/`:
- `storacha.ts` — space creation, delegation
- `phala.ts` — deploy + `waitForPhalaEndpoint`
- `near.ts` — tx builder, broadcast
- `identity.ts` — display name save to Storacha
- `provision.ts` — `provisionRole()`, `completeRegistration()`

Reuse any existing code found in audit. Do not duplicate.

### Step 3 — Provision API routes
Create `coordinator-agent/src/routes/provision.ts` with:
- `POST /api/provision/worker`
- `POST /api/provision/coordinator`
- `GET /api/provision/status/:jobId`
- `POST /api/provision/register`

### Step 4 — Shared frontend modules
Create `frontend/src/app/buy/shared/`:
- `useKeyGen.ts` — Web Crypto ed25519 keygen
- `useProvisionJob.ts` — polls status every 5s
- `near-tx.ts` — builds unsigned tx, generates `did_signature`
- `recovery-file.ts` — generates and downloads recovery JSON

### Step 5 — /buy landing page
Replace or create `frontend/src/app/buy/page.tsx` with the role selector UI.
Two cards: Worker and Coordinator, each routing to their sub-page.

### Step 6 — Worker flow at /buy/worker
Move existing worker buy flow (if any) to `/buy/worker/page.tsx`.
Build all 6 screen components using shared modules from Step 4.

### Step 7 — Coordinator flow at /buy/coordinator
Build `/buy/coordinator/page.tsx` and all 6 screen components.
Config screen has name, min workers, max workers fields.
Reuses shared modules from Step 4.

### Step 8 — End-to-end test: worker
Full flow on testnet: connect wallet → configure → deploy → sign → verify
worker appears in coordinator dashboard and participates in a vote.

### Step 9 — End-to-end test: coordinator
Full flow on testnet: connect wallet → configure → deploy → sign → verify
coordinator appears in registry and can receive worker registrations.

### Step 10 — Update docs
Update `CLAUDE.md` and `IMPLEMENTATION_PLAN.md` to reflect both buy flows.

---

## Confirmation Questions Before Coding

1. **What does the current `frontend/src/app/buy/page.tsx` contain?**
   Is it already the worker flow, a placeholder, or something else?
   This determines whether Step 5 is a replacement or a new file.

2. **What are the exact deposit amounts in the registry contract?**
   Confirm `register_worker` deposit and `register_coordinator` deposit
   from `registry-contract/src/lib.rs`. If `register_coordinator` deposit
   is not yet set to a higher amount than workers, recommend 2 NEAR and
   confirm before deploying.

3. **Does `register_coordinator` already accept `min_workers` and
   `max_workers` arguments?**
   If not, the registry contract needs a small update before Step 7 can work.
   Flag this as a blocker and update the contract first.

4. **Are there two separate Phala compose files for worker and coordinator,
   or one shared file?**
   The provisioning backend needs to know which image to deploy for each role.
   Confirm the compose file paths and whether they are already parameterized.

5. **Does the coordinator agent already self-register on startup?**
   If yes, deploying a coordinator via the buy flow may conflict with the
   existing startup registration logic. Confirm and align before Step 7.

6. **Is there a pinned coordinator contract WASM available for deployment?**
   The coordinator buy flow deploys a new contract instance per coordinator.
   Confirm where the coordinator contract WASM is stored (IPFS CID, URL, or
   bundled in the repo) and what the exact NEAR `create_account` + `deploy`
   pattern looks like for this project. This determines how Screen 3 (wallet
   tx #1) builds the deploy transaction.

7. **Ensue provisioning is resolved — implement using `agent-register`.**
   Each coordinator calls `POST https://api.ensue-network.ai/auth/agent-register`
   during provisioning to create their own Ensue org and receive an API key.
   The key is inactive until the operator claims it via the returned `claim_url`.
   The claim URL and verification code must be stored in the job and surfaced
   on the success screen. See the Ensue Org Provisioning section above and
   the Ensue skill at `.claude/skills/ensue/SKILL.md` for full implementation.

---

## Definition of Done

- [ ] `/buy` landing page shows Worker and Coordinator cards clearly
- [ ] `/buy/worker` full flow works end-to-end on testnet
- [ ] `/buy/coordinator` full flow works end-to-end on testnet
- [ ] Both flows share keygen, polling, tx builder, recovery file logic
- [ ] No provisioning logic duplicated between worker and coordinator paths
- [ ] Coordinator config (name, min/max workers) correctly injected into Phala
- [ ] Both recovery files download correctly on success screen
- [ ] Each coordinator has their own sovereign coordinator contract (wallet = owner)
- [ ] Contract address shown on success screen and in recovery file
- [ ] Each coordinator has their own Ensue org provisioned via `agent-register`
- [ ] Ensue API key (inactive) injected into coordinator Phala env vars at deploy time
- [ ] Claim URL and verification code shown on coordinator success screen
- [ ] `setupCoordinatorEnsuePermissions()` runs on first coordinator startup after claim
- [ ] Workers can read coordinator state via cross-org `@org-name/` prefix after joining
- [ ] New coordinator appears in registry and accepts worker registrations
- [ ] New worker appears in coordinator dashboard and votes on next proposal
- [ ] `CLAUDE.md` updated
- [ ] `IMPLEMENTATION_PLAN.md` updated