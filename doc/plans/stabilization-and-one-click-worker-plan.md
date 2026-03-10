# Plan: Delibera Stabilization — Testing, One-Click Worker, Human Names

## Purpose
This document is for **Claude Code plan mode**.
Read it fully before proposing changes.
Do not write code until audit questions are answered and plan is confirmed.

This plan has three parts executed in order:
1. **Stabilization** — test and harden everything already built
2. **One-click worker CLI** — make joining permissionless in practice
3. **Human-readable worker names** — display names layered over DIDs

---

## Part 1: Stabilization — Test What's Already Built

Before adding anything new, every completed feature needs a passing test
and a verified happy path. If any feature fails its test, fix it before
moving to Part 2.

### Audit Required

Claude Code must run and report on each of the following:

#### 1.1 — Full E2E Vote Flow
```bash
./run-dev.sh
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":"{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Stabilization test proposal\"}}"}'
curl http://localhost:3000/api/coordinate/status
```
Expected: proposal reaches `Finalized` state on-chain, tally visible in response.
Report: pass / fail / error output.

#### 1.2 — Permissionless Worker Registration
Start only 2 workers, trigger a vote, confirm `workerCount: 2` in tally.
Then register a 3rd worker, trigger another vote, confirm `workerCount: 3`.
Report: pass / fail.

#### 1.3 — Storacha + Lit Encrypted Persistence
After a vote completes, confirm:
- Each worker logged a Storacha CID in its output
- The CID is retrievable and decryptable
- Prior reasoning from the previous vote appears in the next vote's AI context

Report: CIDs produced, decryption succeeds / fails.

#### 1.4 — Registry Contract
```bash
near view registry.agents-coordinator.testnet get_workers_for_coordinator \
  '{"coordinator_did": "<YOUR_COORDINATOR_DID>"}'
near view registry.agents-coordinator.testnet get_coordinator_by_did \
  '{"coordinator_did": "<YOUR_COORDINATOR_DID>"}'
```
Expected: returns correct records with `worker_did` and `coordinator_did` fields.
Report: pass / fail / actual output.

### Stabilization Fixes

For each test that fails in the audit above, open a fix before proceeding.
Document each fix in a `FIXES.md` file:
```markdown
## Fix: [feature name]
- **Symptom:** what failed
- **Root cause:** why
- **Change:** what was changed and in which file
- **Verified:** re-run output confirming fix
```

Do not proceed to Part 2 until all 4 audit items pass.

---

## Part 2: One-Click Worker Buy Flow

### No CLI — Frontend Only

**The CLI is out of scope for this iteration.**
The entire provisioning flow lives in the `/buy` page and a backend
provisioning API. No terminal. No env files. No manual key generation.
The user connects a wallet, fills a form, and clicks deploy.

---

### The Current Problem in Detail

Becoming a worker currently requires:

```
Manual step 1:  storacha key create               (terminal)
Manual step 2:  storacha space create ...          (terminal)
Manual step 3:  storacha delegation create ...     (terminal)
Manual step 4:  base64 delegation.car              (terminal)
Manual step 5:  Edit .env.workerN.local with 6+ vars (text editor)
Manual step 6:  Deploy to Phala via dashboard      (browser)
Manual step 7:  Wait 3–10 min for Phala URL        (waiting)
Manual step 8:  near call register_worker ...      (terminal)
Manual step 9:  Update registry with Phala URL     (terminal)
Manual step 10: Verify coordinator sees the worker (terminal)
```

Every one of these steps is a drop-off point. The goal is zero manual steps.

---

### Target UX: Five Screens

**Screen 1 — Entry**
```
┌─────────────────────────────────────┐
│  🤖 Deploy a Delibera Worker        │
│                                     │
│  Join a coordination network and    │
│  earn rewards for voting on         │
│  governance proposals.              │
│                                     │
│  Cost: ~1.5 NEAR (0.7 deposit +    │
│         gas + Phala credits)        │
│                                     │
│  [Connect NEAR Wallet]              │
└─────────────────────────────────────┘
```

