# Skill: filecoin-archive
Archive finalized deliberation records to Filecoin for permanent, verifiable storage.

## Trigger Phrases
- "Archive to Filecoin"
- "Permanent storage of deliberation"
- "Filecoin Onchain Cloud"
- "Long-term preservation"

## Steps

1. **Verify data is already in Storacha** (has a CID from vault upload).
2. **Confirm archival** — Query Storacha space to verify the CID is stored,
   then check IPNI (InterPlanetary Network Indexer) to confirm content is indexed
   across Filecoin-backed infrastructure.
3. **Record the archival reference** on the NEAR ledger via `log_archival`.
4. **Verify retrieval** — Confirm the CID is retrievable via the w3s.link gateway.

## Architecture

Storacha automatically creates Filecoin storage deals for all uploaded content:
- Uploads are split into CAR shards → aggregated into pieces → submitted to Filecoin SPs
- Deals are renewed automatically (data never expires)
- Individual CIDs are content-addressed and retrievable via IPFS gateways

The archiver confirms this pipeline is working and creates a verifiable record.

## Tiered Storage Model
| Tier | System | Lifetime |
|------|--------|----------|
| Hot | Ensue Memory Network | Session |
| Warm | Storacha (encrypted, UCAN-auth) | Persistent |
| Cold | Filecoin (Proof of Spacetime) | Permanent |

## Implementation
- `coordinator-agent/src/filecoin/archiver.ts` — `archiveCID()` function
- Called automatically after each Storacha vault backup succeeds
- Also callable via `/skill filecoin-archive`

## Environment Variables
- `STORACHA_AGENT_PRIVATE_KEY` — (shared with vault)
- `STORACHA_DELEGATION_PROOF` — (shared with vault)
