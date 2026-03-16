---
name: storacha-space-setup
description: "Set up a new Storacha space for a Delibera worker agent — including space creation, UCAN delegation, Lit Protocol encryption config, AES-256-GCM Ensue cache encryption, and profile migration. Use this skill whenever provisioning a new worker agent, replacing a broken Storacha space, setting up agent persistent memory, configuring Storacha+Lit for a new identity, or migrating profile data to encrypted storage. Also use when debugging Storacha read/write issues, UCAN delegation problems, or Lit access control failures."
---

# Storacha Space Setup for Delibera Workers

End-to-end guide for creating a new Storacha space, configuring encryption, and seeding agent memory for a Delibera worker. Covers CLI commands, UCAN delegation, Lit Protocol, AES-256-GCM cache encryption, and the migration script.

## Architecture Overview

Delibera uses a **two-tier encrypted storage** model:

| Tier | System | Encryption | Purpose |
|------|--------|-----------|---------|
| Hot (fast reads) | Ensue Memory Network | AES-256-GCM (per-worker key) | Primary read path, real-time coordination |
| Warm (decentralized backup) | Storacha + Lit Protocol | Lit threshold encryption | Persistent backup, human-injectable knowledge |

**Read order:** Ensue AES-encrypted cache first → Storacha IPFS cold fallback → blank identity (new workers).

**Write order:** Storacha (Lit-encrypted) first → Ensue (AES-encrypted cache) second.

**Why two tiers:** Storacha IPFS gateway reads are unreliable (timeouts, corrupt CAR files from `storacha.link`, `w3s.link`, `dweb.link`, `ipfs.io`). Ensue provides fast, reliable reads. Storacha provides decentralized persistence and human knowledge injection via UCAN.

## Step 1: Create a New Storacha Space

```bash
# Install CLI if needed
npm install -g @storacha/cli

# Login (one-time)
storacha login you@email.com

# Create space — MUST use --no-recovery to avoid interactive TTY prompt
storacha space create <space-name> --no-recovery

# Space names are globally unique — if taken, try a variant
# e.g., "delibera-worker1" taken → try "delibera-w1-new" or "delibera-w1-v2"
```

**Output:** Space DID like `did:key:z6Mk...` — save this as `STORACHA_SPACE_DID`.

### Common errors

| Error | Fix |
|-------|-----|
| Interactive prompt hangs | Add `--no-recovery` flag |
| Name already taken | Use a different name variant |
| Not logged in | Run `storacha login <email>` first |

## Step 2: Provision the Space

```bash
# Provision with Storacha provider (required before any uploads)
storacha space provision --provider did:web:storacha.network
```

This registers the space with Storacha's storage provider so uploads are accepted.

## Step 3: Create UCAN Delegation for the Worker DID

Each worker has a sovereign DID derived from its `STORACHA_AGENT_PRIVATE_KEY`. The worker needs a UCAN delegation granting it access to the space.

```bash
# First, find the worker's DID from its private key
# (logged at worker startup, or derive from key)

# Create delegation with ALL required capabilities
storacha delegation create <WORKER_DID> \
  --can 'space/blob/add' \
  --can 'space/index/add' \
  --can 'upload/add' \
  --can 'upload/list' \
  --can 'space/content/decrypt' \
  --base64
```

**Output:** Base64 string → set as `STORACHA_DELEGATION_PROOF` in worker env.

### Required capabilities explained

| Capability | Purpose |
|-----------|---------|
| `space/blob/add` | Upload encrypted blobs |
| `space/index/add` | Add entries to space index |
| `upload/add` | Register uploads |
| `upload/list` | List uploads (for verification) |
| `space/content/decrypt` | **CRITICAL** — required for Lit threshold decryption reads |

Missing `space/content/decrypt` = reads silently fail and fall back to blank identity.

## Step 4: Update Worker Environment Variables

In the worker's `.env` file (e.g., `.env.worker1.local`):

```bash
# Storacha Worker Identity
STORACHA_AGENT_PRIVATE_KEY=MgCZ...   # From: storacha key create (unique per worker)
STORACHA_DELEGATION_PROOF=mAYIEA...  # From Step 3
STORACHA_SPACE_DID=did:key:z6Mk...   # From Step 1
```

**The worker DID is derived from `STORACHA_AGENT_PRIVATE_KEY` at runtime** — you never set it directly. The identity module (`worker-agent/src/storacha/identity.ts`) handles this.

## Step 5: Seed Profile Data (Migration)

Run the migration script to seed the worker's profile from `profiles.json` into both Storacha (Lit-encrypted) and Ensue (AES-encrypted):

```bash
# Run from project root
cd worker-agent
DOTENV_CONFIG_PATH=.env.worker1.local \
  npx tsx -r dotenv/config ../scripts/migrate-profiles-to-storacha.ts --worker worker1
```

**What the script does:**
1. Reads `worker-agent/config/profiles.json` for the specified worker
2. Resolves the worker DID from `STORACHA_AGENT_PRIVATE_KEY`
3. Encrypts + uploads 4 sections to Storacha via Lit: manifesto, preferences, decisions, knowledge
4. Writes AES-256-GCM encrypted copies to Ensue at `agent/{workerDID}/manifesto`, etc.
5. Stores CID pointers in Ensue at `agent/{workerDID}/manifesto_cid`, etc.
6. Sets display name at `agent/{workerDID}/display_name`

