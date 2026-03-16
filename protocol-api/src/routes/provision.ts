/**
 * Provisioning API for one-click worker deployment.
 *
 * POST /api/provision/worker   — Start a provisioning job
 * GET  /api/provision/status/:jobId — Poll job progress
 * POST /api/provision/register — Complete registration (after wallet sign)
 */

import { Hono } from 'hono';
import { deployCvm, watchForEndpoint } from '../phala/phala-client';
import { provisionCoordinatorEnsueOrg } from '../lib/ensue';
import * as crypto from 'crypto';

const provision = new Hono();

// ── Types ──

type ProvisionStatus =
  | 'generating_identity'
  | 'creating_space'
  | 'provisioning_ensue'
  | 'preparing_phala'
  | 'deploying_phala'
  | 'waiting_for_url'
  | 'awaiting_near_signature'
  | 'registering'
  | 'complete'
  | 'failed';

interface ProvisionJob {
  id: string;
  role: 'worker' | 'coordinator';
  workerDid: string;
  storachaPrivateKey: string;
  coordinatorDid: string;
  displayName: string;
  nearAccount: string;
  status: ProvisionStatus;
  step: string;
  phalaEndpoint?: string;
  cvmId?: string;
  dashboardUrl?: string;
  error?: string;
  createdAt: number;
  // Coordinator-specific
  minWorkers?: number;
  maxWorkers?: number;
  contractAddress?: string;   // factory-created contract — known before Phala deploy (Option A)
  ensueApiKey?: string;
  ensueOrgName?: string;
  ensueClaimUrl?: string;
  ensueVerificationCode?: string;
}

// In-memory job store (sufficient for hackathon — single-process)
const jobs = new Map<string, ProvisionJob>();

function updateJob(jobId: string, status: ProvisionStatus, extra?: Partial<ProvisionJob>) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.step = statusToStep(status, job.role);
  if (extra) Object.assign(job, extra);
}

function statusToStep(status: ProvisionStatus, role: 'worker' | 'coordinator' = 'worker'): string {
  switch (status) {
    case 'generating_identity': return role === 'coordinator' ? 'Generating coordinator identity' : 'Generating worker identity';
    case 'creating_space': return 'Creating Storacha space';
    case 'provisioning_ensue': return 'Provisioning coordination memory';
    case 'preparing_phala': return 'Preparing Phala deployment';
    case 'deploying_phala': return 'Deploying to Phala TEE';
    case 'waiting_for_url': return 'Waiting for public URL (3-10 min)';
    case 'awaiting_near_signature': return 'Waiting for NEAR wallet signature';
    case 'registering': return role === 'coordinator' ? 'Registering coordinator on NEAR' : 'Registering on NEAR';
    case 'complete': return role === 'coordinator' ? 'Coordinator active' : 'Worker active';
    case 'failed': return 'Deployment failed';
    default: return status;
  }
}

// ── Key Generation & Storacha Space (backend-side) ──

// Use indirect dynamic import to prevent tsc from compiling import() to require().
// @storacha/client and @ucanto/principal are ESM-only; require() fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
const dynamicImport = new Function('specifier', 'return import(specifier)');

// Lazy-loaded ESM modules
let _ed25519: any = null;
let _base64pad: any = null;
let _StorachaClient: any = null;
let _StorachaSigner: any = null;
let _StorachaProof: any = null;
let _StoreMemory: any = null;

async function loadCryptoModules() {
  if (!_ed25519) {
    const mod = await dynamicImport('@ucanto/principal/ed25519');
    _ed25519 = mod;
    const mf = await dynamicImport('multiformats/bases/base64');
    _base64pad = mf.base64pad;
  }
}

async function loadStorachaModules() {
  if (!_StorachaClient) {
    _StorachaClient = await dynamicImport('@storacha/client');
    _StorachaSigner = await dynamicImport('@storacha/client/principal/ed25519');
    _StorachaProof = await dynamicImport('@storacha/client/proof');
    const stores = await dynamicImport('@storacha/client/stores/memory');
    _StoreMemory = stores.StoreMemory;
  }
}

