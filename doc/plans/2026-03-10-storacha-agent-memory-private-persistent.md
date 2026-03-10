# Storacha Agent Memory — Private & Persistent Fix

**Goal:** Make agent persistent memory (manifesto, preferences, decisions, knowledge) genuinely private and reliably readable using Storacha as the canonical encrypted store.

**Architecture:**
- **Write:** `encryptAndVault()` → Lit+Storacha (decentralized encrypted backup, CID in Ensue) AND `writeAESToEnsue()` → AES-256-GCM(data) stored in Ensue (fast primary read path).
- **Read:** Ensue AES-encrypted (fast, private, reliable) → Storacha IPFS gateway (cold start / disaster recovery only) → blank (new worker).
- **Why:** `@storacha/encrypt-upload-client` always fetches via public IPFS gateways (confirmed by reading `decrypt-handler.js`). No authenticated path exists in the library today. AES-encrypted Ensue gives us private + reliable reads without waiting on Storacha team.

**Tech Stack:** TypeScript, Node.js `crypto.subtle` (built-in, zero new deps), Ensue Memory Network, `@storacha/encrypt-upload-client` (upload only), Lit Protocol (Storacha backup path).

---

## Context: Why Current Reads Fail

`decrypt-handler.js` inside `@storacha/encrypt-upload-client`:
```js
// Line 21 — always fetches from public IPFS gateway
const url = new URL(`/ipfs/${cid}?format=car`, gatewayURL);
const response = await fetch(url);
```

There is no alternative retrieval path in the library. Every read goes through public IPFS.

**Privacy gap:** The current Ensue cache stores **plaintext JSON**. Agent manifesto, preferences, and decisions are readable by anyone with Ensue API credentials. This violates the private memory requirement.

**Fix:** Store AES-256-GCM encrypted blobs in Ensue. Key is derived from `STORACHA_AGENT_PRIVATE_KEY` using HKDF. Storacha remains the decentralized backup for disaster recovery and verifiable proof.

---

## Task 1: Create `local-crypto.ts` — AES key derivation + encrypt/decrypt

**Files:**
- Create: `worker-agent/src/storacha/local-crypto.ts`

**Why:** Derives a 256-bit AES-GCM key from the agent's ed25519 private key using HMAC-SHA256 as a KDF. Uses Node.js `crypto.subtle` only — no new packages.

**Step 1: Create the file**

```typescript
// worker-agent/src/storacha/local-crypto.ts
/**
 * Local AES-256-GCM encryption using a key derived from the agent's Storacha private key.
 *
 * Used to encrypt data stored in Ensue (which is not encrypted natively).
 * This keeps agent memory private at rest without relying on external services.
 *
 * Key derivation: HMAC-SHA256(STORACHA_AGENT_PRIVATE_KEY, "delibera-ensue-cache-v1")
 * No new dependencies — uses Node.js built-in `crypto.subtle`.
 */

import { createHmac } from 'crypto';

const CONTEXT = 'delibera-ensue-cache-v1';
const ENC_PREFIX = 'aes256gcm:'; // marks encrypted values stored in Ensue

let _keyPromise: Promise<CryptoKey> | null = null;

/**
 * Derive an AES-256-GCM CryptoKey from STORACHA_AGENT_PRIVATE_KEY.
 * Returns null if the env var is not set (LOCAL_MODE without Storacha).
 */
export async function getAESKey(): Promise<CryptoKey | null> {
  const rawKey = process.env.STORACHA_AGENT_PRIVATE_KEY;
  if (!rawKey) return null;

  if (!_keyPromise) {
    _keyPromise = (async () => {
      // Decode the base64 or hex private key to bytes
      let keyBytes: Buffer;
      try {
        keyBytes = Buffer.from(rawKey, 'base64');
        if (keyBytes.length < 16) throw new Error('too short');
      } catch {
        keyBytes = Buffer.from(rawKey, 'hex');
      }

      // HMAC-SHA256 as KDF: produce a 32-byte AES key
      const aesKeyBytes = createHmac('sha256', keyBytes)
        .update(CONTEXT)
        .digest();

      return crypto.subtle.importKey(
        'raw',
        aesKeyBytes,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    })();
  }
  return _keyPromise;
}

/**
 * Encrypt a JSON-serializable value with AES-256-GCM.
 * Returns a prefixed base64 string suitable for Ensue storage.
 */
export async function encryptForEnsue(data: unknown): Promise<string> {
  const key = await getAESKey();
  if (!key) {
    // No key configured — store as plain JSON (LOCAL_MODE fallback)
    return JSON.stringify(data);
  }

  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  // Format: prefix + base64(iv || ciphertext)
  const combined = Buffer.concat([Buffer.from(iv), Buffer.from(ciphertext)]);
  return ENC_PREFIX + combined.toString('base64');
}

/**
 * Decrypt a value encrypted by `encryptForEnsue`.
 * Returns null if the value is missing, unparseable, or decryption fails.
 */
export async function decryptFromEnsue(stored: string | null | undefined): Promise<unknown | null> {
  if (!stored) return null;

  // Plain JSON fallback (no prefix, LOCAL_MODE or old plaintext cache entries)
  if (!stored.startsWith(ENC_PREFIX)) {
    if (stored.startsWith('baf')) return null; // bare CID — skip
    try { return JSON.parse(stored); } catch { return null; }
  }

  const key = await getAESKey();
  if (!key) return null;

  try {
    const combined = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    const iv = combined.subarray(0, 12);
    const ciphertext = combined.subarray(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return JSON.parse(Buffer.from(plaintext).toString('utf8'));
  } catch (e) {
    console.warn('[local-crypto] AES decryption failed:', e);
    return null;
  }
}

/** Returns true if the stored string is an AES-encrypted blob. */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX);
}
```