**Screen 2 — Configuration**
```
┌─────────────────────────────────────┐
│  Configure Your Worker              │
│                                     │
│  Worker name                        │
│  [Alice's Voter              ]      │
│                                     │
│  Join coordinator                   │
│  [Delibera Default (3 workers) ▼]  │
│                                     │
│  Your NEAR account                  │
│  alice.testnet ✓ (4.2 NEAR)        │
│                                     │
│  [Deploy Worker →]                  │
└─────────────────────────────────────┘
```

**Screen 3 — Provisioning Progress**
```
┌─────────────────────────────────────┐
│  Deploying your worker...           │
│                                     │
│  ✅ Generating worker identity      │
│  ✅ Creating Storacha space         │
│  ✅ Generating UCAN delegation      │
│  ✅ Preparing Phala deployment      │
│  ⏳ Deploying to Phala TEE...       │
│     (this takes 3–10 minutes)       │
│  ○  Waiting for public URL          │
│  ○  Registering on NEAR             │
│  ○  Saving worker identity          │
│  ○  Verifying connection            │
│                                     │
│  You can close this tab. We will    │
│  complete setup in the background.  │
└─────────────────────────────────────┘
```

**Screen 4 — Awaiting NEAR Wallet Signature**
```
┌─────────────────────────────────────┐
│  ✅ Worker deployed!                │
│                                     │
│  One last step: sign the            │
│  registration transaction in your  │
│  NEAR wallet to pay the 0.7 NEAR   │
│  deposit and activate your worker.  │
│                                     │
│  [Sign with NEAR Wallet →]          │
└─────────────────────────────────────┘
```

**Screen 5 — Success**
```
┌─────────────────────────────────────┐
│  ✅ Worker Active!                  │
│                                     │
│  Alice's Voter is live and          │
│  connected to Delibera Default.     │
│                                     │
│  Worker DID                         │
│  did:key:z6Mk...hX9a  [copy]       │
│                                     │
│  Phala endpoint                     │
│  https://worker-xyz.phala.network   │
│                                     │
│  ⬇ Download recovery file          │
│                                     │
│  [View in Dashboard →]              │
└─────────────────────────────────────┘
```

**Screen 6 — Error / Retry**
```
┌─────────────────────────────────────┐
│  ⚠️ Deployment timed out            │
│                                     │
│  Phala is taking longer than usual. │
│  Your worker may still be starting. │
│                                     │
│  Worker DID: did:key:z6Mk...hX9a   │
│                                     │
│  [Check Status]  [Retry]            │
└─────────────────────────────────────┘
```

---

### Key Design Decisions

**1. Keys are generated client-side in the browser.**
`WORKER_STORACHA_PRIVATE_KEY` is generated using the Web Crypto API
in the browser. It is never sent to the backend. The backend receives
only the public DID derived from the key. The private key is shown
once on Screen 5 as a downloadable recovery file.

**2. Phala deployment is async with background polling.**
The existing `watchForEndpoint()` pattern (up to 10 min) is reused.
Screen 3 shows live step progress. If the user closes the tab, a
`GET /api/provision/status/:jobId` lets them resume. Job ID is stored
in `localStorage`.

**3. NEAR wallet signs the registration transaction.**
The 0.7 NEAR deposit and `register_worker()` call are triggered via
NEAR Wallet Selector on Screen 4. The backend never holds the user's
NEAR keys. The backend prepares the unsigned transaction; the user
signs in the wallet popup; the signed tx is sent back for broadcast.
This is a deliberate separate screen — the user must consciously
approve the on-chain payment after seeing the Phala endpoint is live.

**4. The backend assembles all env vars for Phala.**
All worker env vars (Storacha keys, Ensue credentials, NEAR RPC,
registry contract ID, coordinator DID) are assembled server-side
and injected into the Phala CVM compose file at provision time.
The user never sees or edits these.

