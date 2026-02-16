import { Hono } from 'hono';
import { deployCvm, getCvmStatus } from '../phala/phala-client';
import { createEnsueClient, getAgentRegistryKeys } from '@near-shade-coordination/shared';
import { execSync } from 'child_process';
import { Buffer } from 'buffer';
import * as fs from 'fs';
import * as path from 'path';

let _ensueClient: ReturnType<typeof createEnsueClient> | null = null;
function getEnsueClient() {
  if (!_ensueClient) _ensueClient = createEnsueClient();
  return _ensueClient;
}

/** Save agent endpoint metadata to Ensue */
async function saveAgentEndpoint(agentId: string, data: { endpoint?: string; type: string; cvmId?: string; dashboardUrl?: string }) {
  const keys = getAgentRegistryKeys(agentId);
  const ensue = getEnsueClient();
  try {
    if (data.endpoint) await ensue.updateMemory(keys.ENDPOINT, data.endpoint);
    await ensue.updateMemory(keys.TYPE, data.type);
    if (data.cvmId) await ensue.updateMemory(keys.CVM_ID, data.cvmId);
    if (data.dashboardUrl) await ensue.updateMemory(keys.DASHBOARD_URL, data.dashboardUrl);
    await ensue.updateMemory(keys.UPDATED_AT, new Date().toISOString());
    console.log(`[deploy] Saved agent endpoint for ${agentId}: ${data.endpoint || 'no endpoint yet'}`);
  } catch (e) {
    console.warn(`[deploy] Failed to save agent endpoint (non-fatal):`, e);
  }
}

const deploy = new Hono();

// Load compose templates
function loadTemplate(name: string): string {
  const templatePath = path.resolve(__dirname, '../../../templates', name);
  return fs.readFileSync(templatePath, 'utf-8');
}

// ── Registry contract registration ──

const NEAR_NETWORK = process.env.NEAR_NETWORK || 'testnet';
const REGISTRY_CONTRACT_ID = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID
  || (NEAR_NETWORK === 'mainnet' ? 'registry.agents-coordinator.near' : 'registry.agents-coordinator.testnet');
const SIGNER_ID = process.env.NEAR_ACCOUNT_ID
  || (NEAR_NETWORK === 'mainnet' ? 'agents-coordinator.near' : 'agents-coordinator.testnet');
const NEAR_CLI = process.env.NEAR_CLI_PATH || `${process.env.HOME}/.cargo/bin/near`;

