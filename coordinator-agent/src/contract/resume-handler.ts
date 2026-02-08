import { agentCall } from '@neardefi/shade-agent-js';

/**
 * Resume the coordinator contract with aggregated results
 * Following verifiable-ai-dao/src/responder.ts:58-64
 */
export async function resumeContract(
  proposalId: number,
  aggregatedResult: string,
  configHash: string,
  resultHash: string
): Promise<void> {
  try {
    console.log(`\nCalling coordinator_resume on contract...`);

    // Call the contract's coordinator_resume function
    await agentCall({
      methodName: 'coordinator_resume',
      args: {
        proposal_id: proposalId,
        aggregated_result: aggregatedResult,
        config_hash: configHash,
        result_hash: resultHash,
      },
      // Gas is handled automatically by SDK
    });

    console.log(`✓ Successfully resumed contract for proposal #${proposalId}`);
  } catch (error) {
    console.error(`✗ Failed to resume contract for proposal #${proposalId}:`, error);
    throw error;
  }
}

/**
 * Get finalized coordination result from contract
 */
export async function getFinalizedResult(proposalId: number): Promise<string | null> {
  try {
    const { agentView } = await import('@neardefi/shade-agent-js');

    const result = await agentView<string | null>({
      methodName: 'get_finalized_coordination',
      args: { proposal_id: proposalId },
    });

    return result;
  } catch (error) {
    console.error(`Failed to get finalized result for proposal #${proposalId}:`, error);
    return null;
  }
}