**5. Recovery file on success.**
Screen 5 offers a `worker-recovery.json` download:
```json
{
  "workerDid": "did:key:z6Mk...",
  "displayName": "Alice's Voter",
  "coordinatorDid": "did:key:z6Mk...",
  "phalaEndpoint": "https://worker-xyz.phala.network",
  "cvmId": "cvm_abc123",
  "nearAccount": "alice.testnet",
  "registeredAt": "2026-03-06T10:00:00.000Z",
  "note": "Keep this file. Private key was shown separately — store it securely."
}
```

---

### Backend Provisioning API

**New file:** `coordinator-agent/src/routes/provision.ts`

```
POST /api/provision/worker
  Body: {
    workerDid: string,        // generated client-side
    coordinatorDid: string,   // selected from registry dropdown
    displayName: string,
    nearAccount: string,
    didSignature: string,     // DID signs nearAccount (Option B binding)
  }
  Response: { jobId: string, status: "provisioning" }

GET /api/provision/status/:jobId
  Response: {
    jobId: string,
    status: "creating_space" | "deploying_phala" | "waiting_for_url"
          | "awaiting_near_signature" | "registering" | "saving_identity"
          | "verifying" | "complete" | "failed",
    step: string,             // human-readable label for progress screen
    phalaEndpoint?: string,   // present when URL is found
    unsignedTx?: object,      // present at awaiting_near_signature step
    cvmId?: string,
    error?: string,
  }

POST /api/provision/register
  Body: {
    jobId: string,
    signedTransaction: string,  // NEAR wallet-signed register_worker tx
  }
  Response: { status: "registered", txHash: string }
```

**Provisioning job lifecycle (backend):**
```typescript
// coordinator-agent/src/lib/provision-worker.ts

async function provisionWorker(job: ProvisionJob): Promise<void> {
  // 1. Create Storacha space for the worker's DID (backend-side)
  await updateJob(job.id, "creating_space")
  const { spaceDid, delegationBase64 } = await createStorachaSpace(job.workerDid)

  // 2. Assemble all env vars for the Phala CVM compose file
  await updateJob(job.id, "preparing_phala")
  const envVars = assembleWorkerEnvVars({
    workerDid: job.workerDid,
    storachaSpaceDid: spaceDid,
    storachaDelegation: delegationBase64,
    coordinatorDid: job.coordinatorDid,
    nearAccount: job.nearAccount,
    // System constants injected from coordinator's own env:
    ensueApiKey: process.env.ENSUE_API_KEY,
    nearNetwork: process.env.NEAR_NETWORK,
    registryContractId: process.env.REGISTRY_CONTRACT_ID,
    nearRpcUrl: process.env.NEAR_RPC_URL,
  })

  // 3. Deploy Phala CVM with assembled env vars
  await updateJob(job.id, "deploying_phala")
  const { cvmId } = await deployPhalaCvm(envVars)  // reuse existing Phala logic

  // 4. Poll for public URL (reuses existing watchForEndpoint)
  await updateJob(job.id, "waiting_for_url")
  const endpoint = await waitForPhalaEndpoint(cvmId)  // up to 10 min

  // 5. Signal frontend to trigger NEAR wallet transaction
  //    Backend cannot sign — user must sign with their wallet
  const unsignedTx = buildRegisterWorkerTx({
    workerDid: job.workerDid,
    coordinatorDid: job.coordinatorDid,
    endpointUrl: endpoint,
    cvmId,
    didSignature: job.didSignature,
  })
  await updateJob(job.id, "awaiting_near_signature", { phalaEndpoint: endpoint, unsignedTx })

  // Execution pauses here. Resumes when POST /api/provision/register is called.
}

// Called after user signs in wallet
async function completeRegistration(job: ProvisionJob, signedTx: string): Promise<void> {
  await updateJob(job.id, "registering")
  const txHash = await broadcastNearTx(signedTx)

  await updateJob(job.id, "saving_identity")
  await saveWorkerDisplayName(job.workerDid, job.displayName)

  await updateJob(job.id, "verifying")
  await verifyWorkerRegistered(job.workerDid, job.coordinatorDid)

  await updateJob(job.id, "complete", { txHash })
}
```

