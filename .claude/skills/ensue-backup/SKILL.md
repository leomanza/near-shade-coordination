# Skill: ensue-backup
Serialize the Ensue memory knowledge tree and back it up to Storacha for cross-session persistence.

## Trigger Phrases
- "Back up agent memory"
- "Serialize Ensue to Storacha"
- "Persist deliberation context"
- "Cross-session memory sync"

## Steps

1. **Read coordination state from Ensue** — Serialize all keys under `coordination/`.
2. **Encrypt and upload to Storacha** via `encryptAndVault()` from `vault.ts`.
3. **Log the CID** to console and optionally to NEAR contract.
4. **Restore flow:** On new session, use `retrieveAndDecrypt()` with the CID.

## Implementation
- `coordinator-agent/src/storacha/vault.ts` — `backupEnsueState()` function
- Triggered automatically after each completed deliberation cycle
- Also callable via `/skill ensue-backup`

## Trigger Conditions
- At the end of every completed deliberation cycle
- Every 50 agent conversation turns (if configured in `.claude.json`)
- Before any agent instance is shut down

## Environment Variables Required
- `STORACHA_AGENT_PRIVATE_KEY`
- `STORACHA_DELEGATION_PROOF`
