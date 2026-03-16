# Skill: zama-blind-voting
Scaffold and deploy Zama fhEVM blind voting contracts for confidential DAO governance.

## Trigger Phrases
- "Implement confidential governance"
- "FHE blind voting"
- "Encrypted on-chain voting"
- "Deploy voting contract to Zama devnet"

## Steps

1. **Deploy `DeliberaVoting.sol`** to Zama devnet (or local hardhat mock)
2. **Register proposal** — coordinator calls `createProposal(description, duration)`
3. **Cast encrypted votes** — worker agents (in Phala TEE) call `castVote(proposalId, encryptedVote, inputProof)`
   - Votes are `euint32` (0 = Rejected, 1 = Approved)
   - Accumulated via `FHE.add()` — no plaintext ever on-chain
4. **Finalize** — Phala TEE calls `finalize(proposalId)` after deadline, decrypts aggregate locally
5. **Publish result** — TEE calls `publishResult(proposalId, approved, rejected)`
6. **Settle to NEAR** — Result forwarded to coordinator contract via `coordinator_resume`

## Implementation
- `contracts/voting/contracts/DeliberaVoting.sol` — Full fhEVM contract
- `contracts/voting/test/DeliberaVoting.ts` — Hardhat test suite
- `contracts/voting/hardhat.config.ts` — Zama devnet + local mock config

## Double-Layer Security Model
1. **FHE layer** — Votes encrypted as `euint32`, accumulated with `FHE.add()`
2. **TEE layer** — Only Phala TEE address can call `finalize()` and `publishResult()`
3. **No single point of trust** — FHE prevents vote sniping even if TEE is compromised

## Trigger Condition
Activated when `task_config.voting_mode === "confidential"` in the coordination flow.

## Environment Variables Required
- `ZAMA_RPC_URL` — Zama devnet RPC (or local hardhat)
- `ZAMA_PRIVATE_KEY` — Deployer private key
- `PHALA_TEE_ADDRESS` — TEE wallet authorized for finalize/publish
