import { Hono } from 'hono';
import { execSync } from 'child_process';
import { Buffer } from 'buffer';

const app = new Hono();

const NEAR_NETWORK = process.env.NEAR_NETWORK || 'testnet';
const NEAR_RPC = NEAR_NETWORK === 'mainnet'
  ? 'https://rpc.fastnear.com'
  : 'https://test.rpc.fastnear.com';
const REGISTRY_CONTRACT_ID = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID
  || (NEAR_NETWORK === 'mainnet' ? 'registry.agents-coordinator.near' : 'registry.agents-coordinator.testnet');
const SIGNER_ID = process.env.NEAR_ACCOUNT_ID
  || (NEAR_NETWORK === 'mainnet' ? 'agents-coordinator.near' : 'agents-coordinator.testnet');
const NEAR_CLI = process.env.NEAR_CLI_PATH || `${process.env.HOME}/.cargo/bin/near`;

/** View call to registry contract via RPC */
async function registryViewCall<T>(method: string, args: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const res = await fetch(NEAR_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: '1',
        method: 'query',
        params: {
          request_type: 'call_function',
          finality: 'final',
          account_id: REGISTRY_CONTRACT_ID,
          method_name: method,
          args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        },
      }),
    });
    const data = await res.json() as any;
    if (data.error || !data.result?.result) return null;
    const bytes = new Uint8Array(data.result.result);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

interface RegistryEntry {
  coordinator_id?: string;
  worker_id?: string;
  owner: string;
  phala_cvm_id: string | null;
  endpoint_url: string | null;
  active: boolean;
  created_at: number;
}

/**
 * GET /api/agents/endpoints
 * Get all agent endpoint URLs from registry contract (on-chain)
 */
app.get('/endpoints', async (c) => {
  try {
    const [coordinators, workers] = await Promise.all([
      registryViewCall<RegistryEntry[]>('list_active_coordinators'),
      registryViewCall<RegistryEntry[]>('list_active_workers'),
    ]);

    const agents: Record<string, { endpoint: string | null; type: string; cvmId: string | null }> = {};

    for (const coord of coordinators ?? []) {
      agents[coord.coordinator_id!] = {
        endpoint: coord.endpoint_url || null,
        type: 'coordinator',
        cvmId: coord.phala_cvm_id || null,
      };
    }

    for (const worker of workers ?? []) {
      agents[worker.worker_id!] = {
        endpoint: worker.endpoint_url || null,
        type: 'worker',
        cvmId: worker.phala_cvm_id || null,
      };
    }

    return c.json({ agents, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Error getting agent endpoints:', error);
    return c.json({ error: 'Failed to get agent endpoints' }, 500);
  }
});

/**
 * GET /api/agents/:agentId/endpoint
 * Get a specific agent's endpoint URL from registry contract
 */
app.get('/:agentId/endpoint', async (c) => {
  const agentId = c.req.param('agentId');
  try {
    // Try coordinator first, then worker
    let entry = await registryViewCall<RegistryEntry>('get_coordinator', { name: agentId });
    if (!entry) {
      entry = await registryViewCall<RegistryEntry>('get_worker', { worker_id: agentId });
    }

    return c.json({
      agentId,
      endpoint: entry?.endpoint_url || null,
      cvmId: entry?.phala_cvm_id || null,
    });
  } catch {
    return c.json({ agentId, endpoint: null, cvmId: null });
  }
});

/**
 * PUT /api/agents/:agentId/endpoint
 * Update an agent's endpoint URL on the registry contract
 */
app.put('/:agentId/endpoint', async (c) => {
  const agentId = c.req.param('agentId');
  const body = await c.req.json<{ endpoint: string; cvmId?: string; type?: string }>();

  if (!body.endpoint) {
    return c.json({ error: 'endpoint is required' }, 400);
  }

  const type = body.type || 'worker';
  const methodName = type === 'coordinator' ? 'update_coordinator' : 'update_worker';
  const idKey = type === 'coordinator' ? 'name' : 'worker_id';

  const args: Record<string, unknown> = {
    [idKey]: agentId,
    endpoint_url: body.endpoint,
  };
  if (body.cvmId) args.phala_cvm_id = body.cvmId;

  const argsB64 = Buffer.from(JSON.stringify(args)).toString('base64');
  const cmd = `${NEAR_CLI} contract call-function as-transaction ${REGISTRY_CONTRACT_ID} ${methodName} base64-args '${argsB64}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as ${SIGNER_ID} network-config ${NEAR_NETWORK} sign-with-keychain send`;

  try {
    execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}` },
    });
    console.log(`[agents] Updated endpoint for ${agentId}: ${body.endpoint}`);
    return c.json({ success: true, agentId, endpoint: body.endpoint });
  } catch (error: any) {
    const msg = error.stderr || error.message || '';
    console.error(`Error updating endpoint for ${agentId}:`, msg.substring(0, 300));
    return c.json({ error: 'Failed to update endpoint' }, 500);
  }
});

export default app;
