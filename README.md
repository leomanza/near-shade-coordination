# Delibera — Privacy-Preserving Multi-Agent DAO Coordination on NEAR

A decentralized platform where independent AI agents deliberate and vote on DAO proposals. Individual reasoning stays private off-chain in Ensue shared memory, while only aggregate tallies are settled on the NEAR blockchain. Anyone can deploy their own coordinator or worker agents through the platform — each running autonomously inside Phala TEE containers.

Built with [NEAR Shade Agents](https://docs.near.org/ai/shade-agents/getting-started/introduction), [NEAR AI](https://near.ai/), [Ensue Memory Network](https://ensue.dev), [Storacha](https://storacha.network), [Lit Protocol](https://litprotocol.com/), [Zama fhEVM](https://docs.zama.ai/fhevm), [Flow VRF](https://docs.flow.com), [Phala TEE](https://phala.network/), and [PingPay](https://pingpay.io/).

## How It Works

```
1. User submits a proposal to the NEAR smart contract
2. Contract creates a yielded promise (pauses execution, waiting for off-chain result)
3. Coordinator agent detects the pending proposal via Ensue polling
4. Coordinator dispatches the proposal to N independent AI voter agents
5. Each voter agent:
   - Fetches the DAO manifesto from the NEAR contract
   - Loads its persistent agent identity (values, knowledge, decision history)
   - Calls NEAR AI (DeepSeek-V3.1) to deliberate on the proposal
   - Receives a NEAR AI verification proof (TEE-signed attestation of which model ran)
   - Writes its vote + reasoning to Ensue shared memory (private, off-chain)
6. Coordinator reads all votes from Ensue, tallies the result
7. Only the aggregate tally (Approved/Rejected count) goes on-chain
8. Contract resumes with the final decision
9. Deliberation transcript is encrypted and backed up to Storacha → Filecoin
```

Individual AI reasoning and votes never touch the blockchain — they stay private in Ensue shared memory. NEAR AI verification proofs cryptographically link each vote to a specific model running inside verified TEE hardware.

## Architecture

```
                        NEAR Blockchain (public, testnet)
           ┌─────────────────────────────────────────────────┐
           │  Coordinator Contract          Registry Contract │
           │  - Stores manifesto            - All coordinators│
           │  - Yield/resume pattern        - All workers     │
           │  - Proposal lifecycle          - Endpoint URLs   │
           │  - Only aggregate tally        - CVM IDs         │
           └──────────────┬──────────────────────────────────┘
                          │
                resume(tally only)
                          │
           ┌──────────────┴──────────────┐
           │    Coordinator Agent (:3000) │──── Phala TEE (production)
           │    - Dispatches proposals    │
           │    - Monitors completion     │
           │    - Tallies votes           │
           │    - Settles on-chain        │
           │    - Backs up to Storacha    │
           │    - Archives to Filecoin    │
           └──┬──────────┬──────────┬────┘
         read │    read  │    read  │
           ┌──┴──────────┴──────────┴────┐
           │   Ensue Shared Memory (Hot)  │
           └──┬──────────┬──────────┬────┘
         write│    write │    write │
        ┌─────┴──┐ ┌─────┴──┐ ┌─────┴──┐
        │Voter 1 │ │Voter 2 │ │Voter N │──── Phala TEE (production)
        │(:3001) │ │(:3002) │ │(:300N) │
        │did:key │ │did:key │ │did:key │
        └────────┘ └────────┘ └────────┘

    ┌─────────────────────────────────────────────┐
    │   Storacha (Warm — Encrypted Persistence)   │
    │   + Lit threshold encryption                │
    │   + Auto Filecoin archival (Cold)           │
    └─────────────────────────────────────────────┘

    ┌────────────────────┐  ┌─────────────────────┐
    │ Zama fhEVM         │  │ Flow VRF            │
    │ FHE blind voting   │  │ Fair jury selection  │
    └────────────────────┘  └─────────────────────┘
```

## Tiered Storage

| Tier | System | Data | Lifetime |
|------|--------|------|----------|
| Hot | Ensue Memory Network | Real-time task state, agent working memory | Session |
| Warm | Storacha + Lit Protocol | Encrypted transcripts, session summaries | Persistent |
| Cold | Filecoin (Proof of Spacetime) | Finalized deliberation records | Permanent |

## Data Privacy Model

| Data | Location | Visibility |
|------|----------|------------|
| Proposal text | NEAR blockchain | Public |
| DAO manifesto | NEAR blockchain | Public |
| Aggregate tally (N Approved, M Rejected) | NEAR blockchain | Public |
| Final decision (Approved/Rejected) | NEAR blockchain | Public |
| Worker submission hashes (nullifier) | NEAR blockchain | Public |
| Individual AI votes | Ensue shared memory | Private |
| AI reasoning / deliberation | Ensue shared memory | Private |
| NEAR AI verification proofs | Ensue shared memory | Private |
| Encrypted transcripts | Storacha (Lit-encrypted) | Private (threshold decryption) |
| Filecoin archival records | Storacha + Filecoin | Private (encrypted at rest) |
| FHE-encrypted ballots (V2) | Zama fhEVM chain | Encrypted (FHE) |

## Project Structure

```
near-shade-coordination/
├── coordinator-contract/        # NEAR smart contract (Rust, near-sdk 5.7.0)
│   └── src/lib.rs               # Yield/resume, manifesto, proposal lifecycle, nullifier
├── registry-contract/           # Agent registry contract (Rust, near-sdk 5.17.2)
│   └── src/lib.rs               # Multi-coordinator/worker registry with endpoint URLs
├── coordinator-agent/           # Orchestrator agent (TypeScript + Hono)
│   └── src/
│       ├── index.ts             # Shade Agent v2 init, local/production modes
│       ├── routes/coordinate.ts # Coordination API (trigger, status, select-jury)
│       ├── monitor/             # Ensue polling, vote tally, contract resume
│       ├── storacha/            # Storacha client, vault (Lit encryption), Ensue backup
│       ├── filecoin/            # IPNI verification, Filecoin archival records
│       └── vrf/                 # Flow VRF jury selection
├── worker-agent/                # AI voter agent (TypeScript + Hono, runs as 3 instances)
│   └── src/
│       ├── workers/ai-voter.ts  # NEAR AI integration (DeepSeek-V3.1 + verification)
│       ├── workers/task-handler.ts  # Task execution, Ensue status tracking
│       └── storacha/            # Storacha identity (did:key), agent profiles
├── contracts/voting/            # Zama fhEVM blind voting contract (Solidity)
│   ├── contracts/DeliberaVoting.sol
│   └── test/DeliberaVoting.ts
├── shared/                      # Shared library (@near-shade-coordination/shared)
│   └── src/
│       ├── ensue-client.ts      # Ensue JSON-RPC 2.0 over SSE client
│       ├── constants.ts         # Memory key paths
│       └── types.ts             # Shared TypeScript interfaces
├── frontend/                    # Next.js 15 dashboard + deploy UI
├── .claude/skills/              # Claude Code skills (storacha-vault, flow-vrf, etc.)
└── scripts/                     # Development utilities
```

## Quick Start

### Prerequisites

- Node.js 22+
- Rust + wasm32-unknown-unknown target (for contract builds)
- NEAR testnet account with credentials
- [Ensue API key](https://ensue.dev)
- [NEAR AI API key](https://cloud-api.near.ai) (for AI voting)

### 1. Build Shared Library

```bash
cd shared && npm install && npm run build
```

### 2. Generate Storacha Identity

Each agent needs a sovereign `did:key` identity for Storacha:

```bash
# Install Storacha CLI
npm install -g @storacha/cli

# Login (one time)
storacha login you@example.com

# Create a space (one time)
storacha space create delibera-v2
storacha space provision --provider did:web:storacha.network

# Generate agent keys (one per agent)
storacha key create
# → Private key: MgCZG7...  (STORACHA_AGENT_PRIVATE_KEY)
# → Agent DID:   did:key:z6Mk...

# Create delegation for the agent
storacha delegation create <AGENT_DID> \
  --can 'space/blob/add' --can 'space/index/add' \
  --can 'upload/add' --can 'upload/list' \
  --can 'space/content/decrypt' \
  -o delegation.car
base64 delegation.car
# → STORACHA_DELEGATION_PROOF value
```

### 3. Configure Environment

**Coordinator agent** (`coordinator-agent/.env.development.local`):
```bash
PORT=3000
LOCAL_MODE=true
ENSUE_API_KEY=your-ensue-api-key
ENSUE_TOKEN=your-ensue-token
NEAR_NETWORK=testnet
NEAR_ACCOUNT_ID=agents-coordinator.testnet
NEAR_SEED_PHRASE="your seed phrase"
NEXT_PUBLIC_contractId=coordinator.agents-coordinator.testnet
NEAR_API_KEY=your-near-ai-key
WORKERS=worker1:3001,worker2:3002,worker3:3003

# Storacha (encrypted persistence)
STORACHA_AGENT_PRIVATE_KEY=MgCZG7...
STORACHA_DELEGATION_PROOF=base64-encoded-delegation
STORACHA_SPACE_DID=did:key:z6Mk...

# Lit Protocol (threshold encryption)
LIT_NETWORK=datil
```

**Workers** (`worker-agent/.env.worker1.local`, `.env.worker2.local`, `.env.worker3.local`):
```bash
WORKER_ID=worker1                  # worker2, worker3
PORT=3001                          # 3002, 3003
ENSUE_API_KEY=your-ensue-api-key
ENSUE_TOKEN=your-ensue-token
NEAR_API_KEY=your-near-ai-key
NEXT_PUBLIC_contractId=coordinator.agents-coordinator.testnet

# Storacha (unique per worker)
STORACHA_AGENT_PRIVATE_KEY=MgCZG7...
STORACHA_DELEGATION_PROOF=base64-encoded-delegation
STORACHA_SPACE_DID=did:key:z6Mk...
```

**Frontend** (`frontend/.env.local`):
```bash
NEXT_PUBLIC_COORDINATOR_URL=http://localhost:3000
NEXT_PUBLIC_NEAR_NETWORK=testnet
NEXT_PUBLIC_contractId=coordinator.agents-coordinator.testnet
NEXT_PUBLIC_REGISTRY_CONTRACT_ID=registry.agents-coordinator.testnet
```

### 4. Start All Services

```bash
# All at once:
./run-dev.sh

# Or individually:
cd coordinator-agent && npm install && npm run dev
cd worker-agent && npm run dev:worker1   # Terminal 2
cd worker-agent && npm run dev:worker2   # Terminal 3
cd worker-agent && npm run dev:worker3   # Terminal 4
cd frontend && npm install && npm run dev # Terminal 5
```

### 5. Submit a Proposal

```bash
# Trigger a vote
curl -X POST http://localhost:3000/api/coordinate/trigger \
  -H 'Content-Type: application/json' \
  -d '{"taskConfig":{"type":"vote","parameters":{"proposal":"Fund a developer grant program for 10,000 NEAR"},"timeout":30000}}'

# Monitor the voting flow
curl http://localhost:3000/api/coordinate/status
curl http://localhost:3000/api/coordinate/workers

# Select a jury (Flow VRF)
curl -X POST http://localhost:3000/api/coordinate/select-jury \
  -H 'Content-Type: application/json' \
  -d '{"pool":["alice.near","bob.near","carol.near","dave.near","eve.near"],"jurySize":3}'

# Or open the dashboard at http://localhost:3004
```

## Smart Contracts

### Coordinator Contract

**Address:** `coordinator.agents-coordinator.testnet`

| Method | Type | Description |
|--------|------|-------------|
| `submit_proposal` | change | Submit a new proposal (creates yielded promise) |
| `resume_with_result` | change | Coordinator submits aggregate tally |
| `set_manifesto` | change | Owner sets/updates the DAO manifesto |
| `register_worker` | change | Register a worker agent on-chain |
| `get_manifesto` | view | Read the current manifesto |
| `get_all_proposals` | view | List all proposals with state |

### Registry Contract

**Address:** `registry.agents-coordinator.testnet`

| Method | Type | Description |
|--------|------|-------------|
| `register_coordinator` | change (0.1 NEAR) | Register a new coordinator |
| `register_worker` | change (0.1 NEAR) | Register a new worker |
| `list_active_coordinators` | view | All active coordinators |
| `list_active_workers` | view | All active workers |

## V2 Features

### Zama fhEVM Blind Voting

For high-stakes proposals, votes are cast as FHE-encrypted integers on a Zama fhEVM chain. The encrypted tally is invisible until a Phala TEE finalizes the vote.

```
contracts/voting/DeliberaVoting.sol
- castVote(proposalId, encryptedVote, inputProof)  → FHE.add() accumulates
- finalize(proposalId)                              → TEE-only, after deadline
- publishResult(proposalId, approved, rejected)     → TEE publishes plaintext
```

### Flow VRF Jury Selection

Fair jury selection using Flow blockchain's verifiable randomness beacon:

```
POST /api/coordinate/select-jury
Body: { pool: ["alice.near", ...], jurySize: 3, deliberationId: "delib-1" }
Response: { jury: [...], vrfSeed: "123...", vrfProof: "flow-testnet:..." }
```

Same seed always produces the same jury — verifiable and auditable.

### Storacha + Lit Encrypted Persistence

All deliberation data is encrypted with Lit Protocol threshold keys before upload to Storacha:

```
Vote complete → Encrypt with Lit ACC → Upload to Storacha → Auto Filecoin deal
                                              ↓
                                    CID: bafyrei...
                                    Deal ref: fil-f3cac8e5...
```

## Services

### Coordinator Agent (`:3000`)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Health check |
| GET | `/api/coordinate/status` | Current status + latest tally |
| GET | `/api/coordinate/workers` | Worker statuses from Ensue |
| POST | `/api/coordinate/trigger` | Trigger a vote on a proposal |
| POST | `/api/coordinate/reset` | Reset Ensue memory state |
| POST | `/api/coordinate/select-jury` | Flow VRF jury selection |
| POST | `/api/coordinate/verify-jury` | Verify a jury selection |

### Worker Agent (`:3001-300N`)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/task/health` | Worker health check |
| POST | `/api/task/execute` | Execute a task (vote on proposal) |
| GET | `/api/knowledge/identity` | Agent identity + Storacha DID |
| GET | `/api/knowledge/health` | Storacha identity health check |

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Coordinator Contract | Rust + near-sdk 5.7.0 | On-chain settlement, yield/resume |
| Registry Contract | Rust + near-sdk 5.17.2 | Platform-wide agent directory |
| AI Model | DeepSeek-V3.1 via NEAR AI | Proposal deliberation and voting |
| Agents | TypeScript + Hono 4.8 | HTTP servers for coordination |
| Hot Memory | Ensue Memory Network | Off-chain agent coordination |
| Warm Storage | Storacha + Lit Protocol | Encrypted persistent storage |
| Cold Archival | Filecoin (via Storacha) | Permanent storage (Proof of Spacetime) |
| Confidential Voting | Zama fhEVM | FHE-encrypted ballots |
| Verifiable Randomness | Flow VRF | Fair jury selection |
| Agent Identity | did:key + UCAN delegation | Sovereign agent identity |
| TEE Runtime | Phala Network | Trusted execution environment |
| Payments | PingPay (USDC on NEAR) | Agent deployment checkout |
| Frontend | Next.js 15 + React 19 | Dashboard and deploy UI |

## Deployments

### Testnet Contracts

| Contract | Account |
|----------|---------|
| Coordinator | `coordinator.agents-coordinator.testnet` |
| Registry | `registry.agents-coordinator.testnet` |
| Owner | `agents-coordinator.testnet` |

### NEAR RPC

| Network | Endpoint |
|---------|----------|
| Testnet | `https://test.rpc.fastnear.com` |
| Mainnet | `https://rpc.fastnear.com` |

## References

- [NEAR Shade Agents](https://docs.near.org/ai/shade-agents/getting-started/introduction)
- [NEAR AI API](https://cloud-api.near.ai)
- [Ensue Memory Network](https://ensue.dev)
- [Storacha](https://storacha.network)
- [Lit Protocol](https://litprotocol.com/)
- [Zama fhEVM](https://docs.zama.ai/fhevm)
- [Flow VRF](https://docs.flow.com)
- [Phala Network TEE](https://phala.network/)
- [PingPay Payments](https://pingpay.io/)

## License

MIT
