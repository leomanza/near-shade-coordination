import { EnsueClient, createEnsueClient } from '@near-shade-coordination/shared';
import {
  MEMORY_KEYS,
  getWorkerKeys,
  getProposalKeys,
  getProposalWorkerKeys,
  getCoordinatorSnapshotKey,
  PROPOSAL_INDEX_KEY,
} from '@near-shade-coordination/shared';
import { getAgentDid } from '../storacha/identity';
import type {
  CoordinationRequest,
  WorkerResult,
  TallyResult,
} from '@near-shade-coordination/shared';
import crypto from 'crypto';
import {
  localStartCoordination,
  localCoordinatorResume,
  localRecordWorkerSubmissions,
} from '../contract/local-contract';
import { backupDeliberation, isVaultConfigured } from '../storacha/vault';
import { backupEnsueTree } from '../storacha/ensue-backup';
import { archiveCID, logArchivalToNear } from '../filecoin/archiver';

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

/* ─── Dynamic Worker Discovery (Registry-based) ─────────────────────────── */

interface WorkerRecord {
  account_id: string;
  coordinator_did: string;
  worker_did: string;
  endpoint_url: string;
  cvm_id: string;
  registered_at: number;
  is_active: boolean;
}

/**
 * Query the NEAR registry contract for active workers assigned to this coordinator.
 * Falls back to WORKERS env for backward compatibility (LOCAL_MODE without registry).
 */
async function getActiveWorkers(): Promise<WorkerRecord[]> {
  try {
    const { localViewRegistry } = await import('../contract/local-contract');
    const coordinatorDID = await getAgentDid();
    const workers = await localViewRegistry<WorkerRecord[]>('get_workers_for_coordinator', {
      coordinator_did: coordinatorDID,
    });
    if (workers && workers.length > 0) {
      return workers.filter(w => w.is_active);
    }
  } catch (err) {
    console.warn('[discovery] Registry query failed, falling back to WORKERS env:', err);
  }

  // Fallback: parse WORKERS env (backward compatible with LOCAL_MODE)
  return getWorkerRecordsFromEnv();
}

/**
 * Fallback: build WorkerRecord[] from the WORKERS env variable.
 * Used when registry is unavailable or empty.
 */