---

### Frontend File Structure

```
frontend/src/app/buy/
  page.tsx                          # Screen state machine
  components/
    EntryScreen.tsx                 # Screen 1 — connect wallet
    ConfigScreen.tsx                # Screen 2 — name, coordinator, deploy button
    ProgressScreen.tsx              # Screen 3 — polls status, shows steps
    AwaitingSignatureScreen.tsx     # Screen 4 — NEAR wallet sign
    SuccessScreen.tsx               # Screen 5 — worker active, download
    ErrorScreen.tsx                 # Screen 6 — timeout / retry
  hooks/
    useProvisionJob.ts              # Polls GET /api/provision/status/:jobId every 5s
    useWorkerKeyGen.ts              # Web Crypto ed25519 keygen in browser
  utils/
    recovery-file.ts                # Generates and downloads worker-recovery.json
    near-tx.ts                      # Builds unsigned register_worker tx for wallet
```

**Screen state machine:**
```typescript
type Screen =
  | "entry"               // wallet not connected
  | "config"              // wallet connected, fill form
  | "provisioning"        // job running, watching progress
  | "awaiting_signature"  // Phala URL found, need wallet sign
  | "success"             // fully registered and live
  | "error"               // timeout or failure

// Persisted in localStorage:
//   delibera_provision_job_id    — resume after tab close
//   delibera_provision_worker_did — for recovery file
```

---

### Implementation Steps for Part 2

#### Step 2.1 — Audit existing /buy page and Phala code
Read `frontend/src/app/buy/page.tsx` in full.
Search for `watchForEndpoint`, `deployPhalaCvm`, `phala` across
`coordinator-agent/src/`.
Report exactly what exists vs what needs to be written.
Do not proceed until audit is complete.

#### Step 2.2 — Create browser key generation hook
`frontend/src/app/buy/hooks/useWorkerKeyGen.ts`
Uses Web Crypto API to generate an ed25519 keypair.
Returns `{ workerDid, privateKeyBase64 }`.
Private key held in React state only — never sent to backend.

#### Step 2.3 — Create provisioning API routes
`coordinator-agent/src/routes/provision.ts`
`POST /api/provision/worker`, `GET /api/provision/status/:jobId`,
`POST /api/provision/register`.
Job state stored in a `Map<jobId, ProvisionJob>` in memory.

#### Step 2.4 — Create NEAR transaction builder
`frontend/src/app/buy/utils/near-tx.ts`
Builds the unsigned `register_worker` transaction for wallet signing.
Also generates and attaches `did_signature` (Option B DID binding).

#### Step 2.5 — Implement provision job lifecycle
`coordinator-agent/src/lib/provision-worker.ts`
Full `provisionWorker()` and `completeRegistration()` functions.
Reuses `watchForEndpoint()` and Phala deploy code found in Step 2.1 audit.

#### Step 2.6 — Build all screen components
Create the six screen components and two hooks listed in the file structure.
`ProgressScreen` polls `GET /api/provision/status/:jobId` every 5s
and maps status strings to the visual step list.

#### Step 2.7 — Wire screen state machine in page.tsx
Update `frontend/src/app/buy/page.tsx` to orchestrate all six screens.
Persist `jobId` and `workerDid` to `localStorage` for tab-close recovery.

#### Step 2.8 — Implement recovery file download
`frontend/src/app/buy/utils/recovery-file.ts`
Generates `worker-recovery.json` and triggers browser download on Screen 5.

#### Step 2.9 — End-to-end test on testnet
Run the full flow manually:
1. Open `/buy`, connect wallet
2. Fill name and coordinator, click Deploy
3. Watch all progress steps complete
4. Sign NEAR wallet transaction
5. Confirm worker in coordinator dashboard
6. Trigger a vote — confirm new worker participates

## Part 3: Human-Readable Worker Names

