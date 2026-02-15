import { EnsueClient, createEnsueClient } from '@near-shade-coordination/shared';
import { TaskStatus, getWorkerKeys } from '@near-shade-coordination/shared';
import type { TaskConfig, WorkerResult, WorkerStatusInfo, VoteResult } from '@near-shade-coordination/shared';
import { aiVote } from './ai-voter';
import {
  initializeIdentity,
  loadIdentity,
  formatIdentityContext,
  recordDecision,
} from '../nova/agent-identity';

// Lazy-initialize Ensue client (env vars loaded by dotenv before first use)
let _ensueClient: EnsueClient | null = null;
function getEnsueClient(): EnsueClient {
  if (!_ensueClient) _ensueClient = createEnsueClient();
  return _ensueClient;
}

// Get worker ID from environment
const WORKER_ID = process.env.WORKER_ID || 'worker1';
const workerKeys = getWorkerKeys(WORKER_ID);

/**
 * Execute a task and write results to Ensue
 *
 * Flow:
 * 1. Update status to "processing"
 * 2. Perform work (simulated computation for MVP)
 * 3. Write result to Ensue
 * 4. Update timestamp
 * 5. Update status to "completed"
 * 6. Handle errors by writing to error key
 *
 * Following pattern from plan Phase 3
 */
export async function executeTask(taskConfig: TaskConfig): Promise<void> {
  console.log(`[${WORKER_ID}] Starting task execution:`, taskConfig);

  try {
    // Step 1: Update status to processing
    await updateStatus('processing');
    console.log(`[${WORKER_ID}] Status updated to processing`);

    // Step 2: Perform actual work
    const startTime = Date.now();
    const result = await performWork(taskConfig);
    const processingTime = Date.now() - startTime;

    console.log(`[${WORKER_ID}] Work completed in ${processingTime}ms`);

    // Step 3: Build worker result
    const workerResult: WorkerResult = {
      workerId: WORKER_ID,
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

    // Step 4: Write result to Ensue
    await getEnsueClient().updateMemory(workerKeys.RESULT, JSON.stringify(workerResult));
    console.log(`[${WORKER_ID}] Result written to Ensue:`, workerResult);

    // Step 5: Update timestamp
    await getEnsueClient().updateMemory(workerKeys.TIMESTAMP, Date.now().toString());

    // Step 6: Update status to completed
    await updateStatus('completed');
    console.log(`[${WORKER_ID}] Task completed successfully`);
  } catch (error) {
    console.error(`[${WORKER_ID}] Task failed:`, error);

    // Write error to Ensue
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await getEnsueClient().updateMemory(workerKeys.ERROR, errorMessage);

    // Update status to failed
    await updateStatus('failed');
  }
}

interface WorkResult {
  value: number;
  vote?: 'Approved' | 'Rejected';
  reasoning?: string;
}

const NEAR_NETWORK = process.env.NEAR_NETWORK || 'testnet';
const NEAR_RPC = process.env.NEAR_RPC_JSON
  || (NEAR_NETWORK === 'mainnet' ? 'https://rpc.fastnear.com' : 'https://test.rpc.fastnear.com');
const CONTRACT_ID = process.env.NEXT_PUBLIC_contractId
  || (NEAR_NETWORK === 'mainnet' ? 'coordinator.delibera.near' : 'ac-proxy.agents-coordinator.testnet');

/**
 * Fetch the DAO manifesto from the contract via RPC view call
 */
async function fetchManifesto(): Promise<{ text: string; hash: string } | null> {
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
          account_id: CONTRACT_ID,
          method_name: 'get_manifesto',
          args_base64: btoa('{}'),
        },
      }),
    });
    const data = await res.json() as any;
    if (data.error || !data.result?.result) return null;
    const bytes = new Uint8Array(data.result.result);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text);
  } catch (error) {
    console.error(`[${WORKER_ID}] Failed to fetch manifesto:`, error);
    return null;
  }
}

