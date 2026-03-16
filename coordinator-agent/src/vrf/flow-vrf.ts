/**
 * Flow VRF — Verifiable Random Function for provably fair jury selection.
 *
 * Uses Flow's protocol-level distributed randomness beacon (revertibleRandom)
 * via FCL to generate a verifiable seed, then applies Fisher-Yates shuffle
 * to select a jury from a candidate pool.
 *
 * Flow access nodes:
 *   Testnet: https://rest-testnet.onflow.org
 *   Mainnet: https://rest-mainnet.onflow.org
 */

import * as fcl from '@onflow/fcl';

const FLOW_NETWORKS: Record<string, { accessNode: string }> = {
  testnet: { accessNode: 'https://rest-testnet.onflow.org' },
  mainnet: { accessNode: 'https://rest-mainnet.onflow.org' },
};

let _configured = false;

/**
 * Configure FCL for the specified Flow network.
 */
function configureFcl(): void {
  if (_configured) return;

  const network = process.env.FLOW_NETWORK || 'testnet';
  const config = FLOW_NETWORKS[network] || FLOW_NETWORKS.testnet;
  const accessNode = process.env.FLOW_ACCESS_NODE || config.accessNode;

  fcl.config({
    'flow.network': network,
    'accessNode.api': accessNode,
  });

  _configured = true;
  console.log(`[flow-vrf] Configured for Flow ${network}: ${accessNode}`);
}

/**
 * Fetch a verifiable random seed from the Flow blockchain.
 *
 * Uses `revertibleRandom<UInt64>()` — a built-in Cadence function backed by
 * Flow's distributed randomness beacon. The output is unpredictable,
 * verifiable, uniform, and safe from bias.
 *
 * @returns The VRF seed as a string
 */
export async function getFlowVRFSeed(): Promise<string> {
  configureFcl();

  const result = await fcl.query({
    cadence: `
      access(all) fun main(): UInt64 {
        return revertibleRandom<UInt64>()
      }
    `,
  });

  return result.toString();
}

/**
 * Deterministic Fisher-Yates shuffle using an LCG PRNG seeded by the VRF output.
 *
 * LCG parameters (Numerical Recipes):
 *   next = (seed * 1664525 + 1013904223) & 0xFFFFFFFF
 *
 * @param pool - The candidate pool to shuffle (not mutated)
 * @param seedStr - The VRF seed string (numeric)
 * @returns A new array with elements shuffled deterministically
 */
export function fisherYatesShuffle<T>(pool: T[], seedStr: string): T[] {
  const shuffled = [...pool];

  // Strip any decimal point (Flow UFix64 compat) and parse to integer
  let seed = Number(BigInt(seedStr.replace('.', '')) % BigInt(0xffffffff));

  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    const j = Math.abs(seed) % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Select a jury from a candidate pool using Flow VRF.
 *
 * @param candidatePool - Array of candidate identifiers (e.g., NEAR AccountIDs)
 * @param jurySize - Number of jurors to select
 * @param deliberationId - Context ID for logging/proof
 * @returns The selected jury, VRF seed, and proof string
 */
export async function selectJuryWithVRF(
  candidatePool: string[],
  jurySize: number,
  deliberationId: string,
): Promise<{ jury: string[]; vrfSeed: string; vrfProof: string }> {
  if (jurySize > candidatePool.length) {
    throw new Error(
      `Jury size (${jurySize}) exceeds candidate pool (${candidatePool.length})`,
    );
  }

  if (jurySize <= 0) {
    throw new Error('Jury size must be positive');
  }

  // Get verifiable random seed from Flow
  const vrfSeed = await getFlowVRFSeed();

  // Deterministic shuffle
  const shuffled = fisherYatesShuffle(candidatePool, vrfSeed);

  // Take first N as jury
  const jury = shuffled.slice(0, jurySize);

  const vrfProof = `flow-vrf:${deliberationId}:seed=${vrfSeed}`;

  console.log(`[flow-vrf] Jury selected for deliberation ${deliberationId}:`);
  jury.forEach((member, i) => console.log(`  ${i + 1}. ${member}`));
  console.log(`[flow-vrf] VRF Seed: ${vrfSeed}`);
  console.log(`[flow-vrf] Proof: ${vrfProof}`);

  return { jury, vrfSeed, vrfProof };
}
