import { EnsueClient, createEnsueClient } from '../../../shared/src/ensue-client';
import { MEMORY_KEYS, TaskStatus, getWorkerKeys } from '../../../shared/src/constants';
import type { TaskConfig, WorkerResult, WorkerStatusInfo } from '../../../shared/src/types';

// Lazy-initialize Ensue client (env vars loaded by dotenv before first use)
let _ensueClient: EnsueClient | null = null;
function getEnsueClient(): EnsueClient {
  if (!_ensueClient) _ensueClient = createEnsueClient();
  return _ensueClient;
}

// Get worker ID from environment
const WORKER_ID = process.env.WORKER_ID || 'worker1';
const workerKeys = getWorkerKeys(WORKER_ID as any);

/**
 * Execute a task and write results to Ensue
 *
 * Flow:
 * 1. Update status to "processing"
 * 2. Perform work (simulated computation for MVP)
 * 3. Write result to Ensue
 * 4. Update timestamp
 * 5. Update status to "completed"
 * 6. Handle errors by writing to error key
 *
 * Following pattern from plan Phase 3
 */
export async function executeTask(taskConfig: TaskConfig): Promise<void> {
  console.log(`[${WORKER_ID}] Starting task execution:`, taskConfig);

  try {
    // Step 1: Update status to processing
    await updateStatus('processing');
    console.log(`[${WORKER_ID}] Status updated to processing`);

    // Step 2: Perform actual work
    const startTime = Date.now();
    const result = await performWork(taskConfig);
    const processingTime = Date.now() - startTime;

    console.log(`[${WORKER_ID}] Work completed in ${processingTime}ms`);

    // Step 3: Build worker result
    const workerResult: WorkerResult = {
      workerId: WORKER_ID as any,
      taskType: taskConfig.type,
      output: {
        value: result,
        data: {
          parameters: taskConfig.parameters,
        },
        computedAt: new Date().toISOString(),
      },
      processingTime,
    };

    // Step 4: Write result to Ensue
    await getEnsueClient().updateMemory(workerKeys.RESULT, JSON.stringify(workerResult));
    console.log(`[${WORKER_ID}] Result written to Ensue:`, workerResult);

    // Step 5: Update timestamp
    await getEnsueClient().updateMemory(workerKeys.TIMESTAMP, Date.now().toString());

    // Step 6: Update status to completed
    await updateStatus('completed');
    console.log(`[${WORKER_ID}] Task completed successfully`);
  } catch (error) {
    console.error(`[${WORKER_ID}] Task failed:`, error);

    // Write error to Ensue
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await getEnsueClient().updateMemory(workerKeys.ERROR, errorMessage);

    // Update status to failed
    await updateStatus('failed');
  }
}

/**
 * Perform the actual work
 * For MVP, this simulates async work with random duration and result
 *
 * In production, this would:
 * - Fetch data from APIs
 * - Run ML inference
 * - Process data
 * - Query databases
 * etc.
 */
async function performWork(config: TaskConfig): Promise<number> {
  // Extract timeout from config or use default
  const timeout = config.timeout || 3000;

  // Simulate async work with variable duration
  const workDuration = 1000 + Math.random() * timeout;

  await new Promise((resolve) => setTimeout(resolve, workDuration));

  // Generate a result based on task type
  switch (config.type) {
    case 'random':
      return Math.floor(Math.random() * 100);

    case 'count':
      return config.parameters?.count || 42;

    case 'multiply':
      const a = config.parameters?.a || 1;
      const b = config.parameters?.b || 1;
      return a * b;

    default:
      // Default: generate random value
      return Math.floor(Math.random() * 100);
  }
}

/**
 * Update worker status in Ensue
 */
async function updateStatus(status: TaskStatus): Promise<void> {
  await getEnsueClient().updateMemory(workerKeys.STATUS, status);
}

/**
 * Get current task status from Ensue
 */
export async function getTaskStatus(): Promise<WorkerStatusInfo> {
  const statusStr = await getEnsueClient().readMemory(workerKeys.STATUS);
  const timestampStr = await getEnsueClient().readMemory(workerKeys.TIMESTAMP);
  const errorStr = await getEnsueClient().readMemory(workerKeys.ERROR);

  return {
    workerId: WORKER_ID as any,
    status: (statusStr as TaskStatus) || 'idle',
    timestamp: timestampStr ? parseInt(timestampStr) : undefined,
    error: errorStr || undefined,
  };
}

/**
 * Initialize worker by setting idle status
 */
export async function initializeWorker(): Promise<void> {
  console.log(`[${WORKER_ID}] Initializing worker...`);

  try {
    // Set initial status to idle
    await updateStatus('idle');

    // Clear any previous error
    await getEnsueClient().deleteMemory(workerKeys.ERROR);

    console.log(`[${WORKER_ID}] Worker initialized successfully`);
  } catch (error) {
    console.error(`[${WORKER_ID}] Failed to initialize worker:`, error);
    throw error;
  }
}

// Initialization is called from index.ts after dotenv loads