### Design: DID is Identity, Name is a Label

The DID never changes and is the canonical identifier everywhere in the
protocol. Display names are mutable labels stored in each participant's
Storacha space. They are:
- Set at registration time (via CLI `--name` or frontend form)
- Editable by the worker/coordinator who owns the space
- Readable by anyone who knows the DID (public metadata, not encrypted)
- Cached locally by the frontend to avoid repeated Storacha fetches

### Name Storage Schema

In each worker's Storacha space:
```
storacha-space (worker)
  identity/
    did.json              # existing: DID and public key
    display-name.json     # new: human-readable name and metadata
```

`display-name.json` schema:
```json
{
  "name": "Alice's Voter",
  "shortName": "Alice",
  "updatedAt": "2026-03-06T10:00:00.000Z",
  "version": 1
}
```

This file is uploaded **without Lit encryption** — display names are public
metadata. Everyone can read them. Only the owner (the worker with the
matching DID) can write to this space.

### Name Resolution

The coordinator maintains a name cache. On startup and after each registry
query, it resolves names for all known worker DIDs:

```typescript
// shared/src/name-resolver.ts

export class NameResolver {
  private cache: Map<string, string> = new Map()
  // key: workerDID, value: display name

  async resolveName(did: string): Promise<string> {
    if (this.cache.has(did)) return this.cache.get(did)!

    try {
      const spaceDID = await this.getSpaceForDid(did)  // from registry
      const nameFile = await storachaClient.retrieve(`${spaceDID}/identity/display-name.json`)
      const { name } = JSON.parse(nameFile)
      this.cache.set(did, name)
      return name
    } catch {
      // Fallback: truncated DID
      const short = `${did.substring(0, 12)}...${did.substring(did.length - 6)}`
      this.cache.set(did, short)
      return short
    }
  }

  async resolveAll(dids: string[]): Promise<Map<string, string>> {
    await Promise.all(dids.map(did => this.resolveName(did)))
    return this.cache
  }

  invalidate(did: string): void {
    this.cache.delete(did)
  }
}
```

### Display Name Everywhere

Once `NameResolver` exists, all places that currently show a DID get updated:

**Ensue tally output** — the tally written to Ensue after a vote includes
resolved names alongside DIDs:
```json
{
  "approved": 2,
  "rejected": 1,
  "decision": "Approved",
  "workerCount": 3,
  "workers": [
    {
      "did": "did:key:z6Mk...",
      "name": "Alice's Voter",
      "vote": "Approved"
    }
  ]
}
```

**Frontend coordinator dashboard** — worker cards show name prominently,
DID shown as secondary info (truncated, copyable on click).

**Frontend worker dashboard** — each worker sees its own name and can
edit it inline.

