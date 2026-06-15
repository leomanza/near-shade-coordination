import { EnsueClient, createEnsueClient, NameResolver } from '@delibera-xyz/shared';
import {
  MEMORY_KEYS,
  getWorkerKeys,
  getProposalKeys,
  getProposalWorkerKeys,
  getCoordinatorSnapshotKey,
  PROPOSAL_INDEX_KEY,
} from '@delibera-xyz/shared';
import { getAgentDid } from '../storacha/identity';
import type {
  CoordinationRequest,
  WorkerResult,
  TallyResult,
} from '@delibera-xyz/shared';
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

// Lazy-initialize NameResolver (caches display names for worker DIDs)
let _nameResolver: NameResolver | null = null;
function getNameResolver(): NameResolver {
  if (!_nameResolver) _nameResolver = new NameResolver(getEnsueClient());
  return _nameResolver;
}

// Polling interval (5 seconds like verifiable-ai-dao/src/responder.ts:13)
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL) || 5000;

// Worker completion timeout (120 seconds - needs room for Nova load + AI inference + Nova record)
const WORKER_TIMEOUT = 120000;

/* ─── Dynamic Worker Discovery (Registry-based) ─────────────────────────── */

interface WorkerRecord {
  account_id: string;
  worker_did: string;
  endpoint_url: string;
  cvm_id: string;
  registered_at: number;
  is_active: boolean;
}

/**
 * Probe a worker's endpoint and return true if it responds within the timeout
 * and reports its workerDid matching the registry entry. This prevents the
 * coordinator from waiting on stale registry entries (workers that were
 * previously registered but are no longer running). Errors/timeouts → false.
 */