**Idempotent** — safe to re-run; overwrites with fresh data.

### Common migration errors

| Error | Fix |
|-------|-----|
| `Cannot find module 'dotenv/config'` | Run from `worker-agent/` dir where dotenv is installed |
| `Worker "workerX" not found in profiles.json` | Check `config/profiles.json` has that key |
| Storacha upload fails | Verify space is provisioned (Step 2) and delegation is valid |

## AES-256-GCM Encryption (Ensue Cache)

All Ensue cache entries are encrypted with AES-256-GCM. The key is derived from the worker's `STORACHA_AGENT_PRIVATE_KEY`:

```
HMAC-SHA256(privateKeyBytes, "delibera-ensue-aes-key") → 256-bit AES key
```

**Implementation:** `worker-agent/src/storacha/local-crypto.ts`

- `encryptForEnsue(data)` → `"aes256gcm:<base64(iv+ciphertext+tag)>"`
- `decryptFromEnsue(stored)` → parsed JSON object

**Backward compatible:** `decryptFromEnsue` handles:
- `null` → returns `null`
- Bare CIDs (`bafy...`) → returns `null` (legacy pointer, not data)
- Plain JSON strings → parses directly (pre-encryption legacy)
- `aes256gcm:` prefixed → decrypts

## Lit Protocol Configuration

- **Network:** `nagaDev` (free, no relay API key needed for testing). SDK v8+ renamed: `datil` → `naga`, `datil-dev` → `naga-dev`.
- **Per-worker auth storage:** `.lit-auth-storage-{WORKER_ID}` directory avoids conflicts when running multiple workers on one machine
- For runtime encrypt/upload/decrypt API details, see the **storacha-vault** skill.

## ESM-Only Import Pattern

`@storacha/client` and related packages are ESM-only. This project uses CommonJS. Use this pattern in all files that import ESM packages:

```typescript
// Prevents tsc from compiling import() → require()
const dynamicImport = new Function('specifier', 'return import(specifier)');

// Usage
const { Client } = await dynamicImport('@storacha/client');
```

**Why:** `tsc` with `"module": "commonjs"` compiles `await import(...)` → `require(...)`, which fails at runtime with `ERR_PACKAGE_PATH_NOT_EXPORTED` for ESM-only packages.

## Ensue Key Layout (DID-keyed)

```
agent/{workerDID}/
  display_name       "Worker Name"          (public, unencrypted)
  manifesto          aes256gcm:...          (AES-encrypted AgentManifesto)
  preferences        aes256gcm:...          (AES-encrypted AgentPreferences)
  decisions          aes256gcm:...          (AES-encrypted DecisionRecord[])
  knowledge          aes256gcm:...          (AES-encrypted string[])
  manifesto_cid      bafy...                (Storacha CID pointer)
  preferences_cid    bafy...                (Storacha CID pointer)
  decisions_cid      bafy...                (Storacha CID pointer)
  knowledge_cid      bafy...                (Storacha CID pointer)
```

## Key Files

| File | Purpose |
|------|---------|
| `worker-agent/src/storacha/identity.ts` | DID derivation from private key, Storacha client creation |
| `worker-agent/src/storacha/vault.ts` | Lit encrypt/upload/decrypt with multi-gateway fallback |
| `worker-agent/src/storacha/local-crypto.ts` | AES-256-GCM for Ensue cache |
| `worker-agent/src/storacha/profile-client.ts` | StorachaProfileClient — orchestrates reads/writes across both tiers |
| `worker-agent/src/storacha/agent-identity.ts` | Public API: loadIdentity, recordDecision, formatIdentityContext |
| `scripts/migrate-profiles-to-storacha.ts` | One-time profile seeding script |
| `worker-agent/config/profiles.json` | Seed data (name, role, values, weights) |

## Checklist for New Worker Setup

1. [ ] Generate private key: `storacha key create` → `STORACHA_AGENT_PRIVATE_KEY`
2. [ ] Note the DID from the key output
3. [ ] Create space: `storacha space create <name> --no-recovery`
4. [ ] Provision: `storacha space provision --provider did:web:storacha.network`
5. [ ] Create delegation with all 5 capabilities (including `space/content/decrypt`)
6. [ ] Set env vars: `STORACHA_AGENT_PRIVATE_KEY`, `STORACHA_DELEGATION_PROOF`, `STORACHA_SPACE_DID`
7. [ ] Add worker profile to `config/profiles.json` (or skip for blank identity)
8. [ ] Run migration: `npx tsx -r dotenv/config ../scripts/migrate-profiles-to-storacha.ts --worker <id>`
9. [ ] Verify: start worker, check logs for successful identity load

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Worker starts with blank identity | Missing/expired delegation | Re-create delegation with all 5 capabilities |
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | Direct `import()` compiled to `require()` | Use `dynamicImport` pattern |
| Storacha upload succeeds but read fails | IPFS gateway timeout | Normal — Ensue cache is the primary read path |
| `decryptFromEnsue` returns null for CID | Bare CID stored (legacy) | Re-run migration to write AES-encrypted data |
| Lit auth error | Wrong network or stale auth | Delete `.lit-auth-storage-*` dir, retry with `nagaDev` |
| Multiple workers conflict on same machine | Shared Lit auth storage | Each worker uses `.lit-auth-storage-{WORKER_ID}` |