**CLI output** — `delibera coordinator workers` shows:
```
NAME              DID                    STATUS    JOINED
Alice's Voter     did:key:z6Mk...hX9a   active    2026-03-01
Bob's Node        did:key:z6Mk...pQ2b   active    2026-03-03
did:key:z6Mk...   did:key:z6Mk...rT7c   active    2026-03-05
```
(third worker hasn't set a name — falls back to truncated DID)

### Editing Names

**Via CLI:**
```bash
delibera worker rename "My New Worker Name"
# Loads WORKER_STORACHA_PRIVATE_KEY from .env.worker.local
# Uploads new display-name.json to worker's Storacha space
# Invalidates coordinator's name cache (coordinator re-fetches on next query)
```

**Via frontend:**
Each worker card in the dashboard has an edit icon next to the name.
Clicking it opens an inline edit field. On save, it calls:
`PATCH /api/workers/{did}/name` → updates Storacha space.

**Via coordinator dashboard:**
Coordinators can see worker names but cannot edit them — they can only
read. Only the worker that owns a space can write to it (UCAN enforcement).

### Implementation Steps for Part 3

#### Step 3.1 — Add display-name.json to worker Storacha space
Update `StorachaProfileClient` to include `getDisplayName()` and
`setDisplayName(name: string)` methods. Display name is uploaded without
Lit encryption (public metadata).

#### Step 3.2 — Create NameResolver
`shared/src/name-resolver.ts`
Implements cache-first name resolution with DID truncation fallback.

#### Step 3.3 — Update tally output
`coordinator-agent/src/monitor/memory-monitor.ts`
Resolve worker names before writing tally to Ensue and before
calling `coordinator_resume`.

#### Step 3.4 — Update frontend worker cards
Replace raw DID display with resolved name (prominent) + truncated DID
(secondary, copyable). Add edit button for workers viewing their own card.

#### Step 3.5 — Add name edit API route
`coordinator-agent/src/routes/workers.ts` (new or existing)
`PATCH /api/workers/:did/name` — validates the caller owns the DID,
updates Storacha space, invalidates name cache.

#### Step 3.6 — Update CLI output
`delibera coordinator workers` and `delibera worker status` show
resolved names in tabular format.

#### Step 3.7 — Wire CLI `worker rename` command
Already scaffolded in Part 2. Implement the Storacha write for name update.

---

## Files Summary

### Part 1 — Stabilization
| File | Action |
|---|---|
| `FIXES.md` | Create — document any fixes found during audit |

### Part 2 — One-Click Buy Frontend
| File | Action | Step |
|---|---|---|
| `frontend/src/app/buy/page.tsx` | Modify — screen state machine | 2.7 |
| `frontend/src/app/buy/components/EntryScreen.tsx` | Create | 2.6 |
| `frontend/src/app/buy/components/ConfigScreen.tsx` | Create | 2.6 |
| `frontend/src/app/buy/components/ProgressScreen.tsx` | Create | 2.6 |
| `frontend/src/app/buy/components/SuccessScreen.tsx` | Create | 2.6 |
| `frontend/src/app/buy/components/ErrorScreen.tsx` | Create | 2.6 |
| `frontend/src/app/buy/hooks/useProvisionJob.ts` | Create | 2.6 |
| `frontend/src/app/buy/hooks/useWorkerKeyGen.ts` | Create | 2.2 |
| `frontend/src/app/buy/utils/recovery-file.ts` | Create | 2.8 |
| `frontend/src/app/buy/utils/near-tx.ts` | Create | 2.4 |
| `coordinator-agent/src/routes/provision.ts` | Create — provision API | 2.3 |
| `coordinator-agent/src/lib/provision-worker.ts` | Create — job lifecycle | 2.5 |

### Part 3 — Human Names
| File | Action | Step |
|---|---|---|
| `shared/src/name-resolver.ts` | Create | 3.2 |
| `shared/src/storacha-profile-client.ts` | Modify — add `getDisplayName`, `setDisplayName` | 3.1 |
| `coordinator-agent/src/monitor/memory-monitor.ts` | Modify — resolve names in tally | 3.3 |
| `frontend/src/app/components/WorkerCard.tsx` | Modify — name display + edit | 3.4 |
| `coordinator-agent/src/routes/workers.ts` | Create or modify — PATCH name endpoint | 3.5 |
| `frontend/src/app/buy/components/SuccessScreen.tsx` | Modify — wire rename via name edit | 3.7 |

### Docs to Update
| File | Changes |
|---|---|
| `CLAUDE.md` | Add buy flow section, name resolution pattern, updated env vars |
| `IMPLEMENTATION_PLAN.md` | Mark stabilization complete, add buy flow and names as Phase 2.5 |
| `README.md` | Add "Getting Started" section pointing to `/buy` page |

---

## Confirmation Questions Before Coding

1. **Do all 4 stabilization audit items pass on the current codebase?**
   Run them and report before Part 2 begins. If any fail, fix and
   document in `FIXES.md` before proceeding.

2. **How is the binding between `did:key` and NEAR AccountID currently
   established and verified in the registry contract?**

   This is a critical security question. The registry stores both
   `worker_did: String` and `account_id: AccountId` on the same record,
   but that alone does not prove the caller who submits `register_worker()`
   from `alice.testnet` is the same entity that controls `did:key:z6Mk...`.
   Without a cryptographic binding, any NEAR account could claim any DID
   (DID squatting attack).

   Claude Code must inspect `registry-contract/src/lib.rs` and answer:

   **a) What does `register_worker()` currently validate?**
   - Does it verify that the caller (`env::predecessor_account_id()`) owns
     the `worker_did` they are registering?
   - Or does it accept any `worker_did` string from any caller, storing
     it with no ownership proof?

   **b) Is there a cross-signature or attestation step?**
   - Does the function require a signature over the NEAR AccountID made
     by the `did:key` private key (proving DID controls the claim)?
   - Does it require a signature over the `worker_did` made by the NEAR
     account's private key (proving NEAR controls the claim)?
   - Or is the binding purely by convention — the contract trusts that
     whoever calls it owns the DID they claim?

   **c) In production (Phala TEE), does DCAP attestation serve as the
   implicit binding?**
   - If both the DID private key and the NEAR signing key are generated
     inside the same Phala enclave, the DCAP quote covers both.
     The contract's existing `assert_coordinator()` / codehash check
     may already enforce this implicitly for coordinators.
   - Does the same attestation path exist for workers, or only coordinators?

   **Expected finding:** The current implementation likely uses convention
   only (Option C below) — the contract stores both fields but does not
   verify ownership of the DID claim. Report what you actually find.

   **The four binding options, for reference:**

   | Option | Mechanism | On-chain verification | Security level |
   |---|---|---|---|
   | A | NEAR signs DID claim | Contract verifies ed25519 sig | Strong, complex |
   | B | DID signs NEAR account claim | Signature stored, verified off-chain | Moderate, simple |
   | C | Convention only | None — trust the caller | Weak, vulnerable to DID squatting |
   | D | TEE DCAP attestation | Codehash + collateral check | Strong for Phala, local dev excluded |

   **Recommendation for this iteration:** Implement Option B.
   During `register_worker()`, require the caller to submit a
   `did_signature` field: the NEAR AccountID string signed by the
   `did:key` private key using ed25519. Store this signature in the
   `WorkerRecord`. The registry contract does not verify it on-chain
   (avoiding complex crypto in Rust), but the CLI generates it and any
   observer can verify off-chain that the DID attests to the NEAR account.
   This closes the DID squatting vector with minimal contract complexity.

   In production with Phala, Option D (DCAP) provides the stronger
   on-chain binding through the existing codehash mechanism and supersedes
   Option B. Both can coexist — `did_signature` covers local dev,
   DCAP covers production Phala.

   **Upgrade path marker — required in code:**
   Wherever Option B is implemented in the CLI and registry contract,
   add this exact comment so the Option D upgrade is never lost as
   tribal knowledge:

   ```typescript
   // BINDING: Option B (DID signs NEAR AccountID) — sufficient for local dev and testnet.
   // TODO Option D: When worker Phala deployment is active, replace with DCAP attestation.
   //   - Enclave sets report_data = sha256(worker_did + ":" + near_account_id) at boot
   //   - Registry contract verifies DCAP quote using dcap-qvl (same as coordinator path)
   //   - did_signature field can remain on WorkerRecord as fallback for non-TEE contexts
   //   - Reference: coordinator-contract/src/lib.rs assert_coordinator() for the pattern
   ```

   This comment goes in three places:
   - `frontend/src/app/buy/utils/near-tx.ts` — at the tx builder for `register_worker`
   - `registry-contract/src/lib.rs` — at the `register_worker()` function
   - `CLAUDE.md` — in the identity binding section

   **What the frontend must do in `near-tx.ts`:**
   ```typescript
   // frontend/src/app/buy/utils/near-tx.ts

   // 1. Generate DID keypair (Storacha)
   const { did, privateKey } = await generateWorkerIdentity()

   // 2. Sign the NEAR AccountID with the DID private key
   //    Proves: "the entity controlling this DID attests to this NEAR account"
   const message = `delibera:register:${nearAccountId}:${did}`
   const didSignature = await signWithDidKey(privateKey, message)

   // 3. Submit registration with binding proof
   await nearCall({
     methodName: 'register_worker',
     args: {
       coordinator_did: coordinatorDid,
       worker_did: did,
       did_signature: didSignature,   // binding proof
       endpoint_url: endpointUrl,
       cvm_id: cvmId,
     },
     deposit: '700000000000000000000000'
   })
   ```

   The `WorkerRecord` in the registry stores `did_signature` alongside
   `worker_did` and `account_id`. Anyone calling `get_worker_by_did()`
   receives all three and can verify the binding off-chain.

   **Before implementing anything:** Report which option the current
   contract uses, whether `did_signature` field exists, and whether any
   verification logic exists for the DID claim.

