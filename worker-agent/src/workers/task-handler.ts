import { EnsueClient, createEnsueClient, MEMORY_KEYS } from '@near-shade-coordination/shared';
import { TaskStatus, getWorkerKeys } from '@near-shade-coordination/shared';
import type { TaskConfig, WorkerResult, WorkerStatusInfo, VerificationProof } from '@near-shade-coordination/shared';
import { aiVote } from './ai-voter';
import type { AiVoteResult } from './ai-voter';
import {
  initializeIdentity,
  loadIdentity,
  formatIdentityContext,
  recordDecision,
} from '../storacha/agent-identity';
import { getAgentDid } from '../storacha/identity';
import { Buffer } from 'buffer';
import { connect, keyStores, KeyPair } from 'near-api-js';
import { parseSeedPhrase } from 'near-seed-phrase';

// Lazy-initialize Ensue client (env vars loaded by dotenv before first use)
let _ensueClient: EnsueClient | null = null;
function getEnsueClient(): EnsueClient {
  if (!_ensueClient) _ensueClient = createEnsueClient();
  return _ensueClient;
}

// ─── Worker DID (sovereign identity) ─────────────────────────────────────────
// Initialized asynchronously in initializeWorker(), before polling loop starts.
let _workerDID: string | null = null;

/**
 * Get the worker's sovereign DID. Throws if not yet initialized.
 * Call initializeWorker() before using this.
 */
export function getWorkerDID(): string {
  if (!_workerDID) throw new Error('Worker DID not initialized — call initializeWorker() first');
  return _workerDID;
}

// ─── NEAR RPC / Registry ──────────────────────────────────────────────────────

const NEAR_NETWORK = process.env.NEAR_NETWORK || 'testnet';
const NEAR_RPC = process.env.NEAR_RPC_JSON
  || (NEAR_NETWORK === 'mainnet' ? 'https://rpc.fastnear.com' : 'https://test.rpc.fastnear.com');
const CONTRACT_ID = process.env.NEXT_PUBLIC_contractId
  || (NEAR_NETWORK === 'mainnet' ? 'coordinator.delibera.near' : 'coordinator.agents-coordinator.testnet');
const REGISTRY_CONTRACT_ID = process.env.REGISTRY_CONTRACT_ID
  || (NEAR_NETWORK === 'mainnet' ? 'registry.delibera.near' : 'registry.agents-coordinator.testnet');

const GAS_200T = '200000000000000';
const DEPOSIT_0_1_NEAR = '100000000000000000000000'; // 0.1 NEAR in yocto

let _nearAccount: any = null;

async function getNearAccount(): Promise<any> {
  if (_nearAccount) return _nearAccount;
  const seedPhrase = process.env.NEAR_SEED_PHRASE;
  const accountId = process.env.NEAR_ACCOUNT_ID;
  if (!seedPhrase || !accountId) {
    throw new Error('NEAR_SEED_PHRASE and NEAR_ACCOUNT_ID are required for registry calls');
  }
  const { secretKey } = parseSeedPhrase(seedPhrase);
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(secretKey as any);
  await keyStore.setKey(NEAR_NETWORK, accountId, keyPair);
  const near = await connect({ networkId: NEAR_NETWORK, keyStore, nodeUrl: NEAR_RPC });
  _nearAccount = await near.account(accountId);
  return _nearAccount;
}

/**
 * View call to a NEAR contract (no signing needed)
 */
async function nearViewCall<T>(contractId: string, methodName: string, args: Record<string, unknown>): Promise<T | null> {
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
          account_id: contractId,
          method_name: methodName,
          args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        },
      }),
    });
    const data = await res.json() as any;
    if (data.error || !data.result?.result) return null;
    const bytes = new Uint8Array(data.result.result);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch (error) {
    console.error(`[worker] nearViewCall ${methodName} failed:`, error);
    return null;
  }
}

// ─── Self-Registration ────────────────────────────────────────────────────────

/**
 * Register this worker in the registry contract (idempotent).
 * Skips if REGISTRY_CONTRACT_ID or COORDINATOR_DID is not set.
 */
