import { EnsueClient, createEnsueClient } from '../../../shared/src/ensue-client';
import {
  MEMORY_KEYS,
  getAllWorkerStatusKeys,
  getAllWorkerResultKeys,
} from '../../../shared/src/constants';
import type {
  CoordinationRequest,
  WorkerResult,
  TallyResult,
} from '../../../shared/src/types';
import crypto from 'crypto';
import {
  localStartCoordination,
  localCoordinatorResume,
  localRecordWorkerSubmissions,
} from '../contract/local-contract';

const LOCAL_MODE = process.env.LOCAL_MODE === 'true';

// Lazy-initialize Ensue client
let _ensueClient: EnsueClient | null = null;
function getEnsueClient(): EnsueClient {
  if (!_ensueClient) _ensueClient = createEnsueClient();
  return _ensueClient;
}

// Polling interval (5 seconds like verifiable-ai-dao/src/responder.ts:13)
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL) || 5000;

// Worker completion timeout (120 seconds - needs room for Nova load + AI inference + Nova record)
const WORKER_TIMEOUT = 120000;

/**
 * Start the coordination monitoring loop (production - polls contract)
 * Following verifiable-ai-dao/src/responder.ts pattern
 */
export function startCoordinationLoop(): void {
  console.log('Coordination loop started. Polling interval:', POLL_INTERVAL, 'ms');

  // Start polling loop
  setInterval(async () => {
    try {
      await checkAndCoordinate();
    } catch (error) {
      console.error('Coordination loop error:', error);
    }
  }, POLL_INTERVAL);
}

/**
 * Start local coordination loop (no contract, monitors Ensue only)
 * Workers are triggered via API, coordinator monitors Ensue for completions
 */
export function startLocalCoordinationLoop(): void {
  console.log('[LOCAL] Coordination monitor started. Polling interval:', POLL_INTERVAL, 'ms');

  setInterval(async () => {
    try {
      await checkLocalCoordination();
    } catch (error) {
      console.error('[LOCAL] Monitor error:', error);
    }
  }, POLL_INTERVAL);
}

/**
 * Manually trigger a local coordination (called from API route)
 */
export async function triggerLocalCoordination(taskConfig: string): Promise<TallyResult | null> {
  console.log('\n[LOCAL] Manual coordination triggered');
  console.log('[LOCAL] Task config:', taskConfig);

  try {
    // Step 1: Start coordination on-chain (creates yield + pending request)
    const configHash = crypto.createHash('sha256').update(taskConfig).digest('hex');
    console.log('[LOCAL] Starting on-chain coordination...');

    let proposalId: number | null = null;
    try {
      proposalId = await localStartCoordination(taskConfig);
      if (proposalId !== null) {
        console.log(`[LOCAL] On-chain proposal #${proposalId} created`);
        await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_PROPOSAL_ID, proposalId.toString());
      }
    } catch (err) {
      console.warn('[LOCAL] Contract call failed, continuing without on-chain:', err);
    }

    // Step 2: Update coordinator status
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'monitoring');

    // Step 3: Trigger all workers by writing task config to Ensue + HTTP
    await triggerWorkers(taskConfig);

    // Step 4: Monitor Ensue for worker completions
    const allCompleted = await waitForWorkers(WORKER_TIMEOUT);

    if (!allCompleted) {
      console.error('[LOCAL] Timeout waiting for workers to complete');
      await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'failed');
      return null;
    }

    // Step 5: Record worker submissions on-chain (nullifier)
    if (proposalId !== null) {
      await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'recording_submissions');
      console.log('[LOCAL] Recording worker submissions on-chain...');

      const resultKeys = getAllWorkerResultKeys();
      const workerResults = await getEnsueClient().readMultiple(resultKeys);
      // Only send worker_id + result_hash on-chain (nullifier).
      // Individual votes stay private in Ensue shared memory.
      const submissions = resultKeys
        .map(key => {
          const resultStr = workerResults[key];
          if (!resultStr) return null;
          try {
            const result = JSON.parse(resultStr);
            return {
              worker_id: result.workerId as string,
              result_hash: crypto.createHash('sha256').update(resultStr).digest('hex'),
            };
          } catch { return null; }
        })
        .filter((s): s is { worker_id: string; result_hash: string } => s !== null);

      try {
        const recorded = await localRecordWorkerSubmissions(proposalId, submissions);
        if (recorded) {
          console.log(`[LOCAL] Worker submissions recorded on-chain for proposal #${proposalId}`);
        } else {
          console.warn('[LOCAL] Failed to record worker submissions, continuing...');
        }
      } catch (err) {
        console.warn('[LOCAL] record_worker_submissions failed:', err);
      }
    }

    // Step 6: Aggregate results (vote tally)
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'aggregating');
    const tally = await aggregateResults(proposalId ?? 0);

    // Write tally to Ensue
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_TALLY, JSON.stringify(tally));
    console.log('\n[LOCAL] Aggregation complete:', JSON.stringify(tally, null, 2));

    // Step 7: Resume contract with on-chain settlement (privacy-preserving)
    if (proposalId !== null) {
      await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'resuming');
      const onChainResult = JSON.stringify({
        aggregatedValue: tally.aggregatedValue,
        approved: tally.approved,
        rejected: tally.rejected,
        decision: tally.decision,
        workerCount: tally.workerCount,
        timestamp: tally.timestamp,
        proposalId,
      });
      const resultHash = crypto.createHash('sha256').update(onChainResult).digest('hex');
      console.log('[LOCAL] Resuming contract with on-chain result...');

      try {
        const resumed = await localCoordinatorResume(proposalId, onChainResult, configHash, resultHash);
        if (resumed) {
          console.log(`[LOCAL] On-chain settlement complete for proposal #${proposalId}`);
        } else {
          console.warn('[LOCAL] Contract resume returned false');
        }
      } catch (err) {
        console.warn('[LOCAL] Contract resume failed:', err);
      }
    }

    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'completed');
    console.log('[LOCAL] Coordination completed');
    return tally;
  } catch (error) {
    console.error('[LOCAL] Coordination error:', error);
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'failed');
    return null;
  }
}