3. **What does the existing `/buy` page currently do, and what Phala deploy
   logic already exists in the codebase?**
   Read `frontend/src/app/buy/page.tsx` in full.
   Also search for `watchForEndpoint`, `deployPhalaCvm`, `phala` across
   `coordinator-agent/src/` to inventory what already exists.
   Report: what is already implemented, what the page currently renders,
   and which provisioning steps already have code vs need to be written.
   Do not duplicate existing logic — extend it.

4. **How does Phala CVM provisioning currently work, and what env vars
   does it inject into the deployed container?**
   Read the existing Phala deploy code in `coordinator-agent/src/`.
   Report: what API is called to deploy a CVM, how env vars are passed
   to the container, and what the current `watchForEndpoint()` polling
   implementation looks like.
   This determines what `assembleWorkerEnvVars()` must produce and
   whether the Phala deploy path needs to be extended or just reused.

5. **Does the coordinator agent already expose a provisioning API route,
   or does `POST /api/provision/worker` need to be created from scratch?**
   Search `coordinator-agent/src/routes/` for any existing provision,
   deploy, or worker registration endpoints.
   Report: existing routes and their current behavior.

6. **Where does the worker's Storacha space DID get stored in the registry?**
   The `NameResolver` needs to look up a worker's space DID from their
   worker DID to fetch their display name. Confirm whether the registry
   `WorkerRecord` already contains `storacha_space_did` or if it needs
   to be added.