function getWorkerRecordsFromEnv(): WorkerRecord[] {
  const workersEnv = process.env.WORKERS;
  const entries: Array<{ id: string; url: string }> = [];

  if (workersEnv) {
    for (const entry of workersEnv.split(',')) {
      const trimmed = entry.trim();
      if (trimmed.includes('|')) {
        const [id, ...urlParts] = trimmed.split('|');
        entries.push({ id, url: urlParts.join('|') });
      } else {
        const [id, port] = trimmed.split(':');
        entries.push({ id, url: `http://localhost:${port}` });
      }
    }
  } else {
    entries.push(
      { id: 'worker1', url: 'http://localhost:3001' },
      { id: 'worker2', url: 'http://localhost:3002' },
      { id: 'worker3', url: 'http://localhost:3003' },
    );
  }

  return entries.map(e => ({
    account_id: '',
    coordinator_did: '',
    worker_did: e.id,           // Use worker name as DID fallback
    endpoint_url: e.url,
    cvm_id: '',
    registered_at: 0,
    is_active: true,
  }));
}

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
    // Step 1: Take snapshot of active workers from registry
    const configHash = crypto.createHash('sha256').update(taskConfig).digest('hex');
    console.log('[LOCAL] Discovering active workers from registry...');

    const workers = await getActiveWorkers();
    const minWorkers = parseInt(process.env.MIN_WORKERS ?? '1');
    const maxWorkers = parseInt(process.env.MAX_WORKERS ?? '10');

    if (workers.length < minWorkers) {
      console.warn(`[LOCAL] Not enough active workers (${workers.length} < ${minWorkers}). Cannot start coordination.`);
      await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'idle');
      return null;
    }

    // Limit to max_workers
    const activeWorkers = workers.slice(0, maxWorkers);

    // Parse voting_config from task config for per-proposal overrides
    let parsedConfig: any = {};
    try { parsedConfig = JSON.parse(taskConfig); } catch { /* ignore */ }
    const votingConfig = parsedConfig?.parameters?.voting_config;
    const effectiveMinWorkers = votingConfig?.min_workers ?? minWorkers;
    const effectiveQuorum = votingConfig?.quorum ?? 0; // 0 = coordinator enforces majority

    if (activeWorkers.length < effectiveMinWorkers) {
      console.warn(`[LOCAL] Not enough workers for this proposal (${activeWorkers.length} < ${effectiveMinWorkers}).`);
      await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'idle');
      return null;
    }

    console.log(`[LOCAL] ${activeWorkers.length} active workers discovered: [${activeWorkers.map(w => w.worker_did).join(', ')}]`);

    // Step 2: Start coordination on-chain (creates yield + pending request)
    console.log('[LOCAL] Starting on-chain coordination...');

    let proposalId: number | null = null;
    try {
      proposalId = await localStartCoordination(taskConfig, activeWorkers.length, effectiveQuorum);
      if (proposalId !== null) {
        console.log(`[LOCAL] On-chain proposal #${proposalId} created`);
        await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_PROPOSAL_ID, proposalId.toString());

        // Store worker snapshot for this proposal (prevents mid-vote registration changes)
        // getCoordinatorSnapshotKey imported at top level
        await getEnsueClient().updateMemory(
          getCoordinatorSnapshotKey(proposalId),
          JSON.stringify(activeWorkers.map(w => w.worker_did))
        );
      }
    } catch (err) {
      console.warn('[LOCAL] Contract call failed, continuing without on-chain:', err);
    }

    // Step 3: Update coordinator status
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'monitoring');

    // Step 4: Trigger all workers by writing task config to Ensue + HTTP
    await triggerWorkers(taskConfig, activeWorkers);

    // Step 5: Monitor Ensue for worker completions
    const workerDIDs = activeWorkers.map(w => w.worker_did);
    const allCompleted = await waitForWorkers(workerDIDs, WORKER_TIMEOUT);

    if (!allCompleted) {
      console.error('[LOCAL] Timeout waiting for workers to complete');
      await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'failed');
      return null;
    }

    // Step 6: Record worker submissions on-chain (nullifier)
    if (proposalId !== null) {
      await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'recording_submissions');
      console.log('[LOCAL] Recording worker submissions on-chain...');

      const resultKeys = workerDIDs.map(did => getWorkerKeys(did).RESULT);
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

    // Step 7: Aggregate results (vote tally)
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'aggregating');
    const tally = await aggregateResults(proposalId ?? 0);

    // Write tally to Ensue (ephemeral — for real-time UI)
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_TALLY, JSON.stringify(tally));
    console.log('\n[LOCAL] Aggregation complete:', JSON.stringify(tally, null, 2));

    // Step 7b: Archive proposal to Ensue (persistent history)
    const pid = proposalId?.toString() ?? `local-${Date.now()}`;
    await archiveProposal(pid, taskConfig, tally, workerDIDs);

    // Step 6c: Back up deliberation to Storacha (encrypted, persistent)
    if (isVaultConfigured()) {
      backupDeliberation(pid, taskConfig, tally).then(cid => {
        if (cid) {
          console.log(`[LOCAL] Deliberation backed up to Storacha. CID: ${cid}`);
          // Step 6e: Archive to Filecoin (cold storage)
          archiveCID(cid).then(record => {
            console.log(`[LOCAL] Filecoin archival: ${record.status}, deal ref: ${record.dealReference}`);
            logArchivalToNear(record, pid).catch(() => {});
          }).catch(err =>
            console.warn('[LOCAL] Filecoin archival failed (non-fatal):', err)
          );
        }
      }).catch(err =>
        console.warn('[LOCAL] Storacha deliberation backup failed (non-fatal):', err)
      );

      // Step 6d: Serialize full Ensue tree and back up to Storacha
      backupEnsueTree().then(cid => {
        if (cid) {
          console.log(`[LOCAL] Ensue tree backed up to Storacha. CID: ${cid}`);
          // Archive Ensue tree to Filecoin too
          archiveCID(cid).then(record => {
            console.log(`[LOCAL] Ensue tree Filecoin archival: ${record.status}, deal ref: ${record.dealReference}`);
          }).catch(() => {});
        }
      }).catch(err =>
        console.warn('[LOCAL] Ensue tree backup failed (non-fatal):', err)
      );
    }

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

  // Log active states — try to use snapshot DIDs, fall back to registry
  let workerDIDs: string[] = [];
  const proposalIdStr = await getEnsueClient().readMemory(MEMORY_KEYS.COORDINATOR_PROPOSAL_ID);
  if (proposalIdStr) {
    // getCoordinatorSnapshotKey imported at top level
    const snapshotStr = await getEnsueClient().readMemory(getCoordinatorSnapshotKey(proposalIdStr));
    if (snapshotStr) {
      try { workerDIDs = JSON.parse(snapshotStr); } catch { /* ignore */ }
    }
  }
  if (workerDIDs.length === 0) {
    const workers = await getActiveWorkers();
    workerDIDs = workers.map(w => w.worker_did);
  }
  const statusKeys = workerDIDs.map(did => getWorkerKeys(did).STATUS);
  const statuses = await getEnsueClient().readMultiple(statusKeys);
  const statusMap: Record<string, string> = {};
  for (const did of workerDIDs) {
    statusMap[did] = statuses[getWorkerKeys(did).STATUS] || 'unknown';
  }
  console.log('[LOCAL] Worker statuses:', statusMap);
}

