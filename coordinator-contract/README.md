# Coordinator Contract

NEAR smart contract for privacy-preserving multi-agent DAO voting using the yield/resume pattern.

## Overview

AI agents independently deliberate on DAO proposals and vote. This contract manages the proposal lifecycle:

1. Owner sets a **manifesto** (DAO guidelines the AI agents reference)
2. Anyone calls `start_coordination` with a proposal — contract creates a yielded promise
3. Coordinator agent dispatches the proposal to voter agents off-chain
4. Voters deliberate via AI and submit votes to Ensue (private, off-chain)
5. Coordinator records worker submission hashes on-chain (**nullifier** — prevents double-voting)
6. Coordinator calls `coordinator_resume` with the **aggregate tally only** (no individual votes)
7. Contract validates hashes and finalizes the result on-chain

Individual AI votes and reasoning never touch the blockchain.

## Proposal Lifecycle

```
Created ──────────────> WorkersCompleted ──────────────> Finalized
(yield created,         (worker hashes              (aggregate result
 waiting for agents)     recorded on-chain)           stored on-chain)
       │
       └──────────────────────────────────────────> TimedOut
                    (yield expired, ~200 blocks)
```

## Contract Functions

### Manifesto

| Function | Caller | Description |
|----------|--------|-------------|
| `set_manifesto(manifesto_text)` | Owner | Set DAO guidelines (max 10,000 chars) |
| `get_manifesto()` | Anyone | View current manifesto with hash |

### Coordination

| Function | Caller | Description |
|----------|--------|-------------|
| `start_coordination(task_config)` | Anyone | Submit proposal, creates yield, returns proposal_id |
| `record_worker_submissions(proposal_id, submissions)` | Coordinator (TEE) | Record worker hashes (nullifier) |
| `coordinator_resume(proposal_id, aggregated_result, config_hash, result_hash)` | Coordinator (TEE) | Settle aggregate result on-chain |

### View Functions

| Function | Returns |
|----------|---------|
| `get_proposal(proposal_id)` | Full proposal details |
| `get_all_proposals(from_index, limit)` | Paginated proposals |
| `get_proposals_by_state(state, from_index, limit)` | Filtered by state |
| `get_pending_coordinations(from_index, limit)` | Proposals in `Created` state |
| `get_finalized_coordination(proposal_id)` | Finalized result string |
| `get_all_finalized_coordinations(from_index, limit)` | All finalized results |
| `get_worker_submissions(proposal_id)` | Worker submission hashes |
| `get_current_proposal_id()` | Next proposal ID |
| `get_owner()` | Contract owner |

### Owner Functions

| Function | Description |
|----------|-------------|
| `approve_codehash(codehash)` | Approve a Docker image hash |
| `register_coordinator(checksum, codehash)` | Register coordinator agent |
| `remove_codehash(codehash)` | Revoke codehash approval |
| `clear_proposal(proposal_id)` | Remove a proposal |
| `transfer_ownership(new_owner)` | Transfer contract ownership |

## Security

### Hash Verification

- **config_hash** — SHA256 of `task_config`, computed at submission. Coordinator must provide matching hash when resuming, proving the task wasn't tampered with.
- **result_hash** — SHA256 of `aggregated_result`, computed by coordinator. Contract re-hashes the result and verifies it matches, ensuring data integrity.

### Nullifier Pattern

`record_worker_submissions` records `{worker_id, result_hash}` pairs on-chain. Each worker can submit only once per proposal (checked by worker_id). The result_hash commits the worker to their vote without revealing it.

### TEE Gating

Only coordinators registered via `register_coordinator` with an `approved_codehash` can call `record_worker_submissions` and `coordinator_resume`. In production, registration requires DCAP attestation verification.

## What's On-Chain vs Off-Chain

**On-chain (public):**
```json
{
  "task_config": "{\"type\":\"vote\",\"parameters\":{\"proposal\":\"Fund grants\"}}",
  "config_hash": "a3f2...",
  "state": "Finalized",
  "worker_submissions": [
    {"worker_id": "worker1", "result_hash": "b4c5...", "timestamp": 1770497735},
    {"worker_id": "worker2", "result_hash": "d6e7...", "timestamp": 1770497736}
  ],
  "finalized_result": "{\"approved\":2,\"rejected\":1,\"decision\":\"Approved\",\"workerCount\":3}"
}
```

**Off-chain (Ensue, private):**
- Individual votes (Approved/Rejected per worker)
- AI reasoning for each vote
- Processing times, error details, intermediate states

## Building

```bash
# Build contract (requires nightly Rust for NEAR WASM target)
cargo near build

# Or manual build with NEAR-compatible flags:
RUSTFLAGS='-C link-arg=-s -C target-cpu=mvp -C target-feature=-bulk-memory,-sign-ext' \
  cargo build --target wasm32-unknown-unknown --release

# Optimize
wasm-opt -Oz target/wasm32-unknown-unknown/release/*.wasm -o coordinator_contract.wasm

# Run tests
cargo test
```

## Deployment

```bash
# Deploy to testnet
shade-agent-cli --wasm target/near/coordinator_contract.wasm --funding 7

# Initialize
near call $CONTRACT new '{"owner":"agents-coordinator.testnet"}' --accountId $CONTRACT

# Set manifesto
near call $CONTRACT set_manifesto '{"manifesto_text":"We support proposals that..."}' --accountId $OWNER

# Approve coordinator codehash
near call $CONTRACT approve_codehash '{"codehash":"7173eea7b2fb1c7f76ad3b88d65fb23f50cbb465d42eeacd726623da643d666c"}' --accountId $OWNER

# Register coordinator
near call $CONTRACT register_coordinator '{"checksum":"...","codehash":"7173eea7..."}' --accountId $OWNER
```

**Contract address:** `ac-proxy.agents-coordinator.testnet`
**Owner:** `agents-coordinator.testnet`
**NEAR RPC:** `https://test.rpc.fastnear.com`

## Gas Costs

| Function | Gas |
|----------|-----|
| `start_coordination` | ~10-20 Tgas |
| `record_worker_submissions` | ~15-25 Tgas |
| `coordinator_resume` | ~50-60 Tgas (includes callback) |
| `return_coordination_result` | 50 Tgas (callback) |

## Dependencies

- `near-sdk` 5.7.0 — NEAR smart contract SDK (yield/resume support)
- `sha2` — SHA256 hash computation
- `hex` — Hash hex encoding
- `serde_json` — JSON serialization

## References

- [NEAR Yield/Resume](https://docs.near.org/ai/shade-agents/tutorials/ai-dao/overview)
- [NEAR SDK Documentation](https://docs.near.org/sdk/rust/introduction)
- [Verifiable AI DAO (reference implementation)](https://github.com/NearDeFi/verifiable-ai-dao)