/**
 * Check local coordination status (monitors worker statuses in Ensue)
 */
async function checkLocalCoordination(): Promise<void> {
  const coordStatus = await getEnsueClient().readMemory(MEMORY_KEYS.COORDINATOR_STATUS);

  // Only log periodically when idle to reduce noise
  if (!coordStatus || coordStatus === 'idle' || coordStatus === 'completed') {
    return;
  }

  // Log active states
  const statusKeys = getAllWorkerStatusKeys();
  const statuses = await getEnsueClient().readMultiple(statusKeys);
  console.log('[LOCAL] Worker statuses:', {
    worker1: statuses[MEMORY_KEYS.WORKER1_STATUS] || 'unknown',
    worker2: statuses[MEMORY_KEYS.WORKER2_STATUS] || 'unknown',
    worker3: statuses[MEMORY_KEYS.WORKER3_STATUS] || 'unknown',
  });
}

/**
 * Check for pending coordinations and process them (production)
 * Following verifiable-ai-dao/src/responder.ts:10-71
 */
async function checkAndCoordinate(): Promise<void> {
  try {
    const { agentView } = await import('@neardefi/shade-agent-js');

    // Poll contract for pending coordinations (like verifiable-ai-dao)
    const pendingRequests: [number, CoordinationRequest][] = await agentView({
      methodName: 'get_pending_coordinations',
      args: {},
    });

    if (pendingRequests.length === 0) {
      return;
    }

    console.log(`Found ${pendingRequests.length} pending coordination(s)`);

    // Process the oldest pending coordination
    const [proposalId, request] = pendingRequests[0];
    console.log(`\nProcessing coordination #${proposalId}`);
    console.log('Task config:', request.task_config);
    console.log('Config hash:', request.config_hash);

    await processCoordination(proposalId, request);
  } catch (error) {
    if (error instanceof Error && error.message.includes('No pending coordination')) {
      return;
    }
    throw error;
  }
}

/**
 * Process a single coordination request (production)
 */
