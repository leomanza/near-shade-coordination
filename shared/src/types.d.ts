import { TaskStatus, CoordinatorStatus, WorkerId } from './constants';
/**
 * AI vote result from a worker agent
 */
export type VoteDecision = 'Approved' | 'Rejected';
export interface VoteResult {
    vote: VoteDecision;
    reasoning: string;
}
/**
 * Worker task result structure
 */
export interface WorkerResult {
    workerId: WorkerId;
    taskType: string;
    output: {
        value: number;
        vote?: VoteDecision;
        reasoning?: string;
        data?: any;
        computedAt: string;
    };
    processingTime?: number;
}
/**
 * Vote tally from coordinator (full detail, stored in Ensue only)
 */
export interface TallyResult {
    aggregatedValue: number;
    approved: number;
    rejected: number;
    decision: VoteDecision;
    workerCount: number;
    workers: WorkerResult[];
    timestamp: string;
    proposalId?: number;
}
/**
 * On-chain result: only the tally, NO individual worker reasoning
 * Worker-level reasoning stays private in Ensue shared memory
 */
export interface OnChainResult {
    aggregatedValue: number;
    approved: number;
    rejected: number;
    decision: VoteDecision;
    workerCount: number;
    timestamp: string;
    proposalId: number;
}
/**
 * Task configuration passed to workers
 */
export interface TaskConfig {
    type: string;
    parameters?: Record<string, any>;
    timeout?: number;
}
/**
 * Proposal lifecycle states (matches contract ProposalState enum)
 */
export type ProposalState = 'Created' | 'WorkersCompleted' | 'Finalized' | 'TimedOut';
/**
 * Worker submission recorded on-chain (nullifier only — no vote data).
 * Individual votes stay private in Ensue shared memory.
 */
export interface WorkerSubmission {
    worker_id: string;
    result_hash: string;
    timestamp: number;
}
/**
 * Input for recording worker submissions (nullifier)
 */
export interface WorkerSubmissionInput {
    worker_id: string;
    result_hash: string;
}
/**
 * Unified proposal from contract (replaces separate pending/finalized)
 */
export interface Proposal {
    yield_id?: string;
    task_config: string;
    config_hash: string;
    timestamp: number;
    requester: string;
    state: ProposalState;
    worker_submissions: WorkerSubmission[];
    finalized_result?: string;
}
/**
 * Coordination request from contract (backwards-compatible alias)
 */
export interface CoordinationRequest {
    proposal_id: number;
    task_config: string;
    config_hash: string;
    timestamp: number;
}
/**
 * Worker status information
 */
export interface WorkerStatusInfo {
    workerId: WorkerId;
    status: TaskStatus;
    timestamp?: number;
    error?: string;
}
/**
 * Coordinator status information
 */
export interface CoordinatorStatusInfo {
    status: CoordinatorStatus;
    proposalId?: number;
    timestamp: number;
}
/**
 * Ensue memory item
 */
export interface EnsueMemory {
    key: string;
    value: string;
    description?: string;
}
/**
 * Ensue API response for reading memory
 */
export interface EnsueReadResponse {
    memories: Array<{
        key: string;
        value: string;
        description?: string;
        created_at?: string;
        updated_at?: string;
    }>;
}
/**
 * Ensue API response for listing keys
 */
export interface EnsueListResponse {
    keys: string[];
    total: number;
}
//# sourceMappingURL=types.d.ts.map