**Step 2: Verify TypeScript compiles**

```bash
cd worker-agent && npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors for the new file.

**Step 3: Commit**

```bash
git add worker-agent/src/storacha/local-crypto.ts
git commit -m "feat(storacha): add AES-256-GCM local crypto for private Ensue cache"
```

---

## Task 2: Replace plaintext Ensue cache with AES-encrypted cache

**Files:**
- Modify: `worker-agent/src/storacha/profile-client.ts`

**Step 1: Add import at top of profile-client.ts**

Find this existing import block:
```typescript
import { encryptAndVault, retrieveAndDecrypt, isVaultConfigured } from './vault';
import { createStorachaClient, getAgentDid, isStorachaConfigured } from './identity';
```

Add `local-crypto` import after it:
```typescript
import { encryptAndVault, retrieveAndDecrypt, isVaultConfigured } from './vault';
import { createStorachaClient, getAgentDid, isStorachaConfigured } from './identity';
import { encryptForEnsue, decryptFromEnsue } from './local-crypto';
```

**Step 2: Replace `readJsonFromEnsue` function**

Find and replace the entire `readJsonFromEnsue` function:

Old:
```typescript
async function readJsonFromEnsue(key: string): Promise<unknown | null> {
  try {
    const ensue = await getEnsue();
    const raw = await ensue.readMemory(key);
    if (!raw) return null;
    // Old format: bare CID string (starts with "bafy" or "bafk"). Skip these.
    if (typeof raw === 'string' && raw.startsWith('baf')) return null;
    // New format: JSON string
    if (typeof raw === 'string') {
      try { return JSON.parse(raw); } catch { return null; }
    }
    return raw; // already parsed object
  } catch {
    return null;
  }
}
```

New:
```typescript
/**
 * Read AES-encrypted (or plaintext-fallback) data from Ensue.
 * Returns null if key doesn't exist, is a bare CID, or decryption fails.
 */
async function readJsonFromEnsue(key: string): Promise<unknown | null> {
  try {
    const ensue = await getEnsue();
    const raw = await ensue.readMemory(key);
    if (!raw) return null;
    if (typeof raw !== 'string') return raw; // already parsed object (shouldn't happen)
    return decryptFromEnsue(raw);
  } catch {
    return null;
  }
}
```

**Step 3: Replace `writeJsonToEnsue` function**

Old:
```typescript
async function writeJsonToEnsue(key: string, data: unknown): Promise<void> {
  const ensue = await getEnsue();
  const json = typeof data === 'string' ? data : JSON.stringify(data);
  await ensue.updateMemory(key, json);
}
```

New:
```typescript
/**
 * Write AES-encrypted data to Ensue.
 * Data is encrypted before storage so Ensue never holds plaintext agent memory.
 */
