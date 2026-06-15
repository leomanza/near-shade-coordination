import { Hono } from 'hono';
import { EnsueClient, createEnsueClient, NameResolver } from '@delibera-xyz/shared';
import {
  MEMORY_KEYS,
  getWorkerKeys,
  getProposalKeys,
  getProposalWorkerKeys,
  getAgentRegistryKeys,
  getCoordinatorSnapshotKey,
  PROPOSAL_INDEX_KEY,
  ENSUE_PREFIX,
} from '@delibera-xyz/shared';
import { getAgentDid } from '../storacha/identity';
import { triggerLocalCoordination } from '../monitor/memory-monitor';
import { selectJury, verifyJurySelection } from '../vrf/jury-selector';

const LOCAL_MODE = process.env.LOCAL_MODE === 'true';
const app = new Hono();

/* ─── Worker Validation Cache ──────────────────────────────────────────── */

const VALIDATION_TTL_MS = 5 * 60 * 1000; // 5 minutes
const validationCache = new Map<string, { valid: boolean; checkedAt: number }>();

/**
 * Probe a worker endpoint for liveness, opportunistically verifying DID match.
 *
 * Liveness is "host:port is reachable" — any HTTP response < 500 within 5s counts,
 * because some agent runtimes (e.g. IronClaw) don't expose a root handler and
 * respond with 404 at `/`. We only reject DID mismatches when the worker
 * actually returns a JSON body with a `workerDid` field.
 *
 * For polling workers (non-http endpoint_url, e.g. "ensue://..." marker), HTTP
 * probes are nonsensical — they have no inbound surface to probe. We pass them
 * through as valid; their liveness signal is their last Ensue write, surfaced
 * separately via `ensue_status` in the workers route.
 * See doc/plans/dispatch-modes/00-spec.md for the polling-mode rationale.
 */
async function validateWorker(worker: { worker_did: string; endpoint_url: string }): Promise<boolean> {
  if (!/^https?:\/\//i.test(worker.endpoint_url ?? '')) {
    console.log(`[worker-validation] ${worker.worker_did} PASS (polling-mode, no HTTP probe)`);
    return true;
  }
  try {
    const res = await fetch(`${worker.endpoint_url}/`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.status >= 500) {
      console.log(`[worker-validation] ${worker.worker_did} FAIL (HTTP ${res.status})`);
      return false;
    }
    if (res.ok) {
      try {
        const body = await res.json() as { workerDid?: string };
        if (body.workerDid && body.workerDid !== worker.worker_did) {
          console.log(`[worker-validation] ${worker.worker_did} FAIL (DID mismatch: got ${body.workerDid})`);
          return false;
        }
      } catch { /* non-JSON / no body — liveness only */ }
    }
    return true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'unknown error';
    console.log(`[worker-validation] ${worker.worker_did} FAIL (${reason})`);
    return false;
  }
}

/**
 * Validate a list of workers in parallel, using the in-memory cache to skip
 * workers that were already checked within the TTL.
 */
async function filterValidatedWorkers<T extends { did: string; endpoint_url: string }>(
  workers: T[],
): Promise<T[]> {
  const now = Date.now();
  const needsCheck: T[] = [];
  const alreadyValid: T[] = [];

  for (const w of workers) {
    const cached = validationCache.get(w.did);
    if (cached && now - cached.checkedAt < VALIDATION_TTL_MS) {
      if (cached.valid) alreadyValid.push(w);
      // cached invalid → skip silently
      continue;
    }
    needsCheck.push(w);
  }

  if (needsCheck.length === 0) return alreadyValid;

  const results = await Promise.allSettled(
    needsCheck.map(async (w) => {
      const valid = await validateWorker({ worker_did: w.did, endpoint_url: w.endpoint_url });
      validationCache.set(w.did, { valid, checkedAt: Date.now() });
      return { worker: w, valid };
    }),
  );

  const freshValid = results
    .filter((r): r is PromiseFulfilledResult<{ worker: T; valid: boolean }> =>
      r.status === 'fulfilled' && r.value.valid)
    .map(r => r.value.worker);

  // Mark rejected promises as invalid in cache
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      validationCache.set(needsCheck[i].did, { valid: false, checkedAt: Date.now() });
    }
  }

  return [...alreadyValid, ...freshValid];
}

let _nameResolver: NameResolver | null = null;

