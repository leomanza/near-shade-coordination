import { getAgent } from '../shade-client';

/**
 * Resume the coordinator contract with aggregated results
 * Uses ShadeClient v2 agent.call() pattern
 */
export async function resumeContract(
  proposalId: number,
  aggregatedResult: string,
  configHash: string,
  resultHash: string
): Promise<void> {
  try {
    console.log(`\nCalling coordinator_resume on contract...`);

    await getAgent().call({
      methodName: 'coordinator_resume',
      args: {
        proposal_id: proposalId,
        aggregated_result: aggregatedResult,
        config_hash: configHash,
        result_hash: resultHash,
      },
    });

    console.log(`Successfully resumed contract for proposal #${proposalId}`);
  } catch (error) {
    console.error(`Failed to resume contract for proposal #${proposalId}:`, error);
    throw error;
  }
}

/**
 * Get finalized coordination result from contract
 */
export async function getFinalizedResult(proposalId: number): Promise<string | null> {
  try {
    const result = await getAgent().view<string>({
      methodName: 'get_finalized_coordination',
      args: { proposal_id: proposalId },
    });
    return result ?? null;
  } catch (error) {
    console.error(`Failed to get finalized result for proposal #${proposalId}:`, error);
    return null;
  }
}