async function ensureRegistered(): Promise<void> {
  if (!process.env.REGISTRY_CONTRACT_ID) {
    console.log(`[worker] REGISTRY_CONTRACT_ID not set — skipping on-chain registration`);
    return;
  }
  const coordinatorDID = process.env.COORDINATOR_DID;
  if (!coordinatorDID) {
    console.warn(`[worker] COORDINATOR_DID not set — skipping registration`);
    return;
  }

  const workerDID = getWorkerDID();

  try {
    const existing = await nearViewCall(REGISTRY_CONTRACT_ID, 'get_worker_by_did', { worker_did: workerDID });
    if (existing) {
      console.log(`[worker] Already registered in registry: ${workerDID.substring(0, 24)}...`);
      return;
    }

    const endpointUrl = process.env.WORKER_ENDPOINT_URL ?? `http://localhost:${process.env.PORT ?? '3001'}`;
    const cvmId = process.env.PHALA_CVM_ID ?? 'local';

    const account = await getNearAccount();
    await account.functionCall({
      contractId: REGISTRY_CONTRACT_ID,
      methodName: 'register_worker',
      args: {
        coordinator_did: coordinatorDID,
        worker_did: workerDID,
        endpoint_url: endpointUrl,
        cvm_id: cvmId,
      },
      gas: BigInt(GAS_200T),
      attachedDeposit: BigInt(DEPOSIT_0_1_NEAR),
    });

    console.log(`[worker] ✅ Registered in registry: ${workerDID.substring(0, 24)}...`);
    console.log(`[worker]    coordinator: ${coordinatorDID.substring(0, 24)}...`);
    console.log(`[worker]    endpoint:    ${endpointUrl}`);
  } catch (error: any) {
    // Non-fatal — registration failure doesn't stop the worker from voting
    console.warn(`[worker] Registry registration failed (non-fatal):`, error?.message?.substring(0, 200));
  }
}

// ─── Task Execution ───────────────────────────────────────────────────────────

/**
 * Execute a task and write results to Ensue
 */
export async function executeTask(taskConfig: TaskConfig): Promise<void> {
  const workerDID = getWorkerDID();
  const workerKeys = getWorkerKeys(workerDID);

  console.log(`[worker:${workerDID.substring(0, 16)}...] Starting task execution:`, taskConfig);

  try {
    // Step 1: Update status to processing
    await getEnsueClient().updateMemory(workerKeys.STATUS, 'processing');
    console.log(`[worker] Status: processing`);

    // Step 2: Perform actual work
    const startTime = Date.now();
    const result = await performWork(taskConfig);
    const processingTime = Date.now() - startTime;

    console.log(`[worker] Work completed in ${processingTime}ms`);

    // Step 3: Build worker result
    const workerResult: WorkerResult = {
      workerId: workerDID,  // DID is now the worker identity
      taskType: taskConfig.type,
      output: {
        value: result.value,
        vote: result.vote,
        reasoning: result.reasoning,
        data: {
          parameters: taskConfig.parameters,
        },
        computedAt: new Date().toISOString(),
      },
      processingTime,
    };

    // Step 4: Write result to Ensue (DID-keyed path)
    await getEnsueClient().updateMemory(workerKeys.RESULT, JSON.stringify(workerResult));
    console.log(`[worker] Result written to Ensue`);

    // Step 4b: Store verification proof in Ensue (if available)
    if (result.verificationProof) {
      await getEnsueClient().updateMemory(
        workerKeys.VERIFICATION_PROOF,
        JSON.stringify(result.verificationProof),
      );
      console.log(`[worker] Verification proof stored`);
    }

    // Step 5: Update timestamp
    await getEnsueClient().updateMemory(workerKeys.TIMESTAMP, Date.now().toString());

    // Step 6: Update status to completed
    await getEnsueClient().updateMemory(workerKeys.STATUS, 'completed');
    console.log(`[worker] Task completed successfully`);
  } catch (error) {
    console.error(`[worker] Task failed:`, error);
    const workerKeys = getWorkerKeys(getWorkerDID());
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await getEnsueClient().updateMemory(workerKeys.ERROR, errorMessage);
    await getEnsueClient().updateMemory(workerKeys.STATUS, 'failed');
  }
}

interface WorkResult {
  value: number;
  vote?: 'Approved' | 'Rejected';
  reasoning?: string;
  verificationProof?: VerificationProof;
}