/**
 * Check for pending coordinations and process them (production)
 * Following verifiable-ai-dao/src/responder.ts:10-71
 */
async function checkAndCoordinate(): Promise<void> {
  try {
    const { getAgent } = await import('../shade-client');
    const agent = getAgent();

    // Poll contract for pending coordinations (like verifiable-ai-dao)
    const pendingRequests: [number, CoordinationRequest][] = await agent.view({
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

    // Discover active workers and snapshot them for this proposal
    const activeWorkers = await getActiveWorkers();
    const workerDIDs = activeWorkers.map(w => w.worker_did);
    // getCoordinatorSnapshotKey imported at top level
    await getEnsueClient().updateMemory(
      getCoordinatorSnapshotKey(proposalId),
      JSON.stringify(workerDIDs)
    );

    // Update coordinator status
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'monitoring');

    // Trigger all workers by writing task config to Ensue
    await triggerWorkers(request.task_config, activeWorkers);

    // Monitor Ensue for worker completions
    const allCompleted = await waitForWorkers(workerDIDs, WORKER_TIMEOUT);

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
    const resultKeys = workerDIDs.map(did => getWorkerKeys(did).RESULT);
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

    // Production path: use ShadeClient v2 for contract call
    const { getAgent } = await import('../shade-client');
    await getAgent().call({
      methodName: 'record_worker_submissions',
      args: { proposal_id: proposalId, submissions },
    });
    console.log(`Worker submissions recorded on-chain for proposal #${proposalId}`);

    // Update status to aggregating
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'aggregating');

    // Read and aggregate results
    const tally = await aggregateResults(proposalId);

    // Write tally to Ensue (ephemeral)
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_TALLY, JSON.stringify(tally));

    console.log('\nAggregation complete:', tally);

    // Archive proposal to Ensue (persistent history)
    await archiveProposal(proposalId.toString(), request.task_config, tally, workerDIDs);

    // Back up deliberation to Storacha (encrypted, persistent)
    if (isVaultConfigured()) {
      backupDeliberation(proposalId, request.task_config, tally).then(cid => {
        if (cid) {
          console.log(`Deliberation backed up to Storacha. CID: ${cid}`);
          archiveCID(cid).then(record => {
            console.log(`Filecoin archival: ${record.status}, deal ref: ${record.dealReference}`);
            logArchivalToNear(record, proposalId).catch(() => {});
          }).catch(err =>
            console.warn('Filecoin archival failed (non-fatal):', err)
          );
        }
      }).catch(err =>
        console.warn('Storacha deliberation backup failed (non-fatal):', err)
      );

      // Serialize full Ensue tree and back up to Storacha
      backupEnsueTree().then(cid => {
        if (cid) {
          console.log(`Ensue tree backed up to Storacha. CID: ${cid}`);
          archiveCID(cid).then(record => {
            console.log(`Ensue tree Filecoin archival: ${record.status}, deal ref: ${record.dealReference}`);
          }).catch(() => {});
        }
      }).catch(err =>
        console.warn('Ensue tree backup failed (non-fatal):', err)
      );
    }

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
async function triggerWorkers(taskConfig: string, workers: WorkerRecord[]): Promise<void> {
  console.log('\nTriggering workers...');

  // Write task config to shared memory
  await getEnsueClient().updateMemory(MEMORY_KEYS.CONFIG_TASK_DEFINITION, taskConfig);

  // Reset all worker statuses to pending
  await Promise.all(
    workers.map(w => getEnsueClient().updateMemory(getWorkerKeys(w.worker_did).STATUS, 'pending'))
  );

  // In local mode, trigger workers via HTTP
  if (LOCAL_MODE) {
    const parsed = (() => { try { return JSON.parse(taskConfig); } catch { return { type: 'random' }; } })();

    await Promise.all(
      workers.map(async (w) => {
        try {
          const res = await fetch(`${w.endpoint_url}/api/task/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskConfig: parsed }),
          });
          const data = await res.json();
          console.log(`[LOCAL] Triggered ${w.worker_did} (${w.endpoint_url}):`, data);
        } catch (error) {
          console.error(`[LOCAL] Failed to trigger ${w.worker_did} (${w.endpoint_url}):`, error);
        }
      })
    );
  }

  console.log(`Workers triggered (${workers.length}), task config written to Ensue`);
}

/**
 * Wait for all workers to complete their tasks
 * Polls Ensue every second until all workers show "completed" status
 */
async function waitForWorkers(workerDIDs: string[], timeout: number): Promise<boolean> {
  console.log(`\nMonitoring ${workerDIDs.length} worker statuses...`);

  if (workerDIDs.length === 0) {
    console.warn('[LOCAL] No workers to wait for');
    return false;
  }

  const startTime = Date.now();
  const statusKeys = workerDIDs.map(did => getWorkerKeys(did).STATUS);

  while (Date.now() - startTime < timeout) {
    // Read all worker statuses from Ensue
    const statuses = await getEnsueClient().readMultiple(statusKeys);

    const statusMap: Record<string, string> = {};
    let allDone = true;
    let anyFailed = false;

    for (const did of workerDIDs) {
      const status = statuses[getWorkerKeys(did).STATUS] || 'unknown';
      statusMap[did] = status;
      if (status !== 'completed' && status !== 'failed') allDone = false;
      if (status === 'failed') anyFailed = true;
    }

    console.log('Worker statuses:', statusMap);

    if (allDone) {
      if (anyFailed) {
        console.error('One or more workers failed');
      } else {
        console.log('All workers completed!');
      }
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

  // Read worker DIDs from snapshot (taken at vote start)
  // getCoordinatorSnapshotKey imported at top level
  const snapshotStr = await getEnsueClient().readMemory(getCoordinatorSnapshotKey(proposalId));
  let workerDIDs: string[] = [];
  if (snapshotStr) {
    try { workerDIDs = JSON.parse(snapshotStr); } catch { /* ignore */ }
  }
  // Fallback if no snapshot (e.g. local-0 proposals)
  if (workerDIDs.length === 0) {
    const workers = await getActiveWorkers();
    workerDIDs = workers.map(w => w.worker_did);
  }

  // Parse voting_config for quorum
  const taskConfigStr = await getEnsueClient().readMemory(MEMORY_KEYS.CONFIG_TASK_DEFINITION);
  let votingConfig: { min_workers?: number; quorum?: number } | undefined;
  try {
    const parsed = JSON.parse(taskConfigStr ?? '{}');
    votingConfig = parsed?.parameters?.voting_config;
  } catch { /* ignore */ }

  const resultKeys = workerDIDs.map(did => getWorkerKeys(did).RESULT);
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

  // Quorum-aware decision: use voting_config.quorum if set, otherwise strict majority
  const minPositives = votingConfig?.quorum ?? (Math.floor(workerDIDs.length / 2) + 1);
  const decision = hasVotes ? (approved >= minPositives ? 'Approved' : 'Rejected') : 'Approved';

  const tally: TallyResult = {
    aggregatedValue,
    approved,
    rejected,
    decision,
    workerCount: workerResults.length,
    workers: workerResults,
    timestamp: new Date().toISOString(),
    proposalId,
  };

  return tally;
}

/* ─── Proposal Archiving ─────────────────────────────────────────────────── */

/**
 * Archive a completed proposal to Ensue persistent history.
 * Stores per-worker results and aggregate tally under proposal-scoped keys.
 */
async function archiveProposal(
  proposalId: string,
  taskConfig: string,
  tally: TallyResult,
  workerIds: string[],
): Promise<void> {
  console.log(`[archive] Archiving proposal ${proposalId}...`);
  const client = getEnsueClient();

  try {
    const pKeys = getProposalKeys(proposalId);

    // Archive config, tally, and status
    await client.updateMemory(pKeys.CONFIG, taskConfig);
    await client.updateMemory(pKeys.TALLY, JSON.stringify(tally));
    await client.updateMemory(pKeys.STATUS, 'completed');

    // Archive each worker's result
    for (const workerId of workerIds) {
      const ephResult = await client.readMemory(getWorkerKeys(workerId).RESULT);
      if (ephResult) {
        const wKeys = getProposalWorkerKeys(proposalId, workerId);
        await client.updateMemory(wKeys.RESULT, ephResult);
        await client.updateMemory(wKeys.TIMESTAMP, new Date().toISOString());
      }
    }

    // Update proposal index
    let index: string[] = [];
    try {
      const existing = await client.readMemory(PROPOSAL_INDEX_KEY);
      if (existing) index = JSON.parse(existing);
    } catch { /* first proposal */ }

    if (!index.includes(proposalId)) {
      index.push(proposalId);
      await client.updateMemory(PROPOSAL_INDEX_KEY, JSON.stringify(index));
    }

    console.log(`[archive] Proposal ${proposalId} archived (${workerIds.length} workers)`);
  } catch (error) {
    console.error(`[archive] Failed to archive proposal ${proposalId}:`, error);
    // Non-fatal — coordination still succeeded
  }
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