async function generateWorkerIdentity(): Promise<{ workerDid: string; privateKeyString: string; signer: any }> {
  await loadCryptoModules();
  const signer = await _ed25519.Signer.generate();
  const did = signer.did();
  // Encode to the format Storacha expects (multibase base64pad of signer archive)
  const encoded = _ed25519.Signer.encode(signer);
  const privateKeyString = _base64pad.encode(encoded);
  return { workerDid: did, privateKeyString, signer };
}

/**
 * Create a UCAN delegation from the coordinator's Storacha space to a new worker DID.
 * This gives the worker scoped access to the coordinator's space under its own identity.
 * Returns { spaceDid, delegationProof (base64) }.
 */
async function createWorkerDelegation(workerDid: string): Promise<{ spaceDid: string; delegationProof: string }> {
  await loadStorachaModules();

  const coordKey = process.env.STORACHA_AGENT_PRIVATE_KEY;
  const coordDelegation = process.env.STORACHA_DELEGATION_PROOF;
  if (!coordKey || !coordDelegation) {
    throw new Error('STORACHA_AGENT_PRIVATE_KEY and STORACHA_DELEGATION_PROOF must be set for provisioning');
  }

  // Create coordinator client
  const coordSigner = _StorachaSigner.Signer.parse(coordKey);
  const coordClient = await _StorachaClient.create({
    principal: coordSigner,
    store: new _StoreMemory(),
  });
  const coordProof = await _StorachaProof.parse(coordDelegation);
  const space = await coordClient.addSpace(coordProof);
  await coordClient.setCurrentSpace(space.did());

  const spaceDid = space.did();

  // Parse worker DID as audience (ed25519 verifier)
  const audience = _StorachaSigner.Verifier.parse(workerDid);

  // Create delegation from coordinator → worker with full space capabilities
  const delegation = await coordClient.createDelegation(audience, [
    'space/blob/add',
    'space/index/add',
    'upload/add',
    'upload/list',
    'space/content/serve/*',
    'space/content/decrypt',
  ], {
    expiration: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year
  });

  // Serialize delegation to base64 CAR
  const archiveResult = await delegation.archive();
  if (archiveResult.error) {
    throw new Error(`Failed to archive delegation: ${archiveResult.error}`);
  }
  const delegationProof = Buffer.from(archiveResult.ok).toString('base64');

  console.log(`[provision] Created delegation: coordinator space ${spaceDid} → worker ${workerDid.substring(0, 24)}...`);
  return { spaceDid, delegationProof };
}

// ── Compose Template ──

function workerComposeContent(): string {
  // Docker Compose for worker-agent in Phala TEE
  // Must match templates/worker-compose.yml pattern (platform, dstack socket, restart)
  return `services:
  worker:
    image: leomanza/delibera-worker:latest
    platform: linux/amd64
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - NEAR_NETWORK
      - ENSUE_API_KEY
      - ENSUE_TOKEN
      - NEAR_API_KEY
      - STORACHA_AGENT_PRIVATE_KEY
      - STORACHA_DELEGATION_PROOF
      - STORACHA_SPACE_DID
      - COORDINATOR_DID
      - REGISTRY_CONTRACT_ID
      - WORKER_ENDPOINT_URL
      - NEAR_ACCOUNT_ID
      - NEAR_SEED_PHRASE
      - PHALA_CVM_ID
      - LIT_NETWORK
      - WORKER_DISPLAY_NAME
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
    restart: always
`;
}

/**
 * Poll an endpoint until it responds with a health check.
 */
async function waitForHealthy(url: string, maxAttempts: number, delay: number): Promise<boolean> {
  for (let i = 1; i <= maxAttempts; i++) {
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        console.log(`[provision] Health check passed (attempt ${i}/${maxAttempts})`);
        return true;
      }
    } catch {
      // Not ready yet
    }
    if (i < maxAttempts) {
      if (i % 4 === 0) {
        console.log(`[provision] Waiting for worker... (attempt ${i}/${maxAttempts})`);
      }
      await new Promise(r => setTimeout(r, delay));
    }
  }
  return false;
}

// ── Provisioning Flow ──