/**
 * Fetch the DAO manifesto from the contract via RPC view call
 */
async function fetchManifesto(): Promise<{ text: string; hash: string } | null> {
  return nearViewCall(CONTRACT_ID, 'get_manifesto', {});
}

/**
 * Perform work based on task type.
 * - 'vote': AI agent votes on a proposal using manifesto alignment
 * - 'random': random number (legacy/testing)
 */
async function performWork(config: TaskConfig): Promise<WorkResult> {
  const workerDID = getWorkerDID();

  switch (config.type) {
    case 'vote': {
      const proposal = config.parameters?.proposal as string;
      if (!proposal) throw new Error('Vote task requires parameters.proposal');

      console.log(`[worker] Fetching manifesto from contract...`);
      const manifesto = await fetchManifesto();
      if (!manifesto) throw new Error('Could not fetch manifesto from contract');
      console.log(`[worker] Manifesto hash: ${manifesto.hash}`);

      // Load persistent agent identity (with timeout to avoid blocking on slow IPFS gateways)
      let agentContext: string | undefined;
      try {
        console.log(`[worker] Loading agent identity...`);
        const IDENTITY_TIMEOUT_MS = 15000; // 15s max for identity loading
        const identity = await Promise.race([
          loadIdentity(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Identity loading timed out')), IDENTITY_TIMEOUT_MS)
          ),
        ]);
        agentContext = formatIdentityContext(identity);
        console.log(`[worker] Agent identity loaded (${identity.recentDecisions.length} past decisions)`);
      } catch (e) {
        console.warn(`[worker] Agent identity unavailable, proceeding without:`, e instanceof Error ? e.message : e);
      }

      console.log(`[worker] Calling AI for vote on proposal...`);
      const voteResult: AiVoteResult = await aiVote(manifesto.text, proposal, agentContext);
      console.log(`[worker] AI vote: ${voteResult.vote}`);
      console.log(`[worker] AI reasoning: ${voteResult.reasoning.substring(0, 200)}...`);

      if (voteResult.verificationProof) {
        console.log(`[worker] Verification proof obtained (chat_id: ${voteResult.verificationProof.chat_id})`);
      }

      // Record decision for persistent history (Ensue + Storacha backup)
      try {
        // Read the on-chain proposal ID from coordinator's Ensue key
        // (proposalId is set by coordinator after triggerWorkers, but before workers finish voting)
        let proposalId = config.parameters?.proposalId as string || '';
        if (!proposalId) {
          try {
            const onChainId = await getEnsueClient().readMemory(MEMORY_KEYS.COORDINATOR_PROPOSAL_ID);
            proposalId = onChainId || `proposal-${Date.now()}`;
          } catch {
            proposalId = `proposal-${Date.now()}`;
          }
        }
        const cid = await recordDecision(proposalId, proposal, voteResult.vote, voteResult.reasoning);
        if (cid) {
          console.log(`[worker] Decision persisted to Storacha: ${cid}`);
        } else {
          console.log(`[worker] Decision recorded (local/Ensue)`);
        }
      } catch (e) {
        console.warn(`[worker] Failed to record decision:`, e);
      }

      return {
        value: voteResult.vote === 'Approved' ? 1 : 0,
        vote: voteResult.vote,
        reasoning: voteResult.reasoning,
        verificationProof: voteResult.verificationProof,
      };
    }

    case 'random': {
      const timeout = config.timeout || 3000;
      const workDuration = 1000 + Math.random() * timeout;
      await new Promise((resolve) => setTimeout(resolve, workDuration));
      return { value: Math.floor(Math.random() * 100) };
    }

    case 'count':
      return { value: config.parameters?.count || 42 };

    case 'multiply': {
      const a = config.parameters?.a || 1;
      const b = config.parameters?.b || 1;
      return { value: a * b };
    }

    default:
      return { value: Math.floor(Math.random() * 100) };
  }
}

/**
 * Get current task status from Ensue
 */