let _ensueClient: EnsueClient | null = null;
function getEnsueClient(): EnsueClient {
  if (!_ensueClient) _ensueClient = createEnsueClient();
  return _ensueClient;
}

/**
 * Query the NEAR registry contract for workers assigned to this coordinator.
 * Returns structured worker info (DID, endpoint, active status, registration time).
 */
async function getRegistryWorkers(): Promise<Array<{
  did: string;
  account_id: string | null;
  endpoint_url: string;
  is_active: boolean;
  registered_at: number;
}>> {
  try {
    const { localViewRegistry } = await import('../contract/local-contract');
    // Workers are first-class — list all active, filter client-side if needed.
    const workers = await localViewRegistry<any[]>('list_active_workers', {});
    const mapped = (workers ?? []).map(w => ({
      did: w.worker_did,
      account_id: w.account_id ?? null,
      endpoint_url: w.endpoint_url,
      is_active: w.is_active,
      registered_at: w.registered_at,
    }));

    // Validate active workers (DID + liveness check), pass through inactive as-is
    const active = mapped.filter(w => w.is_active);
    const inactive = mapped.filter(w => !w.is_active);
    const validated = await filterValidatedWorkers(active);
    return [...validated, ...inactive];
  } catch (e) {
    console.warn('[coordinate] Registry query failed, returning empty list:', e);
    return [];
  }
}

/**
 * Get worker DIDs from registry, falling back to WORKERS env for backward compat.
 */
async function getWorkerDIDs(): Promise<string[]> {
  const registryWorkers = await getRegistryWorkers();
  if (registryWorkers.length > 0) {
    return registryWorkers.filter(w => w.is_active).map(w => w.did);
  }
  // Fallback: parse WORKERS env
  const workersEnv = process.env.WORKERS;
  if (workersEnv) {
    return workersEnv.split(',').map(entry => {
      const trimmed = entry.trim();
      if (trimmed.includes('|')) return trimmed.split('|')[0];
      return trimmed.split(':')[0];
    });
  }
  return [];
}

/**
 * GET /api/coordinate/status
 * Get coordinator status from Ensue
 */
