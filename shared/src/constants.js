"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MEMORY_KEYS = void 0;
exports.getWorkerKeys = getWorkerKeys;
exports.getAllWorkerStatusKeys = getAllWorkerStatusKeys;
exports.getAllWorkerResultKeys = getAllWorkerResultKeys;
exports.MEMORY_KEYS = {
    // Worker 1
    WORKER1_STATUS: 'coordination/tasks/worker1/status',
    WORKER1_RESULT: 'coordination/tasks/worker1/result',
    WORKER1_TIMESTAMP: 'coordination/tasks/worker1/timestamp',
    WORKER1_ERROR: 'coordination/tasks/worker1/error',
    // Worker 2
    WORKER2_STATUS: 'coordination/tasks/worker2/status',
    WORKER2_RESULT: 'coordination/tasks/worker2/result',
    WORKER2_TIMESTAMP: 'coordination/tasks/worker2/timestamp',
    WORKER2_ERROR: 'coordination/tasks/worker2/error',
    // Worker 3
    WORKER3_STATUS: 'coordination/tasks/worker3/status',
    WORKER3_RESULT: 'coordination/tasks/worker3/result',
    WORKER3_TIMESTAMP: 'coordination/tasks/worker3/timestamp',
    WORKER3_ERROR: 'coordination/tasks/worker3/error',
    // Coordinator
    COORDINATOR_TALLY: 'coordination/coordinator/tally',
    COORDINATOR_STATUS: 'coordination/coordinator/status',
    COORDINATOR_PROPOSAL_ID: 'coordination/coordinator/proposal_id',
    // Config
    CONFIG_TASK_DEFINITION: 'coordination/config/task_definition',
    CONFIG_CONTRACT_ADDRESS: 'coordination/config/contract_address',
};
/**
 * Get all memory keys for a specific worker
 */
function getWorkerKeys(workerId) {
    const workerNum = workerId.replace('worker', '');
    return {
        STATUS: `coordination/tasks/${workerId}/status`,
        RESULT: `coordination/tasks/${workerId}/result`,
        TIMESTAMP: `coordination/tasks/${workerId}/timestamp`,
        ERROR: `coordination/tasks/${workerId}/error`,
    };
}
/**
 * Get all worker status keys
 */
function getAllWorkerStatusKeys() {
    return [
        exports.MEMORY_KEYS.WORKER1_STATUS,
        exports.MEMORY_KEYS.WORKER2_STATUS,
        exports.MEMORY_KEYS.WORKER3_STATUS,
    ];
}
/**
 * Get all worker result keys
 */
function getAllWorkerResultKeys() {
    return [
        exports.MEMORY_KEYS.WORKER1_RESULT,
        exports.MEMORY_KEYS.WORKER2_RESULT,
        exports.MEMORY_KEYS.WORKER3_RESULT,
    ];
}
//# sourceMappingURL=constants.js.map