async function provisionWorker(job: ProvisionJob): Promise<void> {
  try {
    // Step 1: Generate worker identity
    updateJob(job.id, 'generating_identity');
    const { workerDid, privateKeyString } = await generateWorkerIdentity();
    job.workerDid = workerDid;
    job.storachaPrivateKey = privateKeyString;
    console.log(`[provision] Generated worker DID: ${workerDid.substring(0, 24)}...`);

    // Step 2: Create per-worker Storacha delegation (scoped access to coordinator's space)
    updateJob(job.id, 'creating_space');
    const { spaceDid: storachaSpaceDid, delegationProof: storachaDelegation } =
      await createWorkerDelegation(workerDid);
    console.log(`[provision] Worker delegation created for space ${storachaSpaceDid}`);

    // Step 3: Prepare Phala deployment
    updateJob(job.id, 'preparing_phala');
    const phalaApiKey = process.env.PHALA_API_KEY;
    if (!phalaApiKey) {
      throw new Error('PHALA_API_KEY not configured on server');
    }

    const envVars: Record<string, string> = {
      PORT: '3001',
      NEAR_NETWORK: process.env.NEAR_NETWORK || 'testnet',
      ENSUE_API_KEY: process.env.ENSUE_API_KEY || '',
      ENSUE_TOKEN: process.env.ENSUE_TOKEN || process.env.ENSUE_API_KEY || '',
      NEAR_API_KEY: process.env.NEAR_API_KEY || '',
      STORACHA_AGENT_PRIVATE_KEY: privateKeyString,
      STORACHA_DELEGATION_PROOF: storachaDelegation,
      STORACHA_SPACE_DID: storachaSpaceDid,
      COORDINATOR_DID: job.coordinatorDid,
      REGISTRY_CONTRACT_ID: process.env.REGISTRY_CONTRACT_ID || 'registry.agents-coordinator.testnet',
      NEAR_ACCOUNT_ID: job.nearAccount,
      NEAR_SEED_PHRASE: '', // User must provide or worker self-registers via wallet
      LIT_NETWORK: process.env.LIT_NETWORK || 'naga-dev',
      WORKER_DISPLAY_NAME: job.displayName,
    };

    // Step 4: Deploy to Phala
    updateJob(job.id, 'deploying_phala');
    const suffix = Date.now().toString(36).slice(-4);
    const cvmName = `delibera-worker-${job.displayName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}-${suffix}`;
    const composeContent = workerComposeContent();

    const result = await deployCvm(phalaApiKey, cvmName, composeContent, envVars);
    job.cvmId = result.cvmId;
    job.dashboardUrl = result.dashboardUrl;
    console.log(`[provision] CVM created: ${result.cvmId}`);

    // The endpoint URL is deterministic from app_id
    const endpointUrl = result.endpointUrl || result.deterministicUrl;

    if (endpointUrl) {
      // Step 5: Wait for container to be healthy (up to 10 min)
      updateJob(job.id, 'waiting_for_url');
      job.phalaEndpoint = endpointUrl;

      const healthy = await waitForHealthy(endpointUrl, 40, 15000); // 40 × 15s = 10 min
      if (healthy) {
        console.log(`[provision] Worker is healthy at ${endpointUrl}`);
      } else {
        console.warn(`[provision] Worker not healthy after 10min — continuing anyway (URL: ${endpointUrl})`);
      }

      updateJob(job.id, 'awaiting_near_signature', { phalaEndpoint: endpointUrl });
    } else {
      // No URL at all — shouldn't happen with deterministic URL but handle gracefully
      updateJob(job.id, 'failed', { error: 'Could not determine endpoint URL' });
    }
  } catch (error: any) {
    console.error(`[provision] Job ${job.id} failed:`, error);
    updateJob(job.id, 'failed', { error: error?.message || 'Unknown error' });
  }
}

// ── Coordinator Compose Template ──