7. **Should worker names be on-chain or off-chain only?**
   Recommendation: off-chain in Storacha only (no contract change, instant
   updates, no gas cost). On-chain names would require a contract update
   and add latency. Confirm before implementing `NameResolver`.

---

## Definition of Done

### Part 1
- [ ] All 4 stabilization audit items pass
- [ ] `FIXES.md` documents any fixes applied
- [ ] E2E vote completes cleanly from `./run-dev.sh`

### Part 2
- [ ] User connects NEAR wallet, fills form, clicks Deploy — no terminal required
- [ ] Browser generates worker keypair client-side (private key never sent to backend)
- [ ] Backend assembles all worker env vars and deploys Phala CVM
- [ ] Progress screen polls job status and shows each step completing in real time
- [ ] Flow handles Phala URL delay gracefully (up to 10 min, tab-close safe)
- [ ] NEAR wallet signs `register_worker` transaction with 0.7 NEAR deposit
- [ ] `did_signature` generated in browser and submitted with registration
- [ ] `WorkerRecord` stores `did_signature` alongside `worker_did` and `account_id`
- [ ] Success screen shows worker DID, Phala endpoint, recovery file download
- [ ] New worker appears in coordinator dashboard and participates in next vote
- [ ] Flow documented in `README.md` ("Getting Started" section)

### Part 3
- [ ] Workers have display names stored in Storacha
- [ ] Coordinator resolves names from DIDs with cache
- [ ] Frontend shows names prominently, DIDs as secondary
- [ ] Workers can rename themselves via the dashboard and buy flow
- [ ] Tally output includes resolved names alongside DIDs
- [ ] Name edit is enforced by UCAN — only owner can write