async function writeJsonToEnsue(key: string, data: unknown): Promise<void> {
  const ensue = await getEnsue();
  const encrypted = await encryptForEnsue(data);
  await ensue.updateMemory(key, encrypted);
}
```

**Step 4: TypeScript compile check**

```bash
cd worker-agent && npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors.

**Step 5: Commit**

```bash
git add worker-agent/src/storacha/profile-client.ts
git commit -m "feat(storacha): encrypt agent memory in Ensue with AES-256-GCM (private cache)"
```

---

## Task 3: Flip read order — Ensue (fast/private) first, Storacha (IPFS) only as cold fallback

**Files:**
- Modify: `worker-agent/src/storacha/profile-client.ts`

**Context:** Currently each getter tries Storacha (slow/unreliable) THEN Ensue (fast). After Task 2, Ensue is now encrypted. We should read Ensue first and only attempt Storacha if Ensue is empty (cold start / disaster recovery).

**Step 1: Reorder `getManifesto()`**

Find the current `getManifesto()` method (starts around line 166). Replace the body:

Old (Storacha first → Ensue second):
```typescript
// 1. Try Storacha (primary persistent store)
if (this.useStoracha) {
  try {
    const ensue = await getEnsue();
    const cidStr = await ensue.readMemory(`agent/${this.workerId}/manifesto_cid`);
    if (cidStr && typeof cidStr === 'string' && cidStr.startsWith('baf')) {
      const manifesto = await readFromStoracha(cidStr) as AgentManifesto;
      this.cache.set('manifesto', manifesto);
      // Write-through cache to Ensue for fast reads
      writeJsonToEnsue(`agent/${this.workerId}/manifesto`, manifesto).catch(() => {});
      return manifesto;
    }
  } catch (e) {
    console.warn(`[profile:${this.workerId}] Storacha manifesto read failed:`, e);
  }
}

// 2. Try Ensue JSON cache (fast fallback)
const ensueData = await readJsonFromEnsue(`agent/${this.workerId}/manifesto`);
if (ensueData) {
  const manifesto = ensueData as AgentManifesto;
  this.cache.set('manifesto', manifesto);
  return manifesto;
}

// 3. Blank identity for new workers — owner fills in via app
console.log(`[profile:${this.workerId}] No persistent manifesto — returning blank (new worker)`);
const manifesto = blankManifesto(this.workerId);
this.cache.set('manifesto', manifesto);
return manifesto;
```

New (Ensue first → Storacha as cold fallback):
```typescript
// 1. Try Ensue encrypted cache (fast, private, reliable)
const ensueData = await readJsonFromEnsue(`agent/${this.workerId}/manifesto`);
if (ensueData) {
  const manifesto = ensueData as AgentManifesto;
  this.cache.set('manifesto', manifesto);
  return manifesto;
}

// 2. Cold start: try Storacha IPFS (disaster recovery — may be slow/unreliable)
if (this.useStoracha) {
  try {
    const ensue = await getEnsue();
    const cidStr = await ensue.readMemory(`agent/${this.workerId}/manifesto_cid`);
    if (cidStr && typeof cidStr === 'string' && cidStr.startsWith('baf')) {
      console.log(`[profile:${this.workerId}] Cold start: loading manifesto from Storacha IPFS...`);
      const manifesto = await readFromStoracha(cidStr) as AgentManifesto;
      this.cache.set('manifesto', manifesto);
      // Repopulate Ensue encrypted cache so next read is fast
      writeJsonToEnsue(`agent/${this.workerId}/manifesto`, manifesto).catch(() => {});
      return manifesto;
    }
  } catch (e) {
    console.warn(`[profile:${this.workerId}] Storacha cold read failed (non-fatal):`, e);
  }
}

// 3. Blank identity for new workers — owner fills in via app
console.log(`[profile:${this.workerId}] No persistent manifesto — returning blank (new worker)`);
const manifesto = blankManifesto(this.workerId);
this.cache.set('manifesto', manifesto);
return manifesto;
```

**Step 2: Apply the same read order to `getPreferences()`, `getAllDecisions()`, `getKnowledgeNotes()`**

