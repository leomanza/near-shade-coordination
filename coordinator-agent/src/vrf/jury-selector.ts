/**
 * Jury Selector — Coordinator wrapper for Flow VRF jury selection.
 *
 * Wraps the flow-vrf skill for use in the coordinator agent.
 * Provides selectJury() which fetches VRF randomness from Flow,
 * then applies Fisher-Yates shuffle to select a fair jury.
 */

import {
  selectJuryWithVRF,
  fisherYatesShuffle,
} from './flow-vrf';

export interface JurySelectionResult {
  jury: string[];
  vrfSeed: string;
  vrfProof: string;
  poolSize: number;
  jurySize: number;
  deliberationId: string;
  selectedAt: string;
}

/**
 * Select a jury from registered workers or a provided candidate pool.
 *
 * @param candidatePool - Array of NEAR AccountIDs or worker IDs
 * @param jurySize - Number of jurors to select
 * @param deliberationId - Optional deliberation context ID
 * @returns Jury selection result with VRF proof
 */
export async function selectJury(
  candidatePool: string[],
  jurySize: number,
  deliberationId?: string,
): Promise<JurySelectionResult> {
  const id = deliberationId || `delib-${Date.now()}`;

  const { jury, vrfSeed, vrfProof } = await selectJuryWithVRF(
    candidatePool,
    jurySize,
    id,
  );

  return {
    jury,
    vrfSeed,
    vrfProof,
    poolSize: candidatePool.length,
    jurySize,
    deliberationId: id,
    selectedAt: new Date().toISOString(),
  };
}

/**
 * Verify a jury selection is deterministic given the same seed.
 * Useful for auditing/dispute resolution.
 *
 * @param candidatePool - Original candidate pool
 * @param jurySize - Original jury size
 * @param vrfSeed - The VRF seed to verify with
 * @returns The jury that would be selected with this seed
 */
export function verifyJurySelection(
  candidatePool: string[],
  jurySize: number,
  vrfSeed: string,
): string[] {
  const shuffled = fisherYatesShuffle(candidatePool, vrfSeed);
  return shuffled.slice(0, jurySize);
}