async function registerInRegistry(type: 'coordinator' | 'worker', name: string, coordinatorId?: string): Promise<void> {
  const methodName = type === 'coordinator' ? 'register_coordinator' : 'register_worker';
  const args = type === 'coordinator'
    ? { name }
    : { name, coordinator_id: coordinatorId || null };
  const argsB64 = Buffer.from(JSON.stringify(args)).toString('base64');
  const deposit = '0.1 NEAR';

  const cmd = `${NEAR_CLI} contract call-function as-transaction ${REGISTRY_CONTRACT_ID} ${methodName} base64-args '${argsB64}' prepaid-gas '30 Tgas' attached-deposit '${deposit}' sign-as ${SIGNER_ID} network-config ${NEAR_NETWORK} sign-with-keychain send`;

  console.log(`[deploy] Registering ${type} "${name}" in registry contract...`);
  try {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}` },
    });
    console.log(`[deploy] Registry ${methodName} succeeded:`, result.substring(0, 300));
  } catch (error: any) {
    const msg = error.stderr || error.message || '';
    if (msg.includes('already taken') || msg.includes('already exists')) {
      console.log(`[deploy] ${type} "${name}" already registered in registry, skipping`);
      return;
    }
    console.warn(`[deploy] Registry ${methodName} failed (non-fatal):`, msg.substring(0, 300));
  }
}

const COORDINATOR_CONTRACT_ID = process.env.NEXT_PUBLIC_contractId
  || (NEAR_NETWORK === 'mainnet' ? 'coordinator.agents-coordinator.near' : 'coordinator.agents-coordinator.testnet');

async function registerWorkerInCoordinatorContract(workerId: string, accountId?: string): Promise<void> {
  const args = { worker_id: workerId, account_id: accountId || null };
  const argsB64 = Buffer.from(JSON.stringify(args)).toString('base64');

  const cmd = `${NEAR_CLI} contract call-function as-transaction ${COORDINATOR_CONTRACT_ID} register_worker base64-args '${argsB64}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as ${SIGNER_ID} network-config ${NEAR_NETWORK} sign-with-keychain send`;

  console.log(`[deploy] Registering worker "${workerId}" in coordinator contract...`);
  try {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}` },
    });
    console.log(`[deploy] Coordinator register_worker succeeded:`, result.substring(0, 300));
  } catch (error: any) {
    const msg = error.stderr || error.message || '';
    if (msg.includes('already registered') || msg.includes('already exists')) {
      console.log(`[deploy] Worker "${workerId}" already registered in coordinator contract, skipping`);
      return;
    }
    console.warn(`[deploy] Coordinator register_worker failed (non-fatal):`, msg.substring(0, 300));
  }
}

interface DeployRequest {
  type: 'coordinator' | 'worker';
  name: string;
  phalaApiKey?: string;
  ensueApiKey?: string;
  ensueToken?: string;
  nearAiApiKey?: string;
  // Shade Agent v2 fields
  agentContractId?: string;
  sponsorAccountId?: string;
  sponsorPrivateKey?: string;
  nearNetwork?: string;
  // Legacy fields (kept for worker deploys)
  nearAccountId?: string;
  nearSeedPhrase?: string;
  novaApiKey?: string;
  novaAccountId?: string;
  novaGroupId?: string;
  coordinatorId?: string;
}

deploy.post('/', async (c) => {
  try {
    const body = await c.req.json<DeployRequest>();

    if (!body.name || body.name.length < 2) {
      return c.json({ success: false, error: 'Name must be at least 2 characters' }, 400);
    }

    if (body.type === 'coordinator') {
      return await deployCoordinator(c, body);
    } else if (body.type === 'worker') {
      return await deployWorker(c, body);
    } else {
      return c.json({ success: false, error: 'Invalid type. Must be "coordinator" or "worker"' }, 400);
    }
  } catch (error) {
    console.error('[deploy] Error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: message }, 500);
  }
});

async function deployCoordinator(c: any, body: DeployRequest) {
  await registerInRegistry('coordinator', body.name);

  if (!body.phalaApiKey) {
    console.log(`[deploy] Coordinator "${body.name}" registered on-chain + locally (no Phala key)`);
    return c.json({
      success: true,
      cvmId: null,
      status: 'local',
      type: 'coordinator',
      name: body.name,
    });
  }

  const composeContent = loadTemplate('coordinator-compose.yml');

  const nearNetwork = body.nearNetwork || process.env.NEAR_NETWORK || 'testnet';
  const agentContractId = body.agentContractId || process.env.NEXT_PUBLIC_contractId || 'coordinator.agents-coordinator.testnet';
  const nearRpc = nearNetwork === 'mainnet' ? 'https://rpc.fastnear.com' : 'https://test.rpc.fastnear.com';

  const envs: Record<string, string> = {
    ENSUE_API_KEY: body.ensueApiKey || '',
    ENSUE_TOKEN: body.ensueToken || body.ensueApiKey || '',
    // Shade Agent v2 env vars
    AGENT_CONTRACT_ID: agentContractId,
    SPONSOR_ACCOUNT_ID: body.sponsorAccountId || '',
    SPONSOR_PRIVATE_KEY: body.sponsorPrivateKey || '',
    NEAR_NETWORK: nearNetwork,
    NEAR_RPC_JSON: nearRpc,
  };

  const suffix = Date.now().toString(36).slice(-4);
  const cvmName = `delibera-coord-${body.name}-${suffix}`;
  const result = await deployCvm(body.phalaApiKey, cvmName, composeContent, envs);

  console.log(`[deploy] Coordinator "${body.name}" deployed: CVM ${result.cvmId}, dashboard: ${result.dashboardUrl}, endpoint: ${result.endpointUrl}`);

  await saveAgentEndpoint(body.name, {
    type: 'coordinator',
    endpoint: result.endpointUrl,
    cvmId: result.cvmId,
    dashboardUrl: result.dashboardUrl,
  });

  return c.json({
    success: true,
    cvmId: result.cvmId,
    status: result.status,
    dashboardUrl: result.dashboardUrl,
    endpointUrl: result.endpointUrl,
    type: 'coordinator',
    name: body.name,
  });
}

async function deployWorker(c: any, body: DeployRequest) {
  const novaGroupId = body.novaGroupId || `delibera-worker-${body.name}-${Date.now()}`;

  await registerInRegistry('worker', body.name, body.coordinatorId);

  if (body.coordinatorId) {
    await registerWorkerInCoordinatorContract(body.name);
  }

  if (!body.phalaApiKey) {
    console.log(`[deploy] Worker "${body.name}" registered on-chain + locally (no Phala key), novaGroupId: ${novaGroupId}`);
    return c.json({
      success: true,
      cvmId: null,
      status: 'local',
      type: 'worker',
      name: body.name,
      novaGroupId,
    });
  }

  const composeContent = loadTemplate('worker-compose.yml');

  const envs: Record<string, string> = {
    WORKER_ID: body.name,
    ENSUE_API_KEY: body.ensueApiKey || '',
    ENSUE_TOKEN: body.ensueToken || body.ensueApiKey || '',
    NEAR_AI_API_KEY: body.nearAiApiKey || '',
    NOVA_API_KEY: body.novaApiKey || '',
    NOVA_ACCOUNT_ID: body.novaAccountId || '',
    NOVA_GROUP_ID: novaGroupId,
    CONTRACT_ID: process.env.NEXT_PUBLIC_contractId || 'coordinator.agents-coordinator.testnet',
  };

  const suffix = Date.now().toString(36).slice(-4);
  const cvmName = `delibera-worker-${body.name}-${suffix}`;
  const result = await deployCvm(body.phalaApiKey, cvmName, composeContent, envs);

  console.log(`[deploy] Worker "${body.name}" deployed: CVM ${result.cvmId}, dashboard: ${result.dashboardUrl}, endpoint: ${result.endpointUrl}`);

  await saveAgentEndpoint(body.name, {
    type: 'worker',
    endpoint: result.endpointUrl,
    cvmId: result.cvmId,
    dashboardUrl: result.dashboardUrl,
  });

  return c.json({
    success: true,
    cvmId: result.cvmId,
    status: result.status,
    dashboardUrl: result.dashboardUrl,
    endpointUrl: result.endpointUrl,
    type: 'worker',
    name: body.name,
    novaGroupId,
  });
}

deploy.get('/status/:cvmId', async (c) => {
  const cvmId = c.req.param('cvmId');
  const apiKey = c.req.header('x-phala-api-key');

  if (!apiKey) {
    return c.json({ error: 'x-phala-api-key header required' }, 400);
  }

  try {
    const status = await getCvmStatus(apiKey, cvmId);
    return c.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: message }, 500);
  }
});

export default deploy;
