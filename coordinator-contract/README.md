# Coordinator Contract

NEAR smart contract implementing the yield/resume pattern for multi-agent coordination.

## Overview

This contract coordinates multiple worker agents by:
1. Accepting coordination requests from users (`start_coordination`)
2. Creating a yielded promise that pauses execution
3. Waiting for coordinator agent to aggregate worker results
4. Resuming execution when coordinator calls `coordinator_resume`
5. Storing final results on-chain

## Architecture Pattern

Based on [verifiable-ai-dao](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/dao.rs) yield/resume implementation:

```
User calls start_coordination(task_config)
  ↓
Contract creates yield (promise pauses)
  ↓
Coordinator agent polls get_pending_coordinations()
  ↓
Coordinator monitors workers via Ensue
  ↓
Coordinator aggregates results
  ↓
Coordinator calls coordinator_resume(proposal_id, result, hashes)
  ↓
Contract resumes promise with result
  ↓
return_coordination_result callback finalizes
```

## Key Functions

### User Functions

- `start_coordination(task_config: String) -> Promise`
  - Initiates a coordination task
  - Creates yielded promise
  - Returns proposal ID

### Coordinator Functions

- `coordinator_resume(proposal_id, result, config_hash, result_hash)`
  - Resumes yielded promise with aggregated results
  - Validates hashes for security
  - Must be called by registered coordinator

### View Functions

- `get_pending_coordinations() -> Vec<(u64, CoordinationRequest)>`
  - Returns all pending coordinations (for agent polling)
- `get_finalized_coordination(proposal_id) -> Option<String>`
  - Returns result for completed coordination
- `get_current_proposal_id() -> u64`
  - Returns next proposal ID

### Owner Functions

- `register_coordinator(quote_hex, collateral, checksum, tcb_info)`
  - Registers coordinator agent with TEE verification
- `approve_codehash(codehash: String)`
  - Approves Docker image hash for agent
- `remove_codehash(codehash: String)`
  - Revokes codehash approval

## Security Features

### Hash Validation

Following [verifiable-ai-dao security pattern](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/dao.rs#L133-L142):

- `config_hash`: SHA256 of task_config, prevents tampering during execution
- `result_hash`: SHA256 of aggregated_result, ensures result integrity

### TEE Verification

- Coordinator must be registered with valid TEE attestation
- Docker image codehash must be pre-approved by owner
- Uses dcap-qvl for Intel TDX attestation verification (testnet: placeholder)

## Building

```bash
# Build contract
cargo near build

# Run tests
cargo test

# Deploy to testnet (ac-proxy prefix)
shade-agent-cli --wasm target/near/coordinator_contract.wasm --funding 7

# For Phala production (ac-sandbox prefix)
cargo near build --reproducible
shade-agent-cli --wasm target/near/coordinator_contract.wasm --funding 10
```

## Gas Costs

- `start_coordination`: ~10-20 Tgas
- `coordinator_resume`: ~50-60 Tgas (includes callback)
- `return_coordination_result`: 50 Tgas (callback gas)

## Storage

- Pending coordinations: ~500 bytes per coordination
- Finalized results: Variable (depends on result size)
- Recommend attaching 0.1 NEAR per coordination for storage

## Testing

```bash
# Unit tests
cargo test

# Integration test locally
near call $CONTRACT start_coordination '{"task_config":"{\"type\":\"test\"}"}' --accountId test.testnet
```

## Production Notes

### For Mainnet Deployment

1. **Enable TEE Verification**: Uncomment DCAP verification in `register_coordinator()`
2. **Reproducible Build**: Use `cargo near build --reproducible`
3. **Set Limits**: Add max result size limits
4. **Timeout Handling**: Implement timeout for stuck coordinations
5. **Gas Optimization**: Profile and optimize gas usage

### Known Limitations (Testnet MVP)

- TEE verification uses placeholder codehash (not actual DCAP verification)
- No timeout mechanism for stuck coordinations
- No result size limits
- No pagination for view functions

## Dependencies

- `near-sdk`: 5.7.0 (yield/resume support)
- `dcap-qvl`: TEE attestation verification
- `sha2`: Hash validation
- `serde_json`: JSON serialization

## References

- [NEAR Yield/Resume Documentation](https://docs.near.org/ai/shade-agents/tutorials/ai-dao/overview)
- [Verifiable AI DAO Contract](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/dao.rs)
- [NEAR SDK Documentation](https://docs.near.org/sdk/rust/introduction)