async function processCoordination(
  proposalId: number,
  request: CoordinationRequest
): Promise<void> {
  const { resumeContract } = await import('../contract/resume-handler');

  try {
    // Store proposal ID in Ensue for reference
    await getEnsueClient().updateMemory(
      MEMORY_KEYS.COORDINATOR_PROPOSAL_ID,
      proposalId.toString()
    );

    // Update coordinator status
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'monitoring');

    // Trigger all workers by writing task config to Ensue
    await triggerWorkers(request.task_config);

    // Monitor Ensue for worker completions
    const allCompleted = await waitForWorkers(WORKER_TIMEOUT);

    if (!allCompleted) {
      console.error('Timeout waiting for workers to complete');
      await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'failed');
      return;
    }

    // Record worker submissions on-chain (nullifier)
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'recording_submissions');
    console.log('Recording worker submissions on-chain...');

    // Only send worker_id + result_hash on-chain (nullifier).
    // Individual votes stay private in Ensue shared memory.
    const resultKeys = getAllWorkerResultKeys();
    const workerResults = await getEnsueClient().readMultiple(resultKeys);
    const submissions = resultKeys
      .map(key => {
        const resultStr = workerResults[key];
        if (!resultStr) return null;
        try {
          const result = JSON.parse(resultStr);
          return {
            worker_id: result.workerId as string,
            result_hash: crypto.createHash('sha256').update(resultStr).digest('hex'),
          };
        } catch { return null; }
      })
      .filter((s): s is { worker_id: string; result_hash: string } => s !== null);

    // Production path: use shade-agent-js for contract call
    const { agentCall } = await import('@neardefi/shade-agent-js');
    await agentCall({
      methodName: 'record_worker_submissions',
      args: { proposal_id: proposalId, submissions },
    });
    console.log(`Worker submissions recorded on-chain for proposal #${proposalId}`);

    // Update status to aggregating
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'aggregating');

    // Read and aggregate results
    const tally = await aggregateResults(proposalId);

    // Write tally to Ensue
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_TALLY, JSON.stringify(tally));

    console.log('\nAggregation complete:', tally);

    // Resume contract with results
    await resumeContractWithTally(proposalId, request, tally);
  } catch (error) {
    console.error(`Error processing coordination #${proposalId}:`, error);
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'failed');
    throw error;
  }
}

/**
 * Trigger all workers by writing task config to Ensue
 * In local mode, also call worker HTTP APIs directly
 */
