import { Hono } from 'hono';
import { EnsueClient, createEnsueClient } from '@near-shade-coordination/shared';
import {
  MEMORY_KEYS,
  getWorkerKeys,
  getProposalKeys,
  getProposalWorkerKeys,
  getAgentRegistryKeys,
  PROPOSAL_INDEX_KEY,
} from '@near-shade-coordination/shared';
import { triggerLocalCoordination } from '../monitor/memory-monitor';
import {
  localGetRegisteredWorkers,
} from '../contract/local-contract';

const LOCAL_MODE = process.env.LOCAL_MODE === 'true';
const app = new Hono();

let _ensueClient: EnsueClient | null = null;
function getEnsueClient(): EnsueClient {
  if (!_ensueClient) _ensueClient = createEnsueClient();
  return _ensueClient;
}

/** Get worker IDs from on-chain contract, fall back to WORKERS env or defaults */
async function getWorkerIds(): Promise<string[]> {
  try {
    const registered = await localGetRegisteredWorkers();
    if (registered.length > 0) {
      return registered.filter((w: any) => w.active).map((w: any) => w.worker_id);
    }
  } catch (e) {
    console.warn('[coordinate] Could not fetch on-chain workers, falling back to env/defaults');
  }
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
    const workerIds = await getWorkerIds();
    const statusKeys = workerIds.map(id => getWorkerKeys(id).STATUS);
    const statuses = await getEnsueClient().readMultiple(statusKeys);

    const workers: Record<string, string> = {};
    for (const id of workerIds) {
      const ensueStatus = statuses[getWorkerKeys(id).STATUS];
      if (ensueStatus) {
        workers[id] = ensueStatus;
      } else {
        // No Ensue status — probe the worker's endpoint to check if it's alive
        try {
          const endpointKey = getAgentRegistryKeys(id).ENDPOINT;
          const endpoint = await getEnsueClient().readMemory(endpointKey);
          if (endpoint) {
            const res = await fetch(`${endpoint}/`, { signal: AbortSignal.timeout(3000) });
            if (res.ok) {
              workers[id] = 'idle';
              continue;
            }
          }
        } catch { /* probe failed */ }
        workers[id] = 'offline';
      }
    }

    return c.json({
      workers,
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

    console.log('Manual coordination trigger received:', taskConfig);

    // Run coordination in background (don't block response)
    triggerLocalCoordination(JSON.stringify(taskConfig)).catch((err) => {
      console.error('Local coordination failed:', err);
    });

    return c.json({
      message: 'Coordination triggered',
      taskConfig,
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

    // Reset all worker statuses
    const workerIds = await getWorkerIds();
    await Promise.all(
      workerIds.map(id => getEnsueClient().updateMemory(getWorkerKeys(id).STATUS, 'idle'))
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
    const indexStr = await getEnsueClient().readMemory(PROPOSAL_INDEX_KEY);
    const proposalIds: string[] = indexStr ? JSON.parse(indexStr) : [];

    // Fetch summary for each proposal
    const proposals = await Promise.all(
      proposalIds.map(async (id) => {
        const pKeys = getProposalKeys(id);
        const [status, tallyStr] = await Promise.all([
          getEnsueClient().readMemory(pKeys.STATUS),
          getEnsueClient().readMemory(pKeys.TALLY),
        ]);
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

    // Fetch per-worker results
    const workerIds = await getWorkerIds();
    const workerResults: Record<string, any> = {};
    for (const workerId of workerIds) {
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

export default app;
