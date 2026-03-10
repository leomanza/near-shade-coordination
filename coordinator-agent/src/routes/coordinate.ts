import { Hono } from 'hono';
import { EnsueClient, createEnsueClient, NameResolver } from '@near-shade-coordination/shared';
import {
  MEMORY_KEYS,
  getWorkerKeys,
  getProposalKeys,
  getProposalWorkerKeys,
  getAgentRegistryKeys,
  getCoordinatorSnapshotKey,
  PROPOSAL_INDEX_KEY,
} from '@near-shade-coordination/shared';
import { getAgentDid } from '../storacha/identity';
import { triggerLocalCoordination } from '../monitor/memory-monitor';
import { selectJury, verifyJurySelection } from '../vrf/jury-selector';

const LOCAL_MODE = process.env.LOCAL_MODE === 'true';
const app = new Hono();

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
  endpoint_url: string;
  is_active: boolean;
  registered_at: number;
}>> {
  try {
    const { localViewRegistry } = await import('../contract/local-contract');
    const coordinatorDID = await getAgentDid();
    const workers = await localViewRegistry<any[]>('get_workers_for_coordinator', {
      coordinator_did: coordinatorDID,
    });
    return (workers ?? []).map(w => ({
      did: w.worker_did,
      endpoint_url: w.endpoint_url,
      is_active: w.is_active,
      registered_at: w.registered_at,
    }));
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
  return ['worker1', 'worker2', 'worker3'];
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
    await getEnsueClient().clearPrefix('coordination/coordinator/');

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

export default app;
