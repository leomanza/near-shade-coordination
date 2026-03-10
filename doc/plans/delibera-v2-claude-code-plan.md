# Delibera V2: Claude Code Implementation Plan
## PL Genesis — Frontiers of Collaboration Hackathon

> **Migration Target:** `NEAR + NOVA SDK + Phala + Ensue + PingPay` → `NEAR + Storacha + Lit Protocol + Phala + Ensue + Zama FHE + Filecoin + Flow VRF`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Environment Setup](#2-environment-setup)
3. [Claude Code Configuration (`.claude.json`)](#3-claude-code-configuration)
4. [Project Rules (`CLAUDE.md`)](#4-project-rules-claudemd)
5. [Custom Skills (`.claude/skills/`)](#5-custom-skills)
6. [Step-by-Step Workflow for Claude Code](#6-step-by-step-workflow)
7. [Bounty Targets & Checklist](#7-bounty-targets--checklist)

---

## 1. Architecture Overview

### What Changes vs. What Stays

| Layer | Legacy (Sandbox) | New (PL Genesis) | Status |
|---|---|---|---|
| **Ledger / Orchestration** | NEAR Protocol + NEAR AI | NEAR Protocol + NEAR AI | ✅ Keep |
| **File Sharing / Privacy** | NOVA SDK (TEE-locked keys) | Storacha + Lit Protocol (UCAN + threshold crypto) | 🔄 Replace |
| **Key Management** | Shade Agents on Phala TEE | Lit Protocol threshold network | 🔄 Replace |
| **Secure Compute** | Phala TEE | Phala TEE (retained for vote finalization) | ✅ Keep |
| **Agent Memory** | Ensue Memory Network | Ensue (hot) + Storacha (persistent backup) | ⬆️ Upgrade |
| **Micropayments** | PingPay | PingPay | ✅ Keep |
| **Storage Tier** | IPFS via Pinata (pinned/cold) | Storacha (hot) → Filecoin (archival) | 🔄 Replace |
| **Agent Identity** | NEAR AccountID + Ed25519 | Sovereign `did:key` + UCAN delegation | 🔄 Replace |
| **Voting Privacy** | Transparent on-chain | Zama fhEVM blind voting + Phala TEE finalization | ➕ New |
| **Randomness** | Pseudo-random | Flow VRF (provably fair jury selection) | ➕ New |

### Core Privacy Model: TEE → Modular Cryptography

The key architectural insight is replacing "Environment-based security" (TEEs as key custodians) with "Capability-based security" (UCANs + threshold cryptography). Instead of keys being locked in a Phala Shade Worker, authorization tokens are **owned by the agent**, and decryption keys are managed by the **Lit threshold network** — released only when on-chain Access Control Conditions (ACCs) are satisfied.

Phala TEE is **retained** but its role shifts: from key custodian to **trusted vote finalizer** — it performs the final decryption of FHE-aggregated vote tallies after the voting deadline and publishes the result on-chain.

---

## 2. Environment Setup

### 2.1 Prerequisites

```bash
# Node.js 20+, Rust toolchain, and the NEAR CLI must already be installed.

# Storacha CLI and encryption client
npm install -g @storacha/cli
npm install @storacha/client @storacha/encrypt-upload-client

# Lit Protocol SDK
npm install @lit-protocol/lit-node-client @lit-protocol/constants @lit-protocol/auth-helpers

# Zama fhEVM (for Solidity FHE contracts)
npm install fhevm

# Flow SDK (for VRF integration)
npm install @onflow/fcl @onflow/types

# Filecoin Onchain Cloud (identity + archival)
npm install @filecoin-onchain/sdk
```

### 2.2 Storacha Agent Identity Generation

Before any code is written, generate sovereign identities for your agent pool. These replace NEAR AccountID-based TEE mappings.

```bash
# Generate a unique AgentId (did:key) and PrivateKey for each agent role:
# - coordinator-agent
# - voter-agent-template (cloned per session)
# - archivist-agent

storacha key create
# Output:
# Private key: MgCZG7EvaA...  (save securely — never commit to git)
# Agent DID:   did:key:z6Mk...

# Create a dedicated storage Space for Delibera
storacha space create delibera-v2-production

# Generate a UCAN delegation granting the agent full space capabilities
storacha delegation create <AGENT_DID> \
  --can 'space/blob/add' \
  --can 'space/index/add' \
  --can 'upload/add' \
  --can 'upload/list' \
  -o delegation.car

# Encode delegation as base64 for use in environment variables
base64 delegation.car
```

### 2.3 Install MCP Server for Storacha

```bash
# Clone the official Storacha MCP server
git clone https://github.com/storacha/mcp-storage-server.git
cd mcp-storage-server
npm install && npm run build
```

---

## 3. Claude Code Configuration

Create `.claude.json` in your project root. This registers MCP servers and configures Claude Code's behavior for the Delibera project.

```json
{
  "mcpServers": {
    "storacha-storage": {
      "command": "node",
      "args": ["./mcp-storage-server/dist/index.js"],
      "env": {
        "PRIVATE_KEY": "${DELIBERA_AGENT_PRIVATE_KEY}",
        "DELEGATION": "${DELIBERA_UCAN_DELEGATION_BASE64}"
      },
      "tools": ["upload", "retrieve", "identity", "list"]
    },
    "near-ai": {
      "command": "npx",
      "args": ["-y", "@near-ai/mcp-server"],
      "env": {
        "NEAR_ACCOUNT_ID": "${NEAR_ACCOUNT_ID}",
        "NEAR_PRIVATE_KEY": "${NEAR_PRIVATE_KEY}",
        "NEAR_NETWORK": "mainnet"
      }
    },
    "filecoin-onchain": {
      "command": "npx",
      "args": ["-y", "@filecoin-onchain/mcp-server"],
      "env": {
        "FILECOIN_API_KEY": "${FILECOIN_ONCHAIN_API_KEY}"
      }
    }
  },
  "plugins": [
    {
      "name": "ensue-memory",
      "source": "https://github.com/mutable-state-inc/ensue-skill",
      "config": {
        "backupToStoracha": true,
        "backupInterval": 50,
        "storachaSpace": "${DELIBERA_STORACHA_SPACE_DID}"
      }
    }
  ],
  "permissions": {
    "allow": [
      "Bash(storacha:*)",
      "Bash(near:*)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Write(.claude/skills/**)",
      "Write(contracts/**)",
      "Write(agents/**)"
    ]
  }
}
```

### 3.1 MCP Registration via CLI

Alternatively, register MCP servers interactively:

```bash
# Register Storacha MCP (primary memory tool)
claude mcp add storacha-storage \
  --command "node" \
  --args "./mcp-storage-server/dist/index.js" \
  --env PRIVATE_KEY="$DELIBERA_AGENT_PRIVATE_KEY" \
  --env DELEGATION="$DELIBERA_UCAN_DELEGATION_BASE64"

# Register NEAR AI MCP
claude mcp add near-ai \
  --command "npx" \
  --args "-y @near-ai/mcp-server"

# Verify MCP connections
claude mcp list
claude mcp test storacha-storage
```

### 3.2 Plugin Installation

```bash
# Install Ensue memory plugin (retains existing semantic knowledge tree)
/plugin marketplace add https://github.com/mutable-state-inc/ensue-skill
/plugin install ensue-memory

# Configure Ensue to back up to Storacha every 50 agent turns
/plugin configure ensue-memory --backup-target storacha --backup-interval 50
```

---

## 4. Project Rules (`CLAUDE.md`)

Create this file at the project root. Claude Code reads it as persistent context for every session.

```markdown
# Delibera V2 — Agent Rules & Architecture Directives

## Project Identity
- **Name:** Delibera — Decentralized Coordination Engine
- **Hackathon:** PL Genesis: Frontiers of Collaboration (Feb 10 – Mar 16, 2026)
- **Category:** Existing Code (NEAR Innovation Sandbox → PL Genesis upgrade)
- **Repo:** https://github.com/leomanza/near-shade-coordination

## Core Architectural Invariants

### Identity
- ALL agents MUST use sovereign `did:key` identifiers generated via `storacha key create`.
- NEAR AccountIDs are used ONLY for on-chain ledger operations and smart contract ACL checks.
- Ed25519 agent keys from the legacy NOVA SDK are DEPRECATED. Do not generate new ones.

### Privacy & Storage
- ALL data written to Storacha MUST be encrypted client-side using Lit Protocol BEFORE upload.
- Use `@storacha/encrypt-upload-client` for all file operations. Never upload plaintext.
- Access Control Conditions (ACCs) MUST reference NEAR smart contract state:
  - Example: `NEAR.is_group_member(group_id, requester_did)` must return `true`.
- The pattern is: `Lit ACC satisfied → key fragments released → decrypt locally`.

### Voting (Confidential Governance)
- ALL governance votes MUST use the "Double Layer" blind voting pattern:
  1. **Phala TEE layer:** Voter agents cast ballots as `euint32` via Zama fhEVM.
  2. **FHE layer:** On-chain contract aggregates encrypted ballots using `FHE.add()`.
  3. **TEE finalization:** After deadline, Phala TEE decrypts aggregate using Lit threshold key.
  4. **On-chain publication:** Final tally is published to NEAR ledger.
- Never reveal individual votes. Only the aggregate result is decrypted.

### Memory Architecture
- **Hot memory:** Ensue Memory Network (real-time semantic search, task state).
- **Warm memory:** Storacha Space (session summaries, agent preferences, deliberation logs).
- **Cold/Archival:** Filecoin via Onchain Cloud (finalized deliberation records, proofs).
- Sync rule: When a deliberation cycle completes, Ensue knowledge tree MUST be serialized and backed up to Storacha within 1 minute.

### Randomness
- Jury selection and leader election MUST use Flow VRF. No pseudo-random or centralized sources.

## Component Responsibilities

| Component | Role | Status |
|---|---|---|
| NEAR Protocol | Ledger, ACL, contract state | ✅ Active |
| NEAR AI | Orchestrator agent logic | ✅ Active |
| Phala TEE | Secure vote finalization + encrypted inference | ✅ Active |
| Ensue | Real-time semantic memory (hot) | ✅ Active |
| PingPay | Micro-incentives for coordination tasks | ✅ Active |
| Storacha | Encrypted persistent agent memory (warm) | 🔄 Integrating |
| Lit Protocol | Threshold key management, ACCs | 🔄 Integrating |
| Zama fhEVM | FHE blind voting contracts | ➕ New |
| Filecoin | Long-term archival + Proof of Spacetime | ➕ New |
| Flow VRF | Verifiable randomness for jury selection | ➕ New |
| NOVA SDK | DEPRECATED — do not use | ❌ Removed |

## Code Style
- Language: TypeScript for agent logic, Solidity (fhEVM) for voting contracts, Rust for NEAR contracts.
- All async operations must include timeout handling and retry logic.
- Every Storacha upload must log the returned CID to the NEAR ledger as an immutable reference.
- Tests required for: UCAN delegation flow, Lit encryption/decryption, FHE vote aggregation.

## Slash Commands Available
- `/skill storacha-vault` — Encrypt and persist data to Storacha with Lit ACCs.
- `/skill zama-blind-voting` — Scaffold a Zama fhEVM voting contract.
- `/skill filecoin-archive` — Archive a CID to Filecoin via Onchain Cloud.
- `/skill flow-vrf` — Integrate Flow VRF for randomness.
- `/skill ensue-backup` — Serialize and back up Ensue tree to Storacha.
```

---

## 5. Custom Skills

Place skills in `.claude/skills/<skill-name>/`. Each skill has a `SKILL.md` (instructions for Claude) and a `scripts/` directory (executable helpers).

### Skill 1: `storacha-vault`

**`.claude/skills/storacha-vault/SKILL.md`**

```markdown
# Skill: storacha-vault
Encrypt sensitive agent data and upload it to Storacha with Lit Protocol access gating.

## Trigger Phrases
- "Securely persist agent memory"
- "Archive deliberation log"
- "Encrypt and upload to Storacha"
- "Store with Lit access control"

## Steps

1. **Initialize the encrypt-upload client:**
   Use NodeCryptoAdapter for server-side encryption.

2. **Define Lit Access Control Conditions:**
   ACCs must reference the NEAR smart contract group membership.
   Template ACC:
   ```json
   {
     "contractAddress": "<NEAR_DELIBERA_CONTRACT>",
     "standardContractType": "NEAR",
     "chain": "near",
     "method": "is_group_member",
     "parameters": [":deliberationGroupId", ":userAddress"],
     "returnValueTest": { "comparator": "=", "value": "true" }
   }
   ```

3. **Encrypt the data blob:**
   Pass the ACC to `encryptFile()` before upload.

4. **Upload to Storacha:**
   Call `client.uploadFile(encryptedBlob)` — returns a CID.

5. **Log CID on-chain:**
   Call `near.functionCall({ methodName: 'log_cid', args: { cid, context_id } })`.

## Script
Run `scripts/storacha-vault.ts` with:
- `--file <path>` — File to encrypt and upload
- `--group-id <id>` — NEAR group ID for ACC
- `--context-id <id>` — Deliberation context for on-chain logging
```

**`.claude/skills/storacha-vault/scripts/storacha-vault.ts`**

```typescript
import { create } from '@storacha/client';
import { EncryptUploadClient, NodeCryptoAdapter } from '@storacha/encrypt-upload-client';
import * as LitJsSdk from '@lit-protocol/lit-node-client';
import { fromString } from 'uint8arrays/from-string';
import * as fs from 'fs';

interface VaultOptions {
  filePath: string;
  groupId: string;
  contextId: string;
  agentPrivateKey: string;
  delegationCar: string;
}

export async function encryptAndVault(opts: VaultOptions): Promise<string> {
  // Initialize Storacha client with UCAN delegation
  const storachaClient = await create();
  await storachaClient.setCurrentSpace(process.env.DELIBERA_STORACHA_SPACE_DID!);

  // Initialize Lit Protocol client
  const litClient = new LitJsSdk.LitNodeClientNodeJs({ litNetwork: 'datil' });
  await litClient.connect();

  // Define NEAR-based Access Control Conditions
  const accessControlConditions = [{
    contractAddress: process.env.NEAR_DELIBERA_CONTRACT!,
    standardContractType: 'NEAR',
    chain: 'near',
    method: 'is_group_member',
    parameters: [opts.groupId, ':userAddress'],
    returnValueTest: { comparator: '=', value: 'true' }
  }];

  // Encrypt the file client-side
  const fileBuffer = fs.readFileSync(opts.filePath);
  const encryptClient = new EncryptUploadClient(storachaClient, new NodeCryptoAdapter());

  const { encryptedFile, encryptedSymmetricKey } = await litClient.encryptFile({
    file: new Blob([fileBuffer]),
    accessControlConditions,
    chain: 'near',
  });

  // Upload encrypted file to Storacha — returns CID
  const cid = await encryptClient.uploadFile(new File([encryptedFile], 'encrypted-data'));

  console.log(`✅ Encrypted upload complete. CID: ${cid}`);
  console.log(`   Encrypted symmetric key: ${encryptedSymmetricKey}`);
  console.log(`   Log this CID on-chain with context_id: ${opts.contextId}`);

  // Store metadata mapping (CID → encrypted key) in Storacha for retrieval
  const metadata = JSON.stringify({
    cid: cid.toString(),
    encryptedSymmetricKey,
    accessControlConditions,
    contextId: opts.contextId,
    timestamp: Date.now()
  });
  await storachaClient.uploadFile(new File([metadata], `metadata-${opts.contextId}.json`));

  return cid.toString();
}
```

---

### Skill 2: `zama-blind-voting`

**`.claude/skills/zama-blind-voting/SKILL.md`**

```markdown
# Skill: zama-blind-voting
Scaffold and deploy Zama fhEVM Solidity contracts for confidential governance voting.

## Trigger Phrases
- "Implement confidential governance"
- "Create FHE voting contract"
- "Blind voting for deliberation round"
- "Prevent vote sniping"

## Steps

1. **Scaffold the fhEVM contract:**
   - Define votes as `euint32` encrypted types.
   - Use `FHE.add()` for encrypted aggregation.
   - Store `encryptedTally` as contract state.

2. **Implement the deadline mechanism:**
   - Only allow vote casting before `deadline` block.
   - After deadline, trigger `finalize()`.

3. **TEE-gated decryption:**
   - Use `FHE.allowThis()` to permit the Phala TEE address to decrypt.
   - Phala TEE calls Lit Protocol to retrieve threshold key.
   - TEE publishes the final plaintext tally to NEAR.

4. **Deploy to testnet:**
   Run `scripts/deploy-voting.sh` targeting Zama's Devnet.

## The Double-Layer Security Model
- Layer 1 (FHE): No one can read individual votes on-chain.
- Layer 2 (TEE): The Phala enclave performs final decryption in hardware isolation.
- Result: Individual votes are cryptographically sealed; aggregate is verifiable.
```

**`.claude/skills/zama-blind-voting/scripts/DeliberaVoting.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@zama-network/fhevm/contracts/abstracts/EIP712WithModifier.sol";
import "@zama-network/fhevm/contracts/lib/FHE.sol";

/**
 * @title DeliberaBlindVoting
 * @notice FHE-based blind voting contract for Delibera governance.
 *         Votes are cast as encrypted euint32 values.
 *         The Phala TEE address is the sole authorized decryptor.
 */
contract DeliberaBlindVoting is EIP712WithModifier {
    // Encrypted vote tally — never readable on-chain in plaintext
    euint32 private encryptedTally;

    // Deliberation metadata
    bytes32 public deliberationId;
    uint256 public deadline;
    address public phalaTEEAddress;  // Only this address can request decryption
    bool public finalized;
    uint32 public plaintextResult;   // Set by TEE after finalization

    // Voter tracking (NEAR AccountID hash → voted)
    mapping(bytes32 => bool) public hasVoted;

    event VoteCast(bytes32 indexed voterHash, uint256 timestamp);
    event VotingFinalized(address indexed finalizer, uint256 timestamp);
    event ResultPublished(uint32 result, uint256 timestamp);

    constructor(
        bytes32 _deliberationId,
        uint256 _deadlineBlocks,
        address _phalaTEEAddress
    ) EIP712WithModifier("DeliberaVoting", "1") {
        deliberationId = _deliberationId;
        deadline = block.number + _deadlineBlocks;
        phalaTEEAddress = _phalaTEEAddress;
        // Initialize encrypted tally to 0
        encryptedTally = FHE.asEuint32(0);
    }

    /**
     * @notice Cast an encrypted vote.
     * @param encryptedVote An FHE-encrypted uint32 (e.g., 1 = yes, 0 = no).
     * @param voterNEARHash keccak256 of the voter's NEAR AccountID.
     */
    function castVote(
        bytes calldata encryptedVote,
        bytes32 voterNEARHash
    ) external {
        require(block.number < deadline, "Voting period closed");
        require(!hasVoted[voterNEARHash], "Already voted");

        // Decrypt locally (Phala TEE submits on behalf of voter)
        // FHE.add accumulates encrypted votes — no plaintext ever exposed
        euint32 vote = FHE.asEuint32(FHE.fromBytes32(encryptedVote));
        encryptedTally = FHE.add(encryptedTally, vote);

        hasVoted[voterNEARHash] = true;
        emit VoteCast(voterNEARHash, block.timestamp);
    }

    /**
     * @notice Trigger finalization after the deadline.
     *         Allows the Phala TEE to request decryption.
     */
    function finalize() external {
        require(block.number >= deadline, "Voting still open");
        require(!finalized, "Already finalized");
        require(msg.sender == phalaTEEAddress, "Only Phala TEE can finalize");

        // Grant decryption permission to TEE address only
        FHE.allowThis(encryptedTally);
        FHE.allow(encryptedTally, phalaTEEAddress);

        finalized = true;
        emit VotingFinalized(msg.sender, block.timestamp);
    }

    /**
     * @notice Called by Phala TEE after it decrypts the result off-chain.
     *         TEE retrieves the Lit threshold key, decrypts locally, then publishes here.
     */
    function publishResult(uint32 _plaintextResult) external {
        require(msg.sender == phalaTEEAddress, "Only Phala TEE can publish");
        require(finalized, "Not finalized yet");

        plaintextResult = _plaintextResult;
        emit ResultPublished(_plaintextResult, block.timestamp);
    }
}
```

---

### Skill 3: `filecoin-archive`

**`.claude/skills/filecoin-archive/SKILL.md`**

```markdown
# Skill: filecoin-archive
Archive finalized deliberation records to Filecoin for permanent, verifiable storage.

## Trigger Phrases
- "Archive to Filecoin"
- "Permanent storage of deliberation"
- "Filecoin Onchain Cloud"
- "Long-term preservation"

## Steps

1. **Verify data is already in Storacha** (has a CID).
2. **Use Filecoin Onchain Cloud SDK** to pin the CID to the Filecoin L1.
3. **Record the deal ID and Proof of Spacetime** reference on the NEAR ledger.
4. **Verify** with `filecoin.verifyCID(cid)` that the deal is active.

## Why
- Storacha (hot): Fast retrieval, 30-day minimum guarantee.
- Filecoin (cold): Cryptographic Proof of Spacetime (PoSt) — permanent record.
- Together: "Hot-warm-cold" tiered storage for agent memory.
```

---

### Skill 4: `flow-vrf`

**`.claude/skills/flow-vrf/SKILL.md`**

```markdown
# Skill: flow-vrf
Integrate Flow blockchain's Verifiable Random Function for provably fair jury selection.

## Trigger Phrases
- "Select jury for deliberation"
- "Fair leader election"
- "Provably random selection"
- "Flow VRF"

## Steps

1. **Request randomness from Flow:**
   Call the Flow VRF contract to get a verifiable random seed.

2. **Use seed for selection:**
   Apply Fisher-Yates shuffle to the voter pool using the VRF seed.

3. **Verify on NEAR:**
   Submit the VRF proof to a NEAR contract that validates it before executing selection.

## Script
Run `scripts/flow-vrf.ts` with:
- `--pool <json-array>` — Array of candidate NEAR AccountIDs
- `--jury-size <n>` — Number of jurors to select
- `--deliberation-id <id>` — Context ID for on-chain logging
```

**`.claude/skills/flow-vrf/scripts/flow-vrf.ts`**

```typescript
import * as fcl from '@onflow/fcl';

fcl.config({
  'flow.network': 'mainnet',
  'accessNode.api': 'https://rest-mainnet.onflow.org',
});

export async function selectJuryWithVRF(
  candidatePool: string[],
  jurySize: number,
  deliberationId: string
): Promise<{ jury: string[]; vrfProof: string; seed: string }> {
  // Request verifiable randomness from Flow
  const result = await fcl.query({
    cadence: `
      import RandomBeacon from 0x1b17f1b33a53e47a
      pub fun main(): UFix64 {
        return RandomBeacon.getValue()
      }
    `,
  });

  const seed = result.toString();

  // Deterministic Fisher-Yates shuffle using VRF seed
  const pool = [...candidatePool];
  let seedNum = parseInt(seed.replace('.', ''), 10);

  for (let i = pool.length - 1; i > 0; i--) {
    seedNum = (seedNum * 1664525 + 1013904223) & 0xffffffff; // LCG
    const j = Math.abs(seedNum) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  const jury = pool.slice(0, jurySize);
  const vrfProof = `flow-vrf-${deliberationId}-${seed}`;

  console.log(`✅ VRF jury selected for deliberation ${deliberationId}:`);
  jury.forEach((member, i) => console.log(`  ${i + 1}. ${member}`));
  console.log(`   VRF Proof: ${vrfProof}`);

  return { jury, vrfProof, seed };
}
```

---

### Skill 5: `ensue-backup`

**`.claude/skills/ensue-backup/SKILL.md`**

```markdown
# Skill: ensue-backup
Serialize the Ensue memory knowledge tree and back it up to Storacha for cross-session persistence.

## Trigger Phrases
- "Back up agent memory"
- "Serialize Ensue to Storacha"
- "Persist deliberation context"
- "Cross-session memory sync"

## Steps

1. **Call `ensue.exportTree()`** to serialize the current knowledge tree as JSON.
2. **Encrypt the serialized tree** using the `storacha-vault` skill.
3. **Upload to Storacha** and receive a CID.
4. **Store the CID** in the agent's local DID document and log it on NEAR.
5. **Restore flow:** On new session, retrieve the CID from NEAR, fetch from Storacha,
   decrypt with Lit, and call `ensue.importTree(data)`.

## Trigger Condition
This skill MUST run automatically:
- Every 50 agent conversation turns (configured in `.claude.json`).
- At the end of every completed deliberation cycle.
- Before any agent instance is shut down.
```

---

## 6. Step-by-Step Workflow for Claude Code

This is the complete execution sequence Claude Code should follow for a Delibera V2 deliberation round.

### Phase 1: Identity & Space Setup (Week 1)

```bash
# Claude Code runs these via Bash tool or MCP:

# 1. Generate coordinator agent identity
storacha key create --output ./agents/coordinator/identity.json

# 2. Create Storacha space and delegation
storacha space create delibera-v2-main
storacha delegation create $(jq -r '.did' ./agents/coordinator/identity.json) \
  --can 'space/blob/add' --can 'upload/add' --can 'upload/list' \
  -o ./agents/coordinator/delegation.car

# 3. Verify NEAR contracts are deployed
near view $DELIBERA_CONTRACT_ID get_groups '{}'

# 4. Test MCP connection
claude mcp test storacha-storage
```

**Claude Code slash command:**
```
/skill storacha-vault --setup --agent coordinator
```

### Phase 2: Encrypted Persistence (Week 2)

For each deliberation session:

```typescript
// Claude Code executes this pattern using the storacha-vault skill:

// 1. Agent retrieves Ensue context (hot memory)
const context = await ensue.query({ agentId: coordinatorDID, topic: deliberationId });

// 2. After deliberation, encrypt and persist to Storacha
await encryptAndVault({
  filePath: `./logs/${deliberationId}-transcript.json`,
  groupId: deliberationGroupId,
  contextId: deliberationId,
  agentPrivateKey: process.env.DELIBERA_AGENT_PRIVATE_KEY!,
  delegationCar: process.env.DELIBERA_UCAN_DELEGATION_BASE64!
});

// 3. Back up Ensue tree
/skill ensue-backup --deliberation-id $DELIBERATION_ID
```

### Phase 3: FHE Blind Voting (Week 3)

```bash
# 1. Deploy the Zama fhEVM voting contract
/skill zama-blind-voting --scaffold --deliberation-id $DELIBERATION_ID

# 2. Compile and deploy
cd contracts/voting
npx hardhat compile
npx hardhat run scripts/deploy.ts --network zama-devnet

# 3. Voter agents (running in Phala TEE) cast encrypted votes
# Each voter agent calls castVote() with their euint32 encrypted ballot

# 4. After deadline, Phala TEE finalizes
# TEE calls finalize() → retrieves Lit threshold key → decrypts → calls publishResult()

# 5. Result is logged to NEAR
near call $DELIBERA_CONTRACT_ID record_vote_result \
  '{"deliberation_id": "'$DELIBERATION_ID'", "result_cid": "'$RESULT_CID'"}' \
  --accountId $NEAR_ACCOUNT_ID
```

### Phase 4: Jury Selection & Archival (Week 4)

```bash
# 1. Select jury using Flow VRF
/skill flow-vrf \
  --pool '["alice.near","bob.near","carol.near","dave.near","eve.near"]' \
  --jury-size 3 \
  --deliberation-id $DELIBERATION_ID

# 2. Archive finalized deliberation to Filecoin
/skill filecoin-archive --cid $FINALIZED_TRANSCRIPT_CID --deliberation-id $DELIBERATION_ID

# 3. Log Filecoin deal ID on NEAR for permanent auditability
near call $DELIBERA_CONTRACT_ID log_archival \
  '{"deliberation_id": "'$DELIBERATION_ID'", "filecoin_deal_id": "'$DEAL_ID'"}' \
  --accountId $NEAR_ACCOUNT_ID
```

### Orchestrator / Sub-agent Pattern

For complex multi-agent deliberation rounds, Claude Code acts as the **orchestrator** and spawns specialized sub-agents:

```
Orchestrator (NEAR AI + Claude Code)
├── Voter Agent 1..N  (Phala TEE — casts FHE votes)
├── Memory Agent      (Storacha MCP — persists context)
├── Jury Agent        (Flow VRF — selects reviewers)
└── Archivist Agent   (Filecoin — permanent storage)
```

Each sub-agent operates with its own `did:key` and scoped UCAN delegation, limiting capabilities to exactly what each role requires.

---

## 7. Bounty Targets & Checklist

| Sponsor | Challenge | Reward | Required Deliverable | Status |
|---|---|---|---|---|
| **NEAR** | Best Continued Project | $10,000+ | Demonstrate NEAR as core ledger with PL primitive integrations | 🔄 |
| **Storacha** | Best AI Agent Integration | $5,000–$10,000 | Persistent agent memory + UCAN auth via Storacha MCP | 🔄 |
| **Lit Protocol** | Managing Keys & Secrets | $5,000+ | Threshold decryption with NEAR-gated ACCs | 🔄 |
| **Zama** | Confidential Governance | $5,000+ | FHE blind voting contract (fhEVM) + Phala TEE finalization | 🔄 |
| **Filecoin** | Onchain Cloud Identity | $5,000+ | Archive deliberation records with Proof of Spacetime | 🔄 |
| **Flow** | Flow Challenge | $1,000–$10,000 | VRF-based jury selection with on-chain proof | 🔄 |

### Demo Scenario for Judges

> A BioDAO (e.g., VitaDAO) submits a drug discovery hypothesis. Delibera:
> 1. **NEAR AI** orchestrates the peer review workflow.
> 2. **Flow VRF** selects 5 expert reviewers from the DAO.
> 3. Reviewers cast encrypted votes via **Zama fhEVM** (preventing coordination bias).
> 4. **Phala TEE** finalizes: decrypts aggregate tally, publishes result to NEAR.
> 5. All transcripts are encrypted with **Lit Protocol** ACCs and stored in **Storacha**.
> 6. The finalized record is archived permanently to **Filecoin**.
> 7. Agent memory persists across sessions via **Ensue + Storacha** backup.

---

## Appendix: Environment Variables Reference

```bash
# .env.local (never commit to git)

# NEAR
NEAR_ACCOUNT_ID=delibera.near
NEAR_PRIVATE_KEY=ed25519:...
NEAR_NETWORK=mainnet
NEAR_DELIBERA_CONTRACT=delibera-v2.near

# Storacha
DELIBERA_AGENT_PRIVATE_KEY=MgCZG7EvaA...
DELIBERA_UCAN_DELEGATION_BASE64=uOqJar0B...
DELIBERA_STORACHA_SPACE_DID=did:key:z6Mk...

# Lit Protocol
LIT_RELAY_API_KEY=...
LIT_NETWORK=datil

# Zama
ZAMA_RPC_URL=https://devnet.zama.ai
ZAMA_PRIVATE_KEY=0x...

# Flow
FLOW_ACCOUNT_ADDRESS=0x...
FLOW_PRIVATE_KEY=...

# Filecoin
FILECOIN_ONCHAIN_API_KEY=...

# Phala TEE
PHALA_TEE_ADDRESS=0x...
PHALA_ENDPOINT=https://api.phala.network
```
