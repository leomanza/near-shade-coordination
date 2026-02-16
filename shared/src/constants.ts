/**
 * Ensue memory key paths for NEAR Shade Agent coordination
 *
 * Memory structure:
 * coordination/
 * ├── tasks/
 * │   └── {workerId}/{status, result, timestamp, error}   ← ephemeral (overwritten each round)
 * ├── proposals/
 * │   └── {proposalId}/
 * │       ├── config                                       ← archived task definition
 * │       ├── status                                       ← created|completed|failed
 * │       ├── tally                                        ← aggregate result
 * │       └── workers/
 * │           └── {workerId}/{result, timestamp}           ← archived per-worker decisions
 * ├── coordinator/{tally, status, proposal_id}
 * └── config/{task_definition, contract_address}
 */

export const MEMORY_KEYS = {
  // Coordinator (ephemeral, current round)
  COORDINATOR_TALLY: 'coordination/coordinator/tally',
  COORDINATOR_STATUS: 'coordination/coordinator/status',
  COORDINATOR_PROPOSAL_ID: 'coordination/coordinator/proposal_id',

  // Config
  CONFIG_TASK_DEFINITION: 'coordination/config/task_definition',
  CONFIG_CONTRACT_ADDRESS: 'coordination/config/contract_address',
} as const;

/**
 * Task status types for workers
 */
export type TaskStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Coordinator status types
 */
export type CoordinatorStatus = 'idle' | 'monitoring' | 'aggregating' | 'resuming' | 'completed' | 'failed';

/**
 * Get ephemeral memory keys for a specific worker (overwritten each round)
 */
export function getWorkerKeys(workerId: string) {
  return {
    STATUS: `coordination/tasks/${workerId}/status`,
    RESULT: `coordination/tasks/${workerId}/result`,
    TIMESTAMP: `coordination/tasks/${workerId}/timestamp`,
    ERROR: `coordination/tasks/${workerId}/error`,
    VERIFICATION_PROOF: `coordination/tasks/${workerId}/verification_proof`,
  };
}

/**
 * Get all ephemeral worker status keys for a list of worker IDs
 */
export function getAllWorkerStatusKeys(workerIds: string[]): string[] {
  return workerIds.map(id => `coordination/tasks/${id}/status`);
}

/**
 * Get all ephemeral worker result keys for a list of worker IDs
 */
export function getAllWorkerResultKeys(workerIds: string[]): string[] {
  return workerIds.map(id => `coordination/tasks/${id}/result`);
}

/* ─── Proposal History Keys ──────────────────────────────────────────────── */

/**
 * Get archived Ensue keys for a specific proposal
 */
export function getProposalKeys(proposalId: string) {
  const base = `coordination/proposals/${proposalId}`;
  return {
    CONFIG: `${base}/config`,
    STATUS: `${base}/status`,
    TALLY: `${base}/tally`,
  };
}

/**
 * Get archived Ensue keys for a specific worker's result on a proposal
 */
export function getProposalWorkerKeys(proposalId: string, workerId: string) {
  const base = `coordination/proposals/${proposalId}/workers/${workerId}`;
  return {
    RESULT: `${base}/result`,
    TIMESTAMP: `${base}/timestamp`,
  };
}

/**
 * Proposal index key — stores a JSON array of all proposal IDs
 */
export const PROPOSAL_INDEX_KEY = 'coordination/proposals/_index';

/* ─── Agent Registry Keys (persistent, not overwritten per round) ────────── */

/**
 * Get persistent metadata keys for a worker agent
 */
export function getAgentRegistryKeys(agentId: string) {
  const base = `coordination/agents/${agentId}`;
  return {
    ENDPOINT: `${base}/endpoint`,
    TYPE: `${base}/type`,           // 'coordinator' | 'worker'
    CVM_ID: `${base}/cvm_id`,
    DASHBOARD_URL: `${base}/dashboard_url`,
    UPDATED_AT: `${base}/updated_at`,
  };
}