Follow the exact same pattern for each:
- `getPreferences()` → key: `agent/${this.workerId}/preferences`, cid key: `agent/${this.workerId}/preferences_cid`
- `getAllDecisions()` → key: `agent/${this.workerId}/decisions`, cid key: `agent/${this.workerId}/decisions_cid`, cast to `DecisionRecord[]`
- `getKnowledgeNotes()` → key: `agent/${this.workerId}/knowledge`, cid key: `agent/${this.workerId}/knowledge_cid`, cast to `string[]`

**Step 3: TypeScript compile check**

```bash
cd worker-agent && npx tsc --noEmit 2>&1 | head -30
```
Expected: No errors.

**Step 4: Commit**

```bash
git add worker-agent/src/storacha/profile-client.ts
git commit -m "feat(storacha): read Ensue-encrypted cache first, Storacha IPFS as cold fallback"
```

---

## Task 4: Migrate existing Ensue plaintext cache entries

**Context:** Workers already have plaintext JSON in Ensue from previous runs. On first run after this update, `decryptFromEnsue()` handles this gracefully (falls through to `JSON.parse` on unencrypted strings). After any save operation, the new AES-encrypted value overwrites the old plaintext. Migration is automatic.

**Step 1: Verify graceful handling in `decryptFromEnsue`**

Confirm this branch exists in `local-crypto.ts`:
```typescript
// Plain JSON fallback (no prefix, LOCAL_MODE or old plaintext cache entries)
if (!stored.startsWith(ENC_PREFIX)) {
  if (stored.startsWith('baf')) return null; // bare CID — skip
  try { return JSON.parse(stored); } catch { return null; }
}
```

This means:
- Old `{"agentId":"...", "name":"..."}` → parsed correctly (one-time)
- Next save overwrites with `aes256gcm:...` encrypted value
- No manual migration script needed

**Step 2: Start one worker and verify it loads existing profile**

```bash
# Start worker 1
cd worker-agent && PORT=3001 WORKER_ID=worker1 \
  $(cat .env.worker1.local | grep -v '^#' | xargs) \
  npx tsx -r dotenv/config src/index.ts

# Check logs for profile load
# Expected: "[profile] Using DID-keyed Storacha persistence: did:key:z6Mku..."
# Expected: "[profile:did:key:...] No persistent manifesto" (if cache was plaintext + decrypt returned null)
#       OR: returns existing plaintext data on first read (acceptable — saves will re-encrypt)
```

**Step 3: Trigger a vote to force a save (which re-encrypts)**

```bash
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":{"type":"vote","parameters":{"proposal":"Test encrypted memory","voting_config":{"min_workers":1,"quorum":1}}}}'
```

After the vote, Ensue should now have `aes256gcm:...` prefixed values.

**Step 4: Restart the worker and verify it reads encrypted data**

```bash
# Restart worker
# Observe logs — should read from Ensue encrypted cache (not Storacha IPFS)
# Expected: No "cold start" log, no Storacha gateway fetch
```

**Step 5: Commit (no code change — validation only)**

```bash
git commit --allow-empty -m "chore: validate AES Ensue cache migration is automatic"
```

---

## Task 5: Verify Storacha backup still works (write path unchanged)

**Context:** The write path (`saveManifesto`, `savePreferences`, `saveDecision`, `appendKnowledgeNote`) should be untouched. Storacha backup (Lit-encrypted) still happens on every save. Only reads changed.

**Step 1: Check saveManifesto still writes to both**

In `profile-client.ts`, verify `saveManifesto()` still has:
```typescript
// 1. Write to Storacha (primary)
cid = await encryptAndVault(manifesto, { name: `manifesto.json` });
await ensue.updateMemory(`agent/${this.workerId}/manifesto_cid`, cid);

// 2. Write-through to Ensue cache (now AES-encrypted via writeJsonToEnsue)
await writeJsonToEnsue(`agent/${this.workerId}/manifesto`, manifesto);
```

**Step 2: Run a save and check logs**

After triggering a vote, look for:
```
[vault:worker1] Upload complete. CID: bafy...      ← Storacha backup working
[profile] Manifesto saved to Storacha (CID: bafy...) ← CID stored in Ensue
```

**Step 3: Compile check (full)**

```bash
cd worker-agent && npx tsc --noEmit 2>&1
```

Expected: 0 errors.

**Step 4: Commit**

