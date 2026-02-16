import { Hono } from 'hono';
import { EnsueClient, createEnsueClient, getAgentRegistryKeys } from '@near-shade-coordination/shared';
import { localGetRegisteredWorkers } from '../contract/local-contract';

const app = new Hono();

let _ensueClient: EnsueClient | null = null;
function getEnsueClient(): EnsueClient {
  if (!_ensueClient) _ensueClient = createEnsueClient();
  return _ensueClient;
}

/**
 * GET /api/agents/endpoints
 * Get all agent endpoint URLs (workers + coordinators) from Ensue
 */
app.get('/endpoints', async (c) => {
  try {
    const registered = await localGetRegisteredWorkers();
    const endpoints: Record<string, { endpoint: string | null; type: string; cvmId: string | null; dashboardUrl: string | null }> = {};

    for (const w of registered) {
      const keys = getAgentRegistryKeys(w.worker_id);
      try {
        const endpoint = await getEnsueClient().readMemory(keys.ENDPOINT);
        const cvmId = await getEnsueClient().readMemory(keys.CVM_ID);
        const dashboardUrl = await getEnsueClient().readMemory(keys.DASHBOARD_URL);
        endpoints[w.worker_id] = {
          endpoint: endpoint || null,
          type: 'worker',
          cvmId: cvmId || null,
          dashboardUrl: dashboardUrl || null,
        };
      } catch {
        endpoints[w.worker_id] = { endpoint: null, type: 'worker', cvmId: null, dashboardUrl: null };
      }
    }

    return c.json({ agents: endpoints, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error getting agent endpoints:', error);
    return c.json({ error: 'Failed to get agent endpoints' }, 500);
  }
});

/**
 * GET /api/agents/:agentId/endpoint
 * Get a specific agent's endpoint URL
 */
app.get('/:agentId/endpoint', async (c) => {
  const agentId = c.req.param('agentId');
  const keys = getAgentRegistryKeys(agentId);
  try {
    const endpoint = await getEnsueClient().readMemory(keys.ENDPOINT);
    const cvmId = await getEnsueClient().readMemory(keys.CVM_ID);
    const dashboardUrl = await getEnsueClient().readMemory(keys.DASHBOARD_URL);
    return c.json({
      agentId,
      endpoint: endpoint || null,
      cvmId: cvmId || null,
      dashboardUrl: dashboardUrl || null,
    });
  } catch {
    return c.json({ agentId, endpoint: null, cvmId: null, dashboardUrl: null });
  }
});

/**
 * PUT /api/agents/:agentId/endpoint
 * Set or update an agent's endpoint URL
 */
app.put('/:agentId/endpoint', async (c) => {
  const agentId = c.req.param('agentId');
  const body = await c.req.json<{ endpoint: string; cvmId?: string; dashboardUrl?: string }>();

  if (!body.endpoint) {
    return c.json({ error: 'endpoint is required' }, 400);
  }

  const keys = getAgentRegistryKeys(agentId);
  const ensue = getEnsueClient();

  try {
    await ensue.updateMemory(keys.ENDPOINT, body.endpoint);
    await ensue.updateMemory(keys.UPDATED_AT, new Date().toISOString());
    if (body.cvmId) await ensue.updateMemory(keys.CVM_ID, body.cvmId);
    if (body.dashboardUrl) await ensue.updateMemory(keys.DASHBOARD_URL, body.dashboardUrl);

    console.log(`[agents] Updated endpoint for ${agentId}: ${body.endpoint}`);
    return c.json({ success: true, agentId, endpoint: body.endpoint });
  } catch (error) {
    console.error(`Error updating endpoint for ${agentId}:`, error);
    return c.json({ error: 'Failed to update endpoint' }, 500);
  }
});

export default app;