async function probeWorker(worker: WorkerRecord, timeoutMs = 3000): Promise<boolean> {
  if (!worker.endpoint_url) return false;
  try {
    const res = await fetch(`${worker.endpoint_url}/`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = await res.json() as { workerDid?: string };
    return !body.workerDid || body.workerDid === worker.worker_did;
  } catch {
    return false;
  }
}

/**
 * Query the NEAR registry contract for active workers assigned to this coordinator.
 * Filters out unreachable workers (stale registrations from previous runs) by
 * probing each endpoint in parallel — this matches the liveness check in
 * routes/coordinate.ts#filterValidatedWorkers and prevents waitForWorkers()
 * from timing out on workers that no longer exist.
 * Falls back to WORKERS env for backward compatibility (LOCAL_MODE without registry).
 * Discover active workers.
 *
 * Workers are first-class entities in the registry — there's no coordinator
 * pairing. We list ALL active workers and (in the future) filter client-side
 * by capability/tag/out-of-band agreement. For now, no filter — all active
 * workers are considered.
 *
 * Discovery order:
 *   1. If LOCAL_MODE=true AND WORKERS env is explicitly set, use WORKERS only
 *      (sandbox/dev override; explicit user intent wins).
 *   2. Otherwise query the NEAR registry contract via `list_active_workers()`.
 *   3. Fall back to WORKERS env (or hardcoded LOCAL_MODE defaults).
 */
async function getActiveWorkers(): Promise<WorkerRecord[]> {
  // Sandbox / dev override: explicit WORKERS env in LOCAL_MODE skips registry lookup
  if (process.env.LOCAL_MODE === 'true' && process.env.WORKERS) {
    console.log('[discovery] LOCAL_MODE + WORKERS env set — skipping registry, using WORKERS only');
    return getWorkerRecordsFromEnv();
  }

  try {
    const { localViewRegistry } = await import('../contract/local-contract');
    // TODO: when capability tags ship, filter `workers` by `capabilities ⊇ requiredCapabilities`
    // or by per-worker out-of-band agreement. For now, every active worker is a candidate.
    const workers = await localViewRegistry<WorkerRecord[]>('list_active_workers', {});
    if (workers && workers.length > 0) {
      const activeFlagged = workers.filter(w => w.is_active);

      // Liveness filter: probe each endpoint in parallel and drop dead ones.
      const probes = await Promise.all(
        activeFlagged.map(async (w) => ({ worker: w, alive: await probeWorker(w) })),
      );
      const reachable = probes.filter(p => p.alive).map(p => p.worker);
      const dropped = probes.length - reachable.length;
      if (dropped > 0) {
        const deadDids = probes.filter(p => !p.alive).map(p => p.worker.worker_did);
        console.warn(
          `[discovery] ${dropped} registered worker(s) unreachable, skipping: ${deadDids.join(', ')}`,
        );
      }
      return reachable;
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
/**
 * Parse the WORKERS env var.
 *
 * Supported formats (per entry, comma-separated):
 *   - "did|url"           → cvm_id = ''   (legacy Phala-style HTTP worker)
 *   - "did|url|cvm_id"    → cvm_id = the 3rd field (use "ironclaw-*" to route to webhook dispatch)
 *   - "id:port"           → did=id, url=http://localhost:port, cvm_id=''
 *
 * The `cvm_id` field controls dispatch routing in triggerWorkers():
 *   - cvm_id starts with "ironclaw-" → POST /webhook with HMAC X-Hub-Signature-256
 *   - anything else                  → POST /api/task/execute (existing TypeScript-worker flow)
 */
function getWorkerRecordsFromEnv(): WorkerRecord[] {
  const workersEnv = process.env.WORKERS;
  const entries: Array<{ id: string; url: string; cvm_id: string }> = [];

  if (workersEnv) {
    // Drop empty entries from trailing commas / typos like 'a,,b'. An empty entry
    // would otherwise produce {id:'', url:'', cvm_id:''} and pollute the active-worker
    // set with a ghost row whose Ensue keys collide at "coordination/tasks//status".
    const rawEntries = workersEnv
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    for (const trimmed of rawEntries) {
      if (trimmed.includes('|')) {
        const parts = trimmed.split('|');
        const [id, url, cvm_id] = parts;
        entries.push({
          id: id ?? '',
          url: url ?? '',
          cvm_id: cvm_id ?? '',
        });
      } else {
        const [id, port] = trimmed.split(':');
        entries.push({ id, url: `http://localhost:${port}`, cvm_id: '' });
      }
    }
  } else if (process.env.LOCAL_MODE === 'true') {
    // No WORKERS env — fallback to hardcoded local TypeScript workers.
    entries.push(
      { id: 'worker1', url: 'http://localhost:3001', cvm_id: '' },
      { id: 'worker2', url: 'http://localhost:3002', cvm_id: '' },
      { id: 'worker3', url: 'http://localhost:3003', cvm_id: '' },
    );
  }

  // Also drop entries whose id is empty after parsing — a guard against pathologically
  // malformed entries like '|http://x|cvm' that pass the .length>0 filter above.
  return entries
    .filter(e => e.id.length > 0)
    .map(e => ({
      account_id: '',
      worker_did: e.id,
      endpoint_url: e.url,
      cvm_id: e.cvm_id,
      registered_at: 0,
      is_active: true,
    }));
}

/** Exported for unit tests only — thin wrapper around the module-private parser. */
export function getWorkerRecordsFromEnvForTest(): WorkerRecord[] {
  return getWorkerRecordsFromEnv();
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

    // Step 2: Update coordinator status
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'monitoring');

    // Step 3: Trigger all workers by writing task config to Ensue + HTTP
    // triggerWorkers may filter out unreachable workers (modifies array in-place)
    await triggerWorkers(taskConfig, activeWorkers);

    // Re-check min workers after filtering unreachable ones
    if (activeWorkers.length < effectiveMinWorkers) {
      console.warn(`[LOCAL] Not enough reachable workers (${activeWorkers.length} < ${effectiveMinWorkers}). Aborting.`);
      await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'idle');
      return null;
    }

    // Step 4: Start coordination on-chain with actual reachable worker count
    console.log('[LOCAL] Starting on-chain coordination...');

    let proposalId: number | null = null;
    try {
      proposalId = await localStartCoordination(taskConfig, activeWorkers.length, effectiveQuorum);
      if (proposalId !== null) {
        console.log(`[LOCAL] On-chain proposal #${proposalId} created`);
        await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_PROPOSAL_ID, proposalId.toString());

        // Store worker snapshot for this proposal (only reachable workers)
        await getEnsueClient().updateMemory(
          getCoordinatorSnapshotKey(proposalId),
          JSON.stringify(activeWorkers.map(w => w.worker_did))
        );
      }
    } catch (err) {
      console.warn('[LOCAL] Contract call failed, continuing without on-chain:', err);
    }

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
      const workerResults = await readResultsWithRetry(resultKeys);
      // Only send worker_id + result_hash on-chain (nullifier).
      // Individual votes stay private in Ensue shared memory.
      // worker_id is preferred from the JSON, but the Ensue key path (coordination/tasks/{DID}/result)
      // is the source of truth — IronClaw workers don't include workerId in their JSON.
      const extractWorkerIdFromKey = (key: string): string => {
        const m = key.match(/coordination\/tasks\/([^/]+)\/result/);
        return m ? m[1] : '';
      };
      const submissions = resultKeys
        .map(key => {
          const resultStr = workerResults[key];
          if (!resultStr) return null;
          try {
            const result = JSON.parse(resultStr);
            const worker_id = (result.workerId as string) || extractWorkerIdFromKey(key);
            if (!worker_id) return null;
            return {
              worker_id,
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
    // Per coordinator architecture spec Q2=(a), Delibera business-logic calls
    // go through delibera-client (separate from agent-registry contract that
    // ShadeClient targets). See doc/plans/coordinator-architecture/00-spec.md.
    const { deliberaView } = await import('../contract/delibera-client');

    // Poll Delibera coordinator contract for pending coordinations
    const pendingRequests: [number, CoordinationRequest][] = await deliberaView(
      'get_pending_coordinations',
      {},
    );

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

    // Discover active workers
    const activeWorkers = await getActiveWorkers();

    // Update coordinator status
    await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'monitoring');

    // Trigger all workers — this MUTATES `activeWorkers` to remove unreachable ones,
    // so workerDIDs MUST be read AFTER this call. Reading before would poll dead workers
    // until WORKER_TIMEOUT and fail the coordination instead of completing with the
    // reachable subset.
    await triggerWorkers(request.task_config, activeWorkers);

    const workerDIDs = activeWorkers.map(w => w.worker_did);
    if (workerDIDs.length === 0) {
      console.error('[coordinator] No reachable workers — all dispatches failed');
      await getEnsueClient().updateMemory(MEMORY_KEYS.COORDINATOR_STATUS, 'failed');
      return;
    }

    // Snapshot the actual (post-filter) worker set for this proposal so downstream
    // archival + verification sees the same DIDs that voted.
    await getEnsueClient().updateMemory(
      getCoordinatorSnapshotKey(proposalId),
      JSON.stringify(workerDIDs)
    );

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
    // worker_id is preferred from JSON, falls back to extracting from the Ensue key path.
    const resultKeys = workerDIDs.map(did => getWorkerKeys(did).RESULT);
    const workerResults = await readResultsWithRetry(resultKeys);
    const extractWorkerIdFromResultKey = (key: string): string => {
      const m = key.match(/coordination\/tasks\/([^/]+)\/result/);
      return m ? m[1] : '';
    };
    const submissions = resultKeys
      .map(key => {
        const resultStr = workerResults[key];
        if (!resultStr) return null;
        try {
          const result = JSON.parse(resultStr);
          const worker_id = (result.workerId as string) || extractWorkerIdFromResultKey(key);
          if (!worker_id) return null;
          return {
            worker_id,
            result_hash: crypto.createHash('sha256').update(resultStr).digest('hex'),
          };
        } catch { return null; }
      })
      .filter((s): s is { worker_id: string; result_hash: string } => s !== null);

    // Delibera coordinator contract call (separate from agent-registry per Q2=(a))
    const { deliberaCall } = await import('../contract/delibera-client');
    await deliberaCall('record_worker_submissions', {
      proposal_id: proposalId,
      submissions,
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
 * Trigger all workers by writing task config to Ensue.
 * In local mode, also HTTP-dispatches to TypeScript workers (/api/task/execute).
 * IronClaw workers (cvm_id starts with "ironclaw-") always dispatch via /webhook.
 */
async function triggerWorkers(taskConfig: string, workers: WorkerRecord[]): Promise<void> {
  console.log('\nTriggering workers...');

  // Write task config to shared memory — this is BOTH the activation payload for
  // push workers (echoed inside the webhook body) and the polling key for pull
  // workers (they read this directly from Ensue on their own cadence).
  await getEnsueClient().updateMemory(MEMORY_KEYS.CONFIG_TASK_DEFINITION, taskConfig);

  // Reset all worker statuses to pending — applies to push AND polling workers
  // so the dashboard reflects "task assigned, waiting for vote" for everyone.
  await Promise.all(
    workers.map(w => getEnsueClient().updateMemory(getWorkerKeys(w.worker_did).STATUS, 'pending'))
  );

  // Polling workers (dispatch.type=ensue_polling) register with a non-http endpoint_url
  // marker (e.g. "ensue://socialcap" or "polling://..."). They never receive a webhook;
  // they read the task from Ensue on their own cadence. We skip HTTP dispatch for them
  // entirely — the task-definition write above is the only signal they need.
  // Doc: doc/plans/dispatch-modes/00-spec.md
  const isPollingWorker = (w: WorkerRecord): boolean =>
    !/^https?:\/\//i.test(w.endpoint_url ?? '');

  const pollingWorkers = workers.filter(isPollingWorker);
  if (pollingWorkers.length > 0) {
    console.log(
      `[polling] ${pollingWorkers.length} pull-mode worker(s) — task written to Ensue, ` +
      `they'll pick it up on their next poll:`,
    );
    for (const w of pollingWorkers) {
      console.log(`  ${w.worker_did} (endpoint=${w.endpoint_url || '<none>'})`);
    }
  }

  // Shared set — both LOCAL_MODE and ironclaw blocks add to this
  const unreachableWorkers: Set<string> = new Set();

  // In local mode, trigger TypeScript workers via HTTP /api/task/execute
  if (LOCAL_MODE) {
    const parsed = (() => { try { return JSON.parse(taskConfig); } catch { return { type: 'random' }; } })();

    await Promise.all(
      workers
        .filter(w => !(w.cvm_id?.startsWith('ironclaw-') ?? false)) // IronClaw handled below; null/undefined cvm_id → not IronClaw
        .filter(w => !isPollingWorker(w))                            // polling workers self-activate via Ensue, no HTTP dispatch
        .map(async (w) => {
          try {
            const res = await fetch(`${w.endpoint_url}/api/task/execute`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskConfig: parsed }),
              signal: AbortSignal.timeout(5000),
            });
            const data = await res.json();
            console.log(`[LOCAL] Triggered ${w.worker_did} (${w.endpoint_url}):`, data);
          } catch (error) {
            console.error(`[LOCAL] Failed to trigger ${w.worker_did} (${w.endpoint_url}) — marking unreachable`);
            unreachableWorkers.add(w.worker_did);
            await getEnsueClient().updateMemory(getWorkerKeys(w.worker_did).STATUS, 'idle');
          }
        })
    );
  }

  // IronClaw workers: dispatch via /webhook (works in LOCAL_MODE and production).
  // Polling workers are excluded — they self-activate by reading Ensue.
  const ironclawWorkers = workers.filter(w =>
    (w.cvm_id?.startsWith('ironclaw-') ?? false) && !isPollingWorker(w),
  );
  if (ironclawWorkers.length > 0) {
    const parsed = (() => { try { return JSON.parse(taskConfig); } catch { return {}; } })() as Record<string, unknown>;
    const taskId = (parsed.taskId as string | undefined) ?? crypto.randomUUID();
    const proposalId = (parsed.parameters as any)?.proposalId ?? String(Date.now());
    const webhookSecret = process.env.IRONCLAW_WEBHOOK_SECRET ?? '';
    // Refuse to dispatch with an empty HMAC key. An empty secret produces uniformly
    // bogus signatures (every worker dispatch 401s) or, worse, accepts any request
    // if the worker side also defaulted to empty. Fail loud, fix the env.
    if (!webhookSecret) {
      throw new Error(
        '[ironclaw] IRONCLAW_WEBHOOK_SECRET is empty but ironclaw workers are configured — refusing to dispatch with empty HMAC key',
      );
    }

    await Promise.all(
      ironclawWorkers.map(async (w) => {
        try {
          // v0.28.1 auth: HMAC-SHA256 over body in X-Hub-Signature-256 header
          const body = JSON.stringify({
            user_id: 'coordinator',
            content: `deliberate task_id:${taskId} proposal_id:${proposalId}`,
            metadata: { taskId, proposalId, taskConfig: parsed },
          });
          const signature = 'sha256=' + crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');

          const res = await fetch(`${w.endpoint_url}/webhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature },
            body,
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            const data = await res.json() as { message_id?: string };
            console.log(`[ironclaw] Dispatched to ${w.worker_did}: message_id=${data.message_id}`);
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (error) {
          console.error(`[ironclaw] Failed to dispatch to ${w.worker_did} — marking unreachable`);
          unreachableWorkers.add(w.worker_did);
          await getEnsueClient().updateMemory(getWorkerKeys(w.worker_did).STATUS, 'idle');
        }
      })
    );
  }

  // Remove unreachable workers from the active list (applies to both LOCAL and ironclaw failures)
  if (unreachableWorkers.size > 0) {
    const reachable = workers.filter(w => !unreachableWorkers.has(w.worker_did));
    console.warn(`[coordinator] ${unreachableWorkers.size} worker(s) unreachable, continuing with ${reachable.length}`);
    workers.length = 0;
    workers.push(...reachable);
  }

  console.log(`Workers triggered (${workers.length}), task config written to Ensue`);
}

/** Exported for unit tests only — thin wrapper around triggerWorkers */
export async function triggerWorkersForTest(taskConfig: string, workers: WorkerRecord[]): Promise<void> {
  return triggerWorkers(taskConfig, workers);
}

/**
 * Read worker `result` keys from Ensue with a small retry loop.
 *
 * Belt-and-suspenders against polling races: even though SKILL.md makes workers
 * write `result` before `status=completed`, Ensue read-replica lag can leave a
 * brief window where the coordinator reads `null` for a key the worker just
 * wrote. Retrying 2 extra times at 200ms covers replica catch-up without
 * meaningfully delaying the happy path (which usually returns all values on the
 * first read).
 */
async function readResultsWithRetry(resultKeys: string[]): Promise<Record<string, string | null>> {
  const ensue = getEnsueClient();
  let results = await ensue.readMultiple(resultKeys);
  for (let attempt = 0; attempt < 2; attempt++) {
    const missing = resultKeys.filter(k => results[k] == null);
    if (missing.length === 0) return results;
    await new Promise(r => setTimeout(r, 200));
    results = await ensue.readMultiple(resultKeys);
  }
  return results;
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
  const results = await readResultsWithRetry(resultKeys);

  // Parse worker results — support two shapes:
  //   - Legacy (TypeScript worker-agent): { workerId, output: { vote, value, ... } }
  //   - IronClaw (per SKILL.md):          { option, rationale, timestamp, proposal_id }
  // Helper to extract a normalized vote string ("Approved" | "Rejected" | undefined).
  const extractVote = (r: Record<string, unknown>): string | undefined => {
    const output = r.output as { vote?: string } | undefined;
    if (output?.vote) return output.vote;
    if (typeof r.option === 'string') return r.option;
    return undefined;
  };

  const workerResults: WorkerResult[] = [];

  for (const key of resultKeys) {
    const resultStr = results[key];
    if (resultStr) {
      try {
        const result = JSON.parse(resultStr) as Record<string, unknown>;
        workerResults.push(result as unknown as WorkerResult);
        const vote = extractVote(result);
        if (vote) {
          const workerId = (result.workerId as string) ?? '<ironclaw>';
          console.log(`Worker ${workerId} vote: ${vote}`);
        } else {
          const output = result.output as { value?: unknown } | undefined;
          console.log(`Worker ${(result.workerId as string) ?? '<unknown>'} result:`, output?.value);
        }
      } catch (error) {
        console.error(`Failed to parse result for ${key}:`, error);
      }
    }
  }

  // Tally votes if any worker voted, otherwise sum values (backward compat)
  const hasVotes = workerResults.some(r => extractVote(r as unknown as Record<string, unknown>));
  let approved = 0;
  let rejected = 0;

  if (hasVotes) {
    for (const r of workerResults) {
      const vote = extractVote(r as unknown as Record<string, unknown>);
      if (vote === 'Approved') approved++;
      else if (vote === 'Rejected') rejected++;
    }
    console.log(`\nVote tally: ${approved} Approved, ${rejected} Rejected`);
  }

  const aggregatedValue = hasVotes
    ? approved  // For vote tasks, aggregatedValue = number of approvals
    : workerResults.reduce((sum, r) => sum + (r.output?.value || 0), 0);

  // Quorum-aware decision: use voting_config.quorum if set, otherwise strict majority
  const minPositives = votingConfig?.quorum ?? (Math.floor(workerDIDs.length / 2) + 1);
  const decision = hasVotes ? (approved >= minPositives ? 'Approved' : 'Rejected') : 'Approved';

  // Resolve display names for all participating workers
  let workerNames: Record<string, string> | undefined;
  try {
    const nameMap = await getNameResolver().resolveAll(workerDIDs);
    workerNames = Object.fromEntries(nameMap);
  } catch (e) {
    console.warn('[coordinator] Name resolution failed (non-fatal):', e);
  }

  const tally: TallyResult = {
    aggregatedValue,
    approved,
    rejected,
    decision,
    workerCount: workerResults.length,
    workers: workerResults,
    timestamp: new Date().toISOString(),
    proposalId,
    workerNames,
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