function coordinatorComposeContent(): string {
  return `services:
  coordinator:
    image: leomanza/delibera-coordinator:latest
    platform: linux/amd64
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - LOCAL_MODE
      - COORDINATOR_STORACHA_PRIVATE_KEY
      - COORDINATOR_STORACHA_SPACE_DID
      - COORDINATOR_STORACHA_DELEGATION_BASE64
      - COORDINATOR_DID
      - NEAR_ACCOUNT_ID
      - NEAR_NETWORK
      - NEAR_RPC_URL
      - REGISTRY_CONTRACT_ID
      - MIN_WORKERS
      - MAX_WORKERS
      - ENSUE_API_KEY
      - ENSUE_ORG_NAME
      - NEXT_PUBLIC_contractId
    volumes:
      - /var/run/dstack.sock:/var/run/dstack.sock
    restart: always
`;
}

// ── Coordinator Provisioning Flow ──

async function provisionCoordinator(job: ProvisionJob): Promise<void> {
  try {
    // Step 1: Generate coordinator identity (same key type as worker)
    updateJob(job.id, 'generating_identity');
    const { workerDid: coordinatorDid, privateKeyString } = await generateWorkerIdentity();
    job.workerDid = coordinatorDid; // reuse workerDid field for the coordinator's DID
    job.storachaPrivateKey = privateKeyString;
    console.log(`[provision/coordinator] Generated DID: ${coordinatorDid.substring(0, 24)}...`);

    // Step 2: Create Storacha delegation for the coordinator (uses coordinator's own space)
    updateJob(job.id, 'creating_space');
    const { spaceDid: storachaSpaceDid, delegationProof: storachaDelegation } =
      await createWorkerDelegation(coordinatorDid);
    console.log(`[provision/coordinator] Storacha delegation created for space ${storachaSpaceDid}`);

    // Step 3: Provision Ensue org for coordination memory
    updateJob(job.id, 'provisioning_ensue');
    const ensueOrg = await provisionCoordinatorEnsueOrg(coordinatorDid);
    // CRITICAL: store api key immediately — returned only once
    job.ensueApiKey = ensueOrg.apiKey;
    job.ensueOrgName = ensueOrg.orgName;
    job.ensueClaimUrl = ensueOrg.claimUrl;
    job.ensueVerificationCode = ensueOrg.verificationCode;
    console.log(`[provision/coordinator] Ensue org provisioned: ${ensueOrg.orgName}`);

    // Step 4: Prepare Phala deployment
    updateJob(job.id, 'preparing_phala');
    const phalaApiKey = process.env.PHALA_API_KEY;
    if (!phalaApiKey) {
      throw new Error('PHALA_API_KEY not configured on server');
    }

    const envVars: Record<string, string> = {
      PORT: '3000',
      // Run in LOCAL_MODE: starts Ensue-based coordination loop without ShadeAgent.
      // ShadeAgent TEE attestation requires AGENT_CONTRACT_ID which doesn't exist
      // until after the factory tx (chicken-and-egg). Add ShadeAgent support later.
      LOCAL_MODE: 'true',
      NEAR_NETWORK: process.env.NEAR_NETWORK || 'testnet',
      NEAR_RPC_URL: process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com',
      REGISTRY_CONTRACT_ID: process.env.REGISTRY_CONTRACT_ID || 'registry.agents-coordinator.testnet',
      COORDINATOR_DID: coordinatorDid,
      COORDINATOR_STORACHA_PRIVATE_KEY: privateKeyString,
      COORDINATOR_STORACHA_SPACE_DID: storachaSpaceDid,
      COORDINATOR_STORACHA_DELEGATION_BASE64: storachaDelegation,
      NEAR_ACCOUNT_ID: job.nearAccount,
      MIN_WORKERS: String(job.minWorkers ?? 1),
      MAX_WORKERS: String(job.maxWorkers ?? 10),
      ENSUE_API_KEY: ensueOrg.apiKey,
      ENSUE_ORG_NAME: ensueOrg.orgName,
      // Coordinator contract address (factory-created before Phala deploy — Option A)
      NEXT_PUBLIC_contractId: job.contractAddress || '',
    };

    // Step 5: Deploy to Phala
    updateJob(job.id, 'deploying_phala');
    const suffix = Date.now().toString(36).slice(-4);
    const cvmName = `delibera-coord-${job.displayName.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}-${suffix}`;
    const composeContent = coordinatorComposeContent();

    const result = await deployCvm(phalaApiKey, cvmName, composeContent, envVars, 3000);
    job.cvmId = result.cvmId;
    job.dashboardUrl = result.dashboardUrl;
    console.log(`[provision/coordinator] CVM created: ${result.cvmId}`);

    const endpointUrl = result.endpointUrl || result.deterministicUrl;

    if (endpointUrl) {
      // Step 6: Wait for coordinator to be healthy
      updateJob(job.id, 'waiting_for_url');
      job.phalaEndpoint = endpointUrl;

      const healthy = await waitForHealthy(endpointUrl, 40, 15000);
      if (healthy) {
        console.log(`[provision/coordinator] Coordinator is healthy at ${endpointUrl}`);
      } else {
        console.warn(`[provision/coordinator] Not healthy after 10min — continuing (URL: ${endpointUrl})`);
      }

      // Step 7: Ready for wallet signatures (factory deploy + registry register)
      updateJob(job.id, 'awaiting_near_signature', { phalaEndpoint: endpointUrl });
    } else {
      updateJob(job.id, 'failed', { error: 'Could not determine endpoint URL' });
    }
  } catch (error: any) {
    console.error(`[provision/coordinator] Job ${job.id} failed:`, error);
    updateJob(job.id, 'failed', { error: error?.message || 'Unknown error' });
  }
}

