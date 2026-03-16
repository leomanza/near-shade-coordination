/**
 * Flow VRF Jury Selection — Skill stub.
 *
 * The actual implementation lives in coordinator-agent/src/vrf/flow-vrf.ts
 * so it can resolve @onflow/fcl from coordinator-agent's node_modules.
 *
 * Usage:
 *   import { selectJuryWithVRF } from '../vrf/flow-vrf';
 *   const { jury, vrfSeed, vrfProof } = await selectJuryWithVRF(pool, 3, 'delib-1');
 *
 * Or via the coordinator wrapper:
 *   import { selectJury } from '../vrf/jury-selector';
 *   const result = await selectJury(pool, 3, 'delib-1');
 *
 * HTTP endpoint:
 *   POST /api/coordinate/select-jury
 *   Body: { pool: [...], jurySize: 3, deliberationId: "delib-1" }
 */
