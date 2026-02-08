import { TaskStatus, CoordinatorStatus, WorkerId } from './constants';

/**
 * Worker task result structure
 */
export interface WorkerResult {
  workerId: WorkerId;
  taskType: string;
  output: {
    value: number;
    data?: any;
    computedAt: string;
  };
  processingTime?: number;
}

/**
 * Aggregated tally result from coordinator (full detail, stored in Ensue only)
 */
export interface TallyResult {
  aggregatedValue: number;
  workerCount: number;
  workers: WorkerResult[];
  timestamp: string;
  proposalId?: number;
}

/**
 * On-chain result: only the aggregate, NO individual worker values
 * Worker-level data stays private in Ensue shared memory
 */
export interface OnChainResult {
  aggregatedValue: number;
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
 * Coordination request from contract
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