/**
 * Perform work based on task type.
 * - 'vote': AI agent votes on a proposal using manifesto alignment
 * - 'random': random number (legacy/testing)
 */
async function performWork(config: TaskConfig): Promise<WorkResult> {
  switch (config.type) {
    case 'vote': {
      const proposal = config.parameters?.proposal as string;
      if (!proposal) throw new Error('Vote task requires parameters.proposal');

      console.log(`[${WORKER_ID}] Fetching manifesto from contract...`);
      const manifesto = await fetchManifesto();
      if (!manifesto) throw new Error('Could not fetch manifesto from contract');
      console.log(`[${WORKER_ID}] Manifesto hash: ${manifesto.hash}`);

      // Load persistent agent identity from Nova
      let agentContext: string | undefined;
      try {
        console.log(`[${WORKER_ID}] Loading agent identity from Nova...`);
        const identity = await loadIdentity();
        agentContext = formatIdentityContext(identity);
        console.log(`[${WORKER_ID}] Agent identity loaded (${identity.recentDecisions.length} past decisions)`);
      } catch (e) {
        console.warn(`[${WORKER_ID}] Nova identity unavailable, proceeding without:`, e);
      }

      console.log(`[${WORKER_ID}] Calling AI for vote on proposal...`);
      const voteResult: VoteResult = await aiVote(manifesto.text, proposal, agentContext);
      console.log(`[${WORKER_ID}] AI vote: ${voteResult.vote}`);
      console.log(`[${WORKER_ID}] AI reasoning: ${voteResult.reasoning.substring(0, 200)}...`);

      // Record decision to Nova for persistent history
      try {
        const proposalId = config.parameters?.proposalId as string
          || `proposal-${Date.now()}`;
        await recordDecision(proposalId, proposal, voteResult.vote, voteResult.reasoning);
        console.log(`[${WORKER_ID}] Decision recorded to Nova`);
      } catch (e) {
        console.warn(`[${WORKER_ID}] Failed to record decision to Nova:`, e);
      }

      return {
        value: voteResult.vote === 'Approved' ? 1 : 0,
        vote: voteResult.vote,
        reasoning: voteResult.reasoning,
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
 * Update worker status in Ensue
 */
async function updateStatus(status: TaskStatus): Promise<void> {
  await getEnsueClient().updateMemory(workerKeys.STATUS, status);
}

/**
 * Get current task status from Ensue
 */
export async function getTaskStatus(): Promise<WorkerStatusInfo> {
  const statusStr = await getEnsueClient().readMemory(workerKeys.STATUS);
  const timestampStr = await getEnsueClient().readMemory(workerKeys.TIMESTAMP);
  const errorStr = await getEnsueClient().readMemory(workerKeys.ERROR);

  return {
    workerId: WORKER_ID,
    status: (statusStr as TaskStatus) || 'idle',
    timestamp: timestampStr ? parseInt(timestampStr) : undefined,
    error: errorStr || undefined,
  };
}

/**
 * Initialize worker by setting idle status
 */
export async function initializeWorker(): Promise<void> {
  console.log(`[${WORKER_ID}] Initializing worker...`);

  try {
    // Set initial status to idle
    await updateStatus('idle');

    // Clear any previous error
    await getEnsueClient().deleteMemory(workerKeys.ERROR);

    // Initialize Nova persistent identity (non-blocking)
    if (process.env.NOVA_API_KEY) {
      initializeIdentity()
        .then(() => console.log(`[${WORKER_ID}] Nova identity initialized`))
        .catch(e => console.warn(`[${WORKER_ID}] Nova identity init failed (non-critical):`, e));
    } else {
      console.log(`[${WORKER_ID}] NOVA_API_KEY not set, skipping Nova identity`);
    }

    console.log(`[${WORKER_ID}] Worker initialized successfully`);
  } catch (error) {
    console.error(`[${WORKER_ID}] Failed to initialize worker:`, error);
    throw error;
  }
}

// Initialization is called from index.ts after dotenv loads