// ── Routes ──

/**
 * POST /api/provision/worker
 * Start a new provisioning job.
 */
provision.post('/worker', async (c) => {
  const body = await c.req.json<{
    coordinatorDid: string;
    displayName: string;
    nearAccount: string;
  }>();

  if (!body.coordinatorDid || !body.displayName || !body.nearAccount) {
    return c.json({ error: 'coordinatorDid, displayName, and nearAccount are required' }, 400);
  }

  const jobId = crypto.randomUUID();
  const job: ProvisionJob = {
    id: jobId,
    role: 'worker',
    workerDid: '', // Set during provisioning
    storachaPrivateKey: '', // Set during provisioning
    coordinatorDid: body.coordinatorDid,
    displayName: body.displayName,
    nearAccount: body.nearAccount,
    status: 'generating_identity',
    step: statusToStep('generating_identity', 'worker'),
    createdAt: Date.now(),
  };

  jobs.set(jobId, job);

  // Run provisioning in background
  provisionWorker(job).catch((e) => {
    console.error(`[provision] Unhandled error in job ${jobId}:`, e);
    updateJob(jobId, 'failed', { error: e?.message || 'Unknown error' });
  });

  return c.json({ jobId, status: 'provisioning' });
});

/**
 * GET /api/provision/status/:jobId
 * Poll job progress.
 */
provision.get('/status/:jobId', (c) => {
  const jobId = c.req.param('jobId');
  const job = jobs.get(jobId);

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const revealSecrets = job.status === 'awaiting_near_signature' || job.status === 'complete';

  return c.json({
    jobId: job.id,
    role: job.role,
    status: job.status,
    step: job.step,
    workerDid: job.workerDid || undefined,
    storachaPrivateKey: revealSecrets ? job.storachaPrivateKey : undefined,
    phalaEndpoint: job.phalaEndpoint,
    cvmId: job.cvmId,
    dashboardUrl: job.dashboardUrl,
    coordinatorDid: job.coordinatorDid,
    displayName: job.displayName,
    nearAccount: job.nearAccount,
    error: job.error,
    // Coordinator-specific (only revealed when ready)
    minWorkers: job.minWorkers,
    maxWorkers: job.maxWorkers,
    contractAddress: job.contractAddress,
    ensueOrgName: revealSecrets ? job.ensueOrgName : undefined,
    ensueClaimUrl: revealSecrets ? job.ensueClaimUrl : undefined,
    ensueVerificationCode: revealSecrets ? job.ensueVerificationCode : undefined,
  });
});

/**
 * POST /api/provision/register
 * Mark registration complete (after user signs NEAR tx in wallet).
 * In the one-click flow, the frontend handles the wallet signing directly.
 */