```bash
git add worker-agent/src/storacha/
git commit -m "test(storacha): verify Storacha write path unchanged after read order fix"
```

---

## Task 6: Draft questions for Storacha team

**Context:** If we need true Storacha-first reads (without the AES-Ensue layer), we need an authenticated download API. Draft these questions for the Discord or GitHub.

**Save this file:** `doc/storacha/STORACHA_TEAM_QUESTIONS.md`

```markdown
# Questions for Storacha Team

## Context
We're building Delibera — a multi-agent DAO governance system where AI agents maintain
persistent encrypted memory (manifesto, preferences, past decisions) stored in Storacha.
We use `@storacha/encrypt-upload-client` with Lit Protocol for encryption.

Upload is working reliably. The problem is reads.

## Issue: Reads via public IPFS gateways are unreliable

Looking at `decrypt-handler.js` in `@storacha/encrypt-upload-client`, retrieval always goes through:

```js
const url = new URL(`/ipfs/${cid}?format=car`, gatewayURL);
const response = await fetch(url);
```

We experience frequent timeouts (10s+), 520 errors (Cloudflare), and corrupt CAR files from
`storacha.link`, `w3s.link`, `dweb.link`, and `ipfs.io`. Multi-gateway fallback helps but
cold reads after worker restart remain unreliable.

## Questions

### 1. Is there an authenticated download endpoint?
Is there a Storacha API endpoint (e.g. `https://up.storacha.network/`) where we can
download a CAR file using our UCAN delegation proof, bypassing public IPFS DHT?

Example of what we'd like:
```http
GET /download/{cid}
Authorization: Bearer <ucan-delegation>
Accept: application/vnd.ipld.car
```

### 2. How long until content is available at w3s.link after upload?
After `encryptAndUpload()` succeeds and returns a CID, how long should we expect before
`https://w3s.link/ipfs/{cid}?format=car` reliably returns the content?

We've seen cases where the upload succeeds but gateway returns 520 or times out for 30+ seconds.

### 3. Does `@storacha/client` have any retrieval capability?
Looking at the client API, we only see upload and management methods. Is there a `client.get(cid)`
or similar for authenticated retrieval that bypasses public IPFS?

### 4. Are there plans for an authenticated gateway?
Given that UCAN proofs authenticate uploads, is an authenticated download endpoint on the roadmap?
This would let us verify the requester has access to the space before serving content — stronger
than IPFS public gateways.

### 5. Should we use a specific CID format for reliable retrieval?
Should we upload as UnixFS or raw blocks? Does `?format=car&dag-scope=block` improve reliability?

## Current Workaround
We're storing AES-256-GCM encrypted blobs in Ensue Memory Network (our coordination cache)
as the primary read path, with Storacha as the decentralized backup. This works but bypasses
the decentralized read path.

Any guidance on making Storacha reads as reliable as writes would be very helpful!
```

**Step 2: Commit**

```bash
git add doc/storacha/STORACHA_TEAM_QUESTIONS.md
git commit -m "docs(storacha): draft team questions for authenticated retrieval"
```

---

## Summary

| Task | What it does | Files changed |
|------|--------------|---------------|
| 1 | AES-256-GCM key derivation from agent private key | `local-crypto.ts` (new) |
| 2 | Replace plaintext Ensue cache with AES-encrypted | `profile-client.ts` |
| 3 | Flip read order: Ensue first, Storacha as cold fallback | `profile-client.ts` |
| 4 | Automatic migration of old plaintext entries | (no code, validation) |
| 5 | Verify Storacha backup (write path) unchanged | (no code, verification) |
| 6 | Draft Storacha team questions | `STORACHA_TEAM_QUESTIONS.md` (new) |

**Result after Tasks 1-5:**
- Agent memory is **private** (AES-encrypted at rest in Ensue — no plaintext)
- Agent memory is **reliably readable** (Ensue, not IPFS gateways)
- Agent memory is **persistently backed up** (Storacha, Lit-encrypted, decentralized)
- Storacha gateway reads still happen as cold-start fallback — will improve when Storacha team provides authenticated endpoint

**What to tell Storacha team:** Send the questions from Task 6. The key ask is an authenticated download endpoint. Link them to `doc/storacha/STORACHA_TEAM_QUESTIONS.md`.