app.get('/status', async (c) => {
  try {
    const status = await getEnsueClient().readMemory(MEMORY_KEYS.COORDINATOR_STATUS);
    const proposalId = await getEnsueClient().readMemory(MEMORY_KEYS.COORDINATOR_PROPOSAL_ID);
    const tally = await getEnsueClient().readMemory(MEMORY_KEYS.COORDINATOR_TALLY);

    return c.json({
      status: status || 'idle',
      proposalId: proposalId ? parseInt(proposalId) : null,
      tally: tally ? JSON.parse(tally) : null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting coordinator status:', error);
    return c.json(
      {
        error: 'Failed to get coordinator status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/coordinate/workers
 * Get all worker statuses from Ensue
 */
app.get('/workers', async (c) => {
  try {
    // Try registry-based discovery first
    const registryWorkers = await getRegistryWorkers();

    if (registryWorkers.length > 0) {
      // Registry-based response: return full worker info with Ensue status + display names
      const statusKeys = registryWorkers.map(w => getWorkerKeys(w.did).STATUS);
      const statuses = await getEnsueClient().readMultiple(statusKeys);

      // Resolve display names for all workers
      if (!_nameResolver) _nameResolver = new NameResolver(getEnsueClient());
      const dids = registryWorkers.map(w => w.did);
      await _nameResolver.resolveAll(dids).catch(() => {});
      const names = _nameResolver.getCachedNames();

      const workers = registryWorkers.map(w => {
        const ensueStatus = statuses[getWorkerKeys(w.did).STATUS] || null;
        return {
          did: w.did,
          account_id: w.account_id,
          display_name: names[w.did] || null,
          endpoint_url: w.endpoint_url,
          is_active: w.is_active,
          registered_at: w.registered_at,
          ensue_status: ensueStatus || (w.is_active ? 'idle' : 'offline'),
        };
      });

      return c.json({
        workers,
        source: 'registry',
        timestamp: new Date().toISOString(),
      });
    }

    // Fallback: WORKERS env-based discovery
    const workerDids = await getWorkerDIDs();
    const statusKeys = workerDids.map(did => getWorkerKeys(did).STATUS);
    const statuses = await getEnsueClient().readMultiple(statusKeys);

    const workers: Record<string, string> = {};
    for (const did of workerDids) {
      const ensueStatus = statuses[getWorkerKeys(did).STATUS];
      if (ensueStatus) {
        workers[did] = ensueStatus;
      } else {
        // No Ensue status — probe the worker's endpoint to check if it's alive
        try {
          const endpointKey = getAgentRegistryKeys(did).ENDPOINT;
          const endpoint = await getEnsueClient().readMemory(endpointKey);
          if (endpoint) {
            const res = await fetch(`${endpoint}/`, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
              workers[did] = 'idle';
              continue;
            }
          }
        } catch { /* probe failed */ }
        workers[did] = 'offline';
      }
    }

    return c.json({
      workers,
      source: 'env_fallback',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting worker statuses:', error);
    return c.json(
      {
        error: 'Failed to get worker statuses',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * PATCH /api/coordinate/workers/:did/name
 * Set or update a worker's display name.
 * Stored in Ensue at `agent/{did}/display_name`.
 */
app.patch('/workers/:did/name', async (c) => {
  try {
    const did = decodeURIComponent(c.req.param('did'));
    const body = await c.req.json<{ name: string }>();
    if (!body.name || body.name.trim().length < 1) {
      return c.json({ error: 'name is required' }, 400);
    }
    if (!_nameResolver) _nameResolver = new NameResolver(getEnsueClient());
    await _nameResolver.setName(did, body.name.trim());
    return c.json({ did, name: body.name.trim(), status: 'updated' });
  } catch (error) {
    console.error('Error setting worker name:', error);
    return c.json({ error: 'Failed to set name' }, 500);
  }
});

/**
 * POST /api/coordinate/workers/register
 * Register a worker on the registry contract (on-chain).
 *
 * Accepts either:
 *   { endpointUrl: "https://...worker-url" }           → probes URL to discover DID
 *   { workerId: "did:key:z6Mk..." }                    → uses DID directly
 *   { endpointUrl: "https://...", workerId: "did:..." } → uses both as-is
 */
app.post('/workers/register', async (c) => {
  try {
    const body = await c.req.json<{ workerId?: string; endpointUrl?: string; accountId?: string }>();

    let workerDid = body.workerId?.trim() || '';
    let endpointUrl = body.endpointUrl?.trim() || '';

    // If input looks like a URL but was passed as workerId, treat it as endpointUrl
    if (workerDid.startsWith('http') && !endpointUrl) {
      endpointUrl = workerDid;
      workerDid = '';
    }

    // Probe the worker endpoint to discover its DID (and verify it's reachable)
    if (endpointUrl) {
      const probeUrl = endpointUrl.replace(/\/+$/, '');
      try {
        const res = await fetch(`${probeUrl}/`, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
          return c.json({ error: `Worker endpoint returned HTTP ${res.status}` }, 400);
        }
        const info = await res.json() as { workerDid?: string; status?: string };
        if (!info.workerDid) {
          return c.json({ error: 'Worker endpoint did not return a workerDid field' }, 400);
        }
        if (workerDid && workerDid !== info.workerDid) {
          return c.json({
            error: `DID mismatch: provided ${workerDid} but worker reports ${info.workerDid}`,
          }, 400);
        }
        workerDid = info.workerDid;
        console.log(`[register] Discovered worker DID from endpoint: ${workerDid}`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown error';
        return c.json({ error: `Cannot reach worker at ${endpointUrl}: ${reason}` }, 400);
      }
    }

    if (!workerDid) {
      return c.json({ error: 'Provide a worker endpoint URL or a DID (did:key:z6Mk...)' }, 400);
    }
    if (!workerDid.startsWith('did:')) {
      return c.json({ error: `Invalid worker DID "${workerDid}" — must start with "did:"` }, 400);
    }
    if (!endpointUrl) {
      return c.json({ error: 'Worker endpoint URL is required for registry registration' }, 400);
    }

    const { localRegisterWorkerInRegistry } = await import('../contract/local-contract');
    // Workers are first-class — no coordinator pairing at registration.
    console.log(`[register] Registering worker ${workerDid} (endpoint: ${endpointUrl})`);
    const result = await localRegisterWorkerInRegistry(
      workerDid,
      endpointUrl,
      'manual',
    );
    if (!result.success) {
      return c.json({
        error: 'Registration failed on-chain.',
        details: result.error || 'Unknown error',
      }, 500);
    }

    validationCache.delete(workerDid);

    return c.json({ message: `Worker ${workerDid} registered on-chain`, workerDid, endpointUrl });
  } catch (error) {
    console.error('Error registering worker:', error);
    const detail = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: `Failed to register worker: ${detail}` }, 500);
  }
});

/**
 * DELETE /api/coordinate/workers/:did
 * Remove a worker from the coordinator contract (on-chain).
 */
app.delete('/workers/:did', async (c) => {
  try {
    const did = decodeURIComponent(c.req.param('did'));
    const { localRemoveWorker } = await import('../contract/local-contract');
    const success = await localRemoveWorker(did);
    if (!success) {
      return c.json({ error: 'Removal failed on-chain' }, 500);
    }
    return c.json({ message: `Worker ${did} removed` });
  } catch (error) {
    console.error('Error removing worker:', error);
    return c.json({ error: 'Failed to remove worker' }, 500);
  }
});

/**
 * GET /api/coordinate/pending
 * Get pending coordinations from contract
 */
app.get('/pending', async (c) => {
  try {
    if (LOCAL_MODE) {
      return c.json({
        count: 0,
        requests: [],
        localMode: true,
        timestamp: new Date().toISOString(),
      });
    }

    const { agentView } = await import('@neardefi/shade-agent-js');
    const pendingRequests = await agentView({
      methodName: 'get_pending_coordinations',
      args: {},
    });

    return c.json({
      count: pendingRequests.length,
      requests: pendingRequests,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error getting pending coordinations:', error);
    return c.json(
      {
        error: 'Failed to get pending coordinations',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/coordinate/trigger
 * Manually trigger a coordination (local testing mode)
 *
 * Body: { taskConfig: { type: string, parameters?: object, timeout?: number } }
 */
app.post('/trigger', async (c) => {
  try {
    const body = await c.req.json();
    const taskConfig = body.taskConfig || { type: 'random', timeout: 3000 };

    // Normalize: triggerLocalCoordination expects a JSON string.
    // taskConfig may arrive as a string (curl) or an object (frontend).
    const taskConfigStr = typeof taskConfig === 'string' ? taskConfig : JSON.stringify(taskConfig);

    console.log('Manual coordination trigger received:', taskConfigStr);

    // Run coordination in background (don't block response)
    triggerLocalCoordination(taskConfigStr).catch((err) => {
      console.error('Local coordination failed:', err);
    });

    return c.json({
      message: 'Coordination triggered',
      taskConfig: taskConfigStr,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error triggering coordination:', error);
    return c.json(
      {
        error: 'Failed to trigger coordination',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/coordinate/reset
 * Reset all Ensue memory (for testing)
 */
app.post('/reset', async (c) => {
  try {
    console.log('Resetting coordinator memory...');

    // Clear coordinator memory
    await getEnsueClient().clearPrefix(`${ENSUE_PREFIX}coordination/coordinator/`);

    // Reset all worker statuses (by DID)
    const workerDids = await getWorkerDIDs();
    await Promise.all(
      workerDids.map(did => getEnsueClient().updateMemory(getWorkerKeys(did).STATUS, 'idle'))
    );

    return c.json({
      message: 'Memory reset complete',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error resetting memory:', error);
    return c.json(
      {
        error: 'Failed to reset memory',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/* ─── Proposal History Endpoints ─────────────────────────────────────────── */

/**
 * GET /api/coordinate/proposals
 * List all archived proposals from Ensue
 */
app.get('/proposals', async (c) => {
  try {
    const workerDid = c.req.query('workerDid');
    const indexStr = await getEnsueClient().readMemory(PROPOSAL_INDEX_KEY);
    const proposalIds: string[] = indexStr ? JSON.parse(indexStr) : [];

    // Fetch summary for each proposal
    const allProposals = await Promise.all(
      proposalIds.map(async (id) => {
        const pKeys = getProposalKeys(id);
        const fetches: Promise<string | null>[] = [
          getEnsueClient().readMemory(pKeys.STATUS),
          getEnsueClient().readMemory(pKeys.TALLY),
        ];
        // If filtering by worker, check if they have a result for this proposal
        if (workerDid) {
          const wKeys = getProposalWorkerKeys(id, workerDid);
          fetches.push(getEnsueClient().readMemory(wKeys.RESULT));
        }
        const results = await Promise.all(fetches);
        const [status, tallyStr] = results;
        const workerResult = workerDid ? results[2] : 'skip';

        // If filtering by worker and they have no result, exclude this proposal
        if (workerDid && !workerResult) return null;

        const tally = tallyStr ? JSON.parse(tallyStr) : null;
        return {
          proposalId: id,
          status: status || 'unknown',
          decision: tally?.decision || null,
          approved: tally?.approved ?? null,
          rejected: tally?.rejected ?? null,
          workerCount: tally?.workerCount ?? null,
          timestamp: tally?.timestamp || null,
        };
      })
    );

    const proposals = allProposals.filter(Boolean);
    return c.json({ proposals, total: proposals.length });
  } catch (error) {
    console.error('Error listing proposals:', error);
    return c.json(
      { error: 'Failed to list proposals', details: error instanceof Error ? error.message : 'Unknown' },
      500
    );
  }
});

/**
 * GET /api/coordinate/proposals/:id
 * Get full details for a specific archived proposal
 */
app.get('/proposals/:id', async (c) => {
  try {
    const proposalId = c.req.param('id');
    const pKeys = getProposalKeys(proposalId);

    const [configStr, status, tallyStr] = await Promise.all([
      getEnsueClient().readMemory(pKeys.CONFIG),
      getEnsueClient().readMemory(pKeys.STATUS),
      getEnsueClient().readMemory(pKeys.TALLY),
    ]);

    if (!status) {
      return c.json({ error: 'Proposal not found' }, 404);
    }

    const tally = tallyStr ? JSON.parse(tallyStr) : null;
    const config = configStr ? (() => { try { return JSON.parse(configStr); } catch { return configStr; } })() : null;

    // Fetch per-worker results — read snapshot for this proposal, fall back to registry
    // getCoordinatorSnapshotKey imported at top level
    let workerDidsForProposal: string[] = [];
    const snapshotStr = await getEnsueClient().readMemory(getCoordinatorSnapshotKey(proposalId));
    if (snapshotStr) {
      try { workerDidsForProposal = JSON.parse(snapshotStr); } catch { /* ignore */ }
    }
    if (workerDidsForProposal.length === 0) {
      workerDidsForProposal = await getWorkerDIDs();
    }

    const workerResults: Record<string, any> = {};
    for (const workerId of workerDidsForProposal) {
      const wKeys = getProposalWorkerKeys(proposalId, workerId);
      const [resultStr, timestamp] = await Promise.all([
        getEnsueClient().readMemory(wKeys.RESULT),
        getEnsueClient().readMemory(wKeys.TIMESTAMP),
      ]);
      if (resultStr) {
        workerResults[workerId] = {
          result: JSON.parse(resultStr),
          timestamp,
        };
      }
    }

    return c.json({
      proposalId,
      status,
      config,
      tally,
      workers: workerResults,
    });
  } catch (error) {
    console.error('Error getting proposal details:', error);
    return c.json(
      { error: 'Failed to get proposal details', details: error instanceof Error ? error.message : 'Unknown' },
      500
    );
  }
});

/**
 * POST /api/coordinate/select-jury
 * Select a jury from a candidate pool using Flow VRF.
 *
 * Body: {
 *   pool: string[],          // Candidate NEAR AccountIDs
 *   jurySize: number,        // Number of jurors to select
 *   deliberationId?: string  // Optional context ID
 * }
 */
app.post('/select-jury', async (c) => {
  try {
    const body = await c.req.json();
    const { pool, jurySize, deliberationId } = body;

    if (!pool || !Array.isArray(pool) || pool.length === 0) {
      return c.json({ error: 'pool must be a non-empty array of candidate IDs' }, 400);
    }

    const size = jurySize || 3;
    if (size > pool.length) {
      return c.json({ error: `jurySize (${size}) exceeds pool size (${pool.length})` }, 400);
    }

    console.log(`[select-jury] Selecting ${size} jurors from pool of ${pool.length}`);

    const result = await selectJury(pool, size, deliberationId);

    return c.json(result);
  } catch (error) {
    console.error('Error selecting jury:', error);
    return c.json(
      {
        error: 'Failed to select jury',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * POST /api/coordinate/verify-jury
 * Verify a jury selection is deterministic given the same seed.
 *
 * Body: {
 *   pool: string[],    // Original candidate pool
 *   jurySize: number,  // Original jury size
 *   vrfSeed: string    // The VRF seed to verify with
 * }
 */
app.post('/verify-jury', async (c) => {
  try {
    const body = await c.req.json();
    const { pool, jurySize, vrfSeed } = body;

    if (!pool || !Array.isArray(pool) || !vrfSeed) {
      return c.json({ error: 'pool and vrfSeed are required' }, 400);
    }

    const jury = verifyJurySelection(pool, jurySize || 3, vrfSeed);

    return c.json({
      jury,
      vrfSeed,
      verified: true,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error verifying jury:', error);
    return c.json(
      {
        error: 'Failed to verify jury',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

// ─── Polling-mode proxy endpoints ────────────────────────────────────────
// Lets sandboxed / outbound-only agents (NEAR AI hosted IronClaw, browser,
// mobile, restricted serverless) participate in deliberation WITHOUT holding
// Ensue credentials themselves. The coord-agent reads/writes Ensue with its
// own key; the worker authenticates only by being registered + active in the
// on-chain registry contract.
//
// v1 trust model (demo-grade): any registered active worker DID can submit a
// vote — no per-message signature required. Risk: anyone who knows the DID
// could spoof a vote for it. Acceptable for the protocol's bootstrap phase.
// v2 trust model (production, post attested-signing): worker signs the vote
// body with the ed25519 key matching its registered DID; coord-agent verifies
// against the on-chain pubkey before writing.
//
// Spec: doc/plans/dispatch-modes/02-results.md F35
// Verification context: doc/plans/skill-testing/05-verification-and-revised-questions.md

/**
 * GET /api/coordinate/poll/task
 *
 * Returns the active task_definition for keyless polling workers. Public read
 * (the task is already replicated on-chain via the proposal; no secret in it).
 * Polling workers call this on their own cadence (default 30s per skill spec).
 *
 * Returns: { task: string | null, timestamp: ISO8601 }
 */
app.get('/poll/task', async (c) => {
  try {
    const task = await getEnsueClient().readMemory(MEMORY_KEYS.CONFIG_TASK_DEFINITION);
    return c.json({
      task: task ?? null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(
      {
        error: 'Failed to read task_definition from Ensue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      502,
    );
  }
});

/**
 * POST /api/coordinate/poll/vote/:worker_did
 * Body:  { "option": "...", "rationale"?: "..." }
 *
 * Accepts a vote on behalf of a registered worker. The coord-agent writes it
 * to Ensue at coordination/tasks/{worker_did}/result using its own Ensue key.
 * Authenticates by checking worker_did is currently active in the registry.
 *
 * Returns 200: { status: 'ok', worker_did, key, timestamp }
 * Returns 400: malformed input
 * Returns 403: worker_did not registered or not active
 * Returns 502: upstream (registry or Ensue) failure
 */
app.post('/poll/vote/:worker_did', async (c) => {
  const workerDid = decodeURIComponent(c.req.param('worker_did'));
  if (!workerDid.startsWith('did:')) {
    return c.json({ error: 'worker_did must start with "did:"' }, 400);
  }

  let body: { option?: unknown; rationale?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'request body must be JSON' }, 400);
  }
  if (!body.option || typeof body.option !== 'string') {
    return c.json({ error: '"option" is required (string)' }, 400);
  }
  if (body.rationale != null && typeof body.rationale !== 'string') {
    return c.json({ error: '"rationale" must be a string if present' }, 400);
  }

  // Trust model v1: verify worker_did is in the registry's active workers.
  // Any matching active worker can submit a vote (no signature yet).
  try {
    const { localViewRegistry } = await import('../contract/local-contract');
    const workers = await localViewRegistry<Array<{ worker_did: string; is_active: boolean }>>(
      'list_active_workers',
      {},
    );
    const found = (workers ?? []).find(w => w.worker_did === workerDid && w.is_active);
    if (!found) {
      return c.json(
        { error: `worker_did not registered or not active in registry: ${workerDid}` },
        403,
      );
    }
  } catch (e) {
    return c.json(
      {
        error: 'Failed to verify worker_did against registry contract',
        details: e instanceof Error ? e.message : 'Unknown error',
      },
      502,
    );
  }

  // Write the vote — same key shape as push-mode workers write directly.
  const voteValue = JSON.stringify({
    option: body.option,
    rationale: (body.rationale as string | undefined) ?? '',
    timestamp: new Date().toISOString(),
  });
  const key = getWorkerKeys(workerDid).RESULT;
  try {
    await getEnsueClient().updateMemory(key, voteValue);
  } catch (error) {
    return c.json(
      {
        error: 'Failed to write vote to Ensue',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      502,
    );
  }

  return c.json({
    status: 'ok',
    worker_did: workerDid,
    key,
    timestamp: new Date().toISOString(),
  });
});

export default app;
