/**
 * Ensue memory key paths for NEAR Shade Agent coordination
 *
 * Memory structure:
 * coordination/
 * ├── tasks/
 * │   ├── worker1/{status, result, timestamp, error}
 * │   ├── worker2/{status, result, timestamp, error}
 * │   └── worker3/{status, result, timestamp, error}
 * ├── coordinator/{tally, status, proposal_id}
 * └── config/{task_definition, contract_address}
 */
export declare const MEMORY_KEYS: {
    readonly WORKER1_STATUS: "coordination/tasks/worker1/status";
    readonly WORKER1_RESULT: "coordination/tasks/worker1/result";
    readonly WORKER1_TIMESTAMP: "coordination/tasks/worker1/timestamp";
    readonly WORKER1_ERROR: "coordination/tasks/worker1/error";
    readonly WORKER2_STATUS: "coordination/tasks/worker2/status";
    readonly WORKER2_RESULT: "coordination/tasks/worker2/result";
    readonly WORKER2_TIMESTAMP: "coordination/tasks/worker2/timestamp";
    readonly WORKER2_ERROR: "coordination/tasks/worker2/error";
    readonly WORKER3_STATUS: "coordination/tasks/worker3/status";
    readonly WORKER3_RESULT: "coordination/tasks/worker3/result";
    readonly WORKER3_TIMESTAMP: "coordination/tasks/worker3/timestamp";
    readonly WORKER3_ERROR: "coordination/tasks/worker3/error";
    readonly COORDINATOR_TALLY: "coordination/coordinator/tally";
    readonly COORDINATOR_STATUS: "coordination/coordinator/status";
    readonly COORDINATOR_PROPOSAL_ID: "coordination/coordinator/proposal_id";
    readonly CONFIG_TASK_DEFINITION: "coordination/config/task_definition";
    readonly CONFIG_CONTRACT_ADDRESS: "coordination/config/contract_address";
};
/**
 * Task status types for workers
 */
export type TaskStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed';
/**
 * Coordinator status types
 */
export type CoordinatorStatus = 'idle' | 'monitoring' | 'aggregating' | 'resuming' | 'completed' | 'failed';
/**
 * Worker identifiers
 */
export type WorkerId = 'worker1' | 'worker2' | 'worker3';
/**
 * Get all memory keys for a specific worker
 */
export declare function getWorkerKeys(workerId: WorkerId): {
    STATUS: keyof typeof MEMORY_KEYS;
    RESULT: keyof typeof MEMORY_KEYS;
    TIMESTAMP: keyof typeof MEMORY_KEYS;
    ERROR: keyof typeof MEMORY_KEYS;
};
/**
 * Get all worker status keys
 */
export declare function getAllWorkerStatusKeys(): string[];
/**
 * Get all worker result keys
 */
export declare function getAllWorkerResultKeys(): string[];
//# sourceMappingURL=constants.d.ts.map