export async function getTaskStatus(): Promise<WorkerStatusInfo> {
  const workerDID = _workerDID ?? 'not-initialized';
  const workerKeys = getWorkerKeys(workerDID);
  const statusStr = await getEnsueClient().readMemory(workerKeys.STATUS);
  const timestampStr = await getEnsueClient().readMemory(workerKeys.TIMESTAMP);
  const errorStr = await getEnsueClient().readMemory(workerKeys.ERROR);

  return {
    workerId: workerDID,
    status: (statusStr as TaskStatus) || 'idle',
    timestamp: timestampStr ? parseInt(timestampStr) : undefined,
    error: errorStr || undefined,
  };
}

/**
 * Initialize worker:
 * 1. Derive sovereign DID from Storacha private key
 * 2. Set idle status on DID-keyed Ensue path
 * 3. Self-register in NEAR registry contract (idempotent)
 * 4. Initialize Storacha agent identity (non-blocking)
 */
export async function initializeWorker(): Promise<void> {
  console.log(`[worker] Initializing...`);

  try {
    // Step 1: Derive DID from Storacha private key
    if (process.env.STORACHA_AGENT_PRIVATE_KEY) {
      _workerDID = await getAgentDid();
      console.log(`[worker] Sovereign DID: ${_workerDID}`);
    } else {
      // Fallback for LOCAL_MODE without Storacha
      _workerDID = `did:local:${process.env.PORT ?? '3001'}`;
      console.warn(`[worker] STORACHA_AGENT_PRIVATE_KEY not set — using fallback DID: ${_workerDID}`);
    }

    const workerKeys = getWorkerKeys(_workerDID);

    // Step 2: Set idle status on DID-keyed path
    await getEnsueClient().updateMemory(workerKeys.STATUS, 'idle');

    // Clear any previous error
    try {
      await getEnsueClient().deleteMemory(workerKeys.ERROR);
    } catch { /* ignore */ }

    // Step 3: Set display name if provided (non-blocking)
    const displayName = process.env.WORKER_DISPLAY_NAME;
    if (displayName && _workerDID) {
      getEnsueClient().updateMemory(`agent/${_workerDID}/display_name`, displayName)
        .then(() => console.log(`[worker] Display name set: "${displayName}"`))
        .catch(e => console.warn(`[worker] Display name set failed (non-fatal):`, e));
    }

    // Step 4: Self-register in registry (non-blocking, idempotent)
    ensureRegistered().catch(e =>
      console.warn(`[worker] Registration error (non-fatal):`, e)
    );

    // Step 5: Initialize agent identity (non-blocking)
    initializeIdentity()
      .then(() => console.log(`[worker] Agent identity initialized`))
      .catch(e => console.warn(`[worker] Agent identity init failed (non-critical):`, e));

    console.log(`[worker] Initialized successfully`);
  } catch (error) {
    console.error(`[worker] Failed to initialize:`, error);
    throw error;
  }
}

/**
 * Poll Ensue for pending tasks and auto-execute them.
 * Uses DID-keyed status path. Required for Phala production mode.
 */
export function startWorkerPollingLoop(): void {
  const POLL_INTERVAL = Number(process.env.WORKER_POLL_INTERVAL) || 3000;
  console.log(`[worker] Starting Ensue polling loop (interval: ${POLL_INTERVAL}ms)...`);

  let isExecuting = false;

  setInterval(async () => {
    if (isExecuting) return;
    try {
      const workerDID = _workerDID;
      if (!workerDID) return; // not yet initialized

      const workerKeys = getWorkerKeys(workerDID);
      const status = await getEnsueClient().readMemory(workerKeys.STATUS);
      if (status !== 'pending') return;

      const taskConfigStr = await getEnsueClient().readMemory(MEMORY_KEYS.CONFIG_TASK_DEFINITION);
      if (!taskConfigStr) {
        console.warn(`[worker] Status is 'pending' but no task config found in Ensue`);
        return;
      }

      // Parse task config — handle double-stringified values defensively
      let taskConfig: TaskConfig = JSON.parse(taskConfigStr);
      if (typeof taskConfig === 'string') {
        taskConfig = JSON.parse(taskConfig);
      }
      console.log(`[worker] Detected pending task in Ensue, auto-executing...`);

      isExecuting = true;
      try {
        await executeTask(taskConfig);
      } finally {
        isExecuting = false;
      }
    } catch (error) {
      isExecuting = false;
      console.error(`[worker] Polling loop error:`, error);
    }
  }, POLL_INTERVAL);
}

// Initialization is called from index.ts after dotenv loads
