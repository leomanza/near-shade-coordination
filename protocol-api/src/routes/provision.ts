/**
 * Provisioning API for one-click worker deployment.
 *
 * POST /api/provision/worker   — Start a provisioning job
 * GET  /api/provision/status/:jobId — Poll job progress
 * POST /api/provision/register — Complete registration (after wallet sign)
 */

import { Hono } from 'hono';
import { deployCvm, watchForEndpoint } from '../phala/phala-client';
import * as crypto from 'crypto';

const provision = new Hono();

// ── Types ──

type ProvisionStatus =
  | 'generating_identity'
  | 'creating_space'
  | 'preparing_phala'
  | 'deploying_phala'
  | 'waiting_for_url'
  | 'awaiting_near_signature'
  | 'registering'
  | 'complete'
  | 'failed';

interface ProvisionJob {
  id: string;
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
}

// In-memory job store (sufficient for hackathon — single-process)
const jobs = new Map<string, ProvisionJob>();

function updateJob(jobId: string, status: ProvisionStatus, extra?: Partial<ProvisionJob>) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.step = statusToStep(status);
  if (extra) Object.assign(job, extra);
}

function statusToStep(status: ProvisionStatus): string {
  switch (status) {
    case 'generating_identity': return 'Generating worker identity';
    case 'creating_space': return 'Creating Storacha space';
    case 'preparing_phala': return 'Preparing Phala deployment';
    case 'deploying_phala': return 'Deploying to Phala TEE';
    case 'waiting_for_url': return 'Waiting for public URL (3-10 min)';
    case 'awaiting_near_signature': return 'Waiting for NEAR wallet signature';
    case 'registering': return 'Registering on NEAR';
    case 'complete': return 'Worker active';
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
    workerDid: '', // Set during provisioning
    storachaPrivateKey: '', // Set during provisioning
    coordinatorDid: body.coordinatorDid,
    displayName: body.displayName,
    nearAccount: body.nearAccount,
    status: 'generating_identity',
    step: statusToStep('generating_identity'),
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

  return c.json({
    jobId: job.id,
    status: job.status,
    step: job.step,
    workerDid: job.workerDid || undefined,
    storachaPrivateKey: job.status === 'awaiting_near_signature' || job.status === 'complete'
      ? job.storachaPrivateKey
      : undefined, // Only reveal key when ready
    phalaEndpoint: job.phalaEndpoint,
    cvmId: job.cvmId,
    dashboardUrl: job.dashboardUrl,
    coordinatorDid: job.coordinatorDid,
    displayName: job.displayName,
    nearAccount: job.nearAccount,
    error: job.error,
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

export default provision;
