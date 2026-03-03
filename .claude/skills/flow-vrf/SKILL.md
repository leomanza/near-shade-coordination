# Skill: flow-vrf
Integrate Flow blockchain's Verifiable Random Function for provably fair jury selection.

## Trigger Phrases
- "Select jury for deliberation"
- "Fair leader election"
- "Provably random selection"
- "Flow VRF"

## Steps

1. **Request randomness from Flow:**
   Call a Cadence script via FCL that invokes `revertibleRandom<UInt64>()` — backed by Flow's
   distributed randomness beacon (protocol-level VRF).

2. **Use seed for selection:**
   Apply Fisher-Yates shuffle to the voter pool using the VRF seed as an LCG PRNG source.

3. **Return jury + proof:**
   Return the selected jury, the VRF seed, and a proof string for on-chain logging.

## Script
Run `scripts/flow-vrf.ts` with:
- `--pool <json-array>` — Array of candidate NEAR AccountIDs
- `--jury-size <n>` — Number of jurors to select
- `--deliberation-id <id>` — Context ID for on-chain logging

## Implementation
- `.claude/skills/flow-vrf/scripts/flow-vrf.ts` — Core VRF + Fisher-Yates logic
- `coordinator-agent/src/vrf/jury-selector.ts` — Coordinator wrapper
- `POST /api/coordinate/select-jury` — HTTP endpoint

## Environment Variables
- `FLOW_NETWORK` — `testnet` or `mainnet` (default: `testnet`)
- `FLOW_ACCESS_NODE` — Override access node URL (optional)

## Security Notes
- `revertibleRandom` is safe here because the coordinator is a trusted party
  (it has no incentive to abort transactions based on random outcomes)
- The VRF seed is verifiable by any Flow node
- For untrusted scenarios, use `RandomBeaconHistory` commit-reveal instead