provision.post('/register', async (c) => {
  const body = await c.req.json<{ jobId: string; txHash?: string }>();

  if (!body.jobId) {
    return c.json({ error: 'jobId is required' }, 400);
  }

  const job = jobs.get(body.jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  if (job.status !== 'awaiting_near_signature') {
    return c.json({ error: `Job is in status '${job.status}', expected 'awaiting_near_signature'` }, 400);
  }

  updateJob(body.jobId, 'registering');

  // Set display name in Ensue (non-blocking, best-effort)
  try {
    const { createEnsueClient } = await import('@near-shade-coordination/shared');
    const ensue = createEnsueClient();
    await ensue.updateMemory(`agent/${job.workerDid}/display_name`, job.displayName);
    console.log(`[provision] Display name set for ${job.workerDid}: "${job.displayName}"`);
  } catch (e) {
    console.warn(`[provision] Failed to set display name (non-fatal):`, e);
  }

  // Mark as complete — the actual NEAR tx was signed and broadcast by the frontend
  updateJob(body.jobId, 'complete');

  return c.json({
    status: 'complete',
    workerDid: job.workerDid,
    phalaEndpoint: job.phalaEndpoint,
    txHash: body.txHash,
  });
});

/**
 * POST /api/provision/coordinator
 * Start a new coordinator provisioning job.
 */
provision.post('/coordinator', async (c) => {
  const body = await c.req.json<{
    displayName: string;
    nearAccount: string;
    minWorkers: number;
    maxWorkers: number;
    contractAddress?: string;
  }>();

  if (!body.displayName || !body.nearAccount) {
    return c.json({ error: 'displayName and nearAccount are required' }, 400);
  }

  const minWorkers = Number(body.minWorkers ?? 1);
  const maxWorkers = Number(body.maxWorkers ?? 10);

  if (minWorkers < 1) {
    return c.json({ error: 'minWorkers must be >= 1' }, 400);
  }
  if (maxWorkers < minWorkers) {
    return c.json({ error: 'maxWorkers must be >= minWorkers' }, 400);
  }

  const jobId = crypto.randomUUID();
  const job: ProvisionJob = {
    id: jobId,
    role: 'coordinator',
    workerDid: '', // coordinator DID — set during provisioning
    storachaPrivateKey: '',
    coordinatorDid: '', // self-referential after generation
    displayName: body.displayName,
    nearAccount: body.nearAccount,
    minWorkers,
    maxWorkers,
    contractAddress: body.contractAddress,  // factory-created before Phala deploy
    status: 'generating_identity',
    step: statusToStep('generating_identity', 'coordinator'),
    createdAt: Date.now(),
  };

  jobs.set(jobId, job);

  provisionCoordinator(job).catch((e) => {
    console.error(`[provision/coordinator] Unhandled error in job ${jobId}:`, e);
    updateJob(jobId, 'failed', { error: e?.message || 'Unknown error' });
  });

  return c.json({ jobId, status: 'provisioning' });
});

/**
 * POST /api/provision/coordinator-register
 * Mark coordinator registration complete (after both wallet txs are signed).
 * The frontend handles:
 *   tx #1 — call factory `create_coordinator(prefix, min_workers, max_workers)`
 *   tx #2 — call registry `register_coordinator(...)`
 */
provision.post('/coordinator-register', async (c) => {
  const body = await c.req.json<{
    jobId: string;
    contractAddress?: string; // {prefix}.coord-factory.agents-coordinator.testnet
    txHash?: string;
  }>();

  if (!body.jobId) {
    return c.json({ error: 'jobId is required' }, 400);
  }

  const job = jobs.get(body.jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  if (job.role !== 'coordinator') {
    return c.json({ error: 'Job is not a coordinator job' }, 400);
  }

  if (job.status !== 'awaiting_near_signature') {
    return c.json({ error: `Job is in status '${job.status}', expected 'awaiting_near_signature'` }, 400);
  }

  updateJob(body.jobId, 'complete');

  return c.json({
    status: 'complete',
    coordinatorDid: job.workerDid,
    phalaEndpoint: job.phalaEndpoint,
    contractAddress: body.contractAddress,
    txHash: body.txHash,
    ensueOrgName: job.ensueOrgName,
    ensueClaimUrl: job.ensueClaimUrl,
    ensueVerificationCode: job.ensueVerificationCode,
  });
});

export default provision;