async function triggerWorkers(taskConfig: string): Promise<void> {
  console.log('\nTriggering workers...');

  // Write task config to shared memory
  await getEnsueClient().updateMemory(MEMORY_KEYS.CONFIG_TASK_DEFINITION, taskConfig);

  // Reset all worker statuses to pending
  await getEnsueClient().updateMemory(MEMORY_KEYS.WORKER1_STATUS, 'pending');
  await getEnsueClient().updateMemory(MEMORY_KEYS.WORKER2_STATUS, 'pending');
  await getEnsueClient().updateMemory(MEMORY_KEYS.WORKER3_STATUS, 'pending');

  // In local mode, trigger workers via HTTP
  if (LOCAL_MODE) {
    const workerUrls = [
      'http://localhost:3001',
      'http://localhost:3002',
      'http://localhost:3003',
    ];

    const parsed = (() => { try { return JSON.parse(taskConfig); } catch { return { type: 'random' }; } })();

    await Promise.all(
      workerUrls.map(async (url) => {
        try {
          const res = await fetch(`${url}/api/task/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskConfig: parsed }),
          });
          const data = await res.json();
          console.log(`[LOCAL] Triggered ${url}:`, data);
        } catch (error) {
          console.error(`[LOCAL] Failed to trigger ${url}:`, error);
        }
      })
    );
  }

  console.log('Workers triggered, task config written to Ensue');
}

/**
 * Wait for all workers to complete their tasks
 * Polls Ensue every second until all workers show "completed" status
 */
async function waitForWorkers(timeout: number): Promise<boolean> {
  console.log('\nMonitoring worker statuses...');

  const startTime = Date.now();
  const statusKeys = getAllWorkerStatusKeys();

  while (Date.now() - startTime < timeout) {
    // Read all worker statuses from Ensue
    const statuses = await getEnsueClient().readMultiple(statusKeys);

    const worker1Status = statuses[MEMORY_KEYS.WORKER1_STATUS];
    const worker2Status = statuses[MEMORY_KEYS.WORKER2_STATUS];
    const worker3Status = statuses[MEMORY_KEYS.WORKER3_STATUS];

    console.log('Worker statuses:', {
      worker1: worker1Status || 'unknown',
      worker2: worker2Status || 'unknown',
      worker3: worker3Status || 'unknown',
    });

    // Check if all workers completed
    if (
      worker1Status === 'completed' &&
      worker2Status === 'completed' &&
      worker3Status === 'completed'
    ) {
      console.log('All workers completed!');
      return true;
    }

    // Check for failures
    if (
      worker1Status === 'failed' ||
      worker2Status === 'failed' ||
      worker3Status === 'failed'
    ) {
      console.error('One or more workers failed');
      // Continue anyway to aggregate partial results
      return true;
    }

    // Wait before next check
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.error('Timeout waiting for workers');
  return false;
}

/**
 * Aggregate results from all workers — vote tally for DAO proposals,
 * sum for legacy numeric tasks.
 */
async function aggregateResults(proposalId: number): Promise<TallyResult> {
  console.log('\nAggregating worker results...');

  // Read all worker results from Ensue
  const resultKeys = getAllWorkerResultKeys();
  const results = await getEnsueClient().readMultiple(resultKeys);

  // Parse worker results
  const workerResults: WorkerResult[] = [];

  for (const key of resultKeys) {
    const resultStr = results[key];
    if (resultStr) {
      try {
        const result = JSON.parse(resultStr);
        workerResults.push(result);
        if (result.output?.vote) {
          console.log(`Worker ${result.workerId} vote: ${result.output.vote}`);
        } else {
          console.log(`Worker ${result.workerId} result:`, result.output.value);
        }
      } catch (error) {
        console.error(`Failed to parse result for ${key}:`, error);
      }
    }
  }

  // Tally votes if any worker voted, otherwise sum values (backward compat)
  const hasVotes = workerResults.some(r => r.output?.vote);
  let approved = 0;
  let rejected = 0;

  if (hasVotes) {
    for (const r of workerResults) {
      if (r.output?.vote === 'Approved') approved++;
      else if (r.output?.vote === 'Rejected') rejected++;
    }
    console.log(`\nVote tally: ${approved} Approved, ${rejected} Rejected`);
  }

  const aggregatedValue = hasVotes
    ? approved  // For vote tasks, aggregatedValue = number of approvals
    : workerResults.reduce((sum, r) => sum + (r.output?.value || 0), 0);

  const decision = approved >= rejected ? 'Approved' : 'Rejected';

  const tally: TallyResult = {
    aggregatedValue,
    approved,
    rejected,
    decision: hasVotes ? decision : 'Approved',
    workerCount: workerResults.length,
    workers: workerResults,
    timestamp: new Date().toISOString(),
    proposalId,
  };

  return tally;
}

/**
 * Resume contract with aggregated results (production only)
 */
async function resumeContractWithTally(
  proposalId: number,
  request: CoordinationRequest,
  tally: TallyResult
): Promise<void> {
  const { resumeContract } = await import('../contract/resume-handler');

  console.log('\nResuming contract...');

  // Update status to resuming
  await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'resuming');

  // Privacy: only send aggregate on-chain, NOT individual worker reasoning
  // Worker-level reasoning stays private in Ensue shared memory
  const onChainResult = JSON.stringify({
    aggregatedValue: tally.aggregatedValue,
    approved: tally.approved,
    rejected: tally.rejected,
    decision: tally.decision,
    workerCount: tally.workerCount,
    timestamp: tally.timestamp,
    proposalId,
  });
  const configHash = request.config_hash;
  const resultHash = crypto.createHash('sha256').update(onChainResult).digest('hex');

  console.log('Proposal ID:', proposalId);
  console.log('Config hash:', configHash);
  console.log('Result hash:', resultHash);
  console.log('Result length:', onChainResult.length);

  // Resume contract with privacy-preserving result
  await resumeContract(proposalId, onChainResult, configHash, resultHash);

  // Update status to completed
  await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'completed');

  console.log('Contract resumed successfully!');
}
