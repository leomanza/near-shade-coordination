/**
 * Local contract interaction via near-api-js (for LOCAL_MODE)
 * Uses seed phrase signing — no CLI binary needed.
 */
import { Buffer } from 'buffer';
import { connect, keyStores, KeyPair, Account } from 'near-api-js';
import { parseSeedPhrase } from 'near-seed-phrase';

const NEAR_NETWORK = process.env.NEAR_NETWORK || 'testnet';
const CONTRACT_ID = process.env.NEXT_PUBLIC_contractId
  || (NEAR_NETWORK === 'mainnet' ? 'coordinator.agents-coordinator.near' : 'coordinator.agents-coordinator.testnet');
const SIGNER_ID = process.env.NEAR_ACCOUNT_ID
  || (NEAR_NETWORK === 'mainnet' ? 'agents-coordinator.near' : 'agents-coordinator.testnet');
const NEAR_RPC = process.env.NEAR_RPC_JSON
  || (NEAR_NETWORK === 'mainnet' ? 'https://rpc.fastnear.com' : 'https://test.rpc.fastnear.com');
const SEED_PHRASE = process.env.NEAR_SEED_PHRASE || '';

/* ─── near-api-js setup ──────────────────────────────────────────────────── */

let _account: Account | null = null;

async function getAccount(): Promise<Account> {
  if (_account) return _account;
  if (!SEED_PHRASE) {
    throw new Error('NEAR_SEED_PHRASE is required for contract calls');
  }
  const { secretKey } = parseSeedPhrase(SEED_PHRASE);
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(secretKey as any);
  await keyStore.setKey(NEAR_NETWORK, SIGNER_ID, keyPair);

  const near = await connect({
    networkId: NEAR_NETWORK,
    keyStore,
    nodeUrl: NEAR_RPC,
  });
  _account = await near.account(SIGNER_ID);
  return _account;
}

const GAS_200T = '200000000000000';
const GAS_100T = '100000000000000';

/**
 * Call a change method on the contract using near-api-js.
 * Returns the transaction outcome or null on failure.
 */
async function contractCall(
  methodName: string,
  args: Record<string, unknown>,
  gas: string = GAS_200T,
): Promise<any> {
  const account = await getAccount();
  console.log(`[CONTRACT] Calling ${methodName} (${JSON.stringify(args).length} bytes)...`);

  const outcome = await account.functionCall({
    contractId: CONTRACT_ID,
    methodName,
    args,
    gas: BigInt(gas),
    attachedDeposit: BigInt(0),
  });

  console.log(`[CONTRACT] ${methodName} tx sent`);
  return outcome;
}

/* ─── View calls (no signing needed) ─────────────────────────────────────── */

/**
 * View call via NEAR RPC (no signing needed)
 */
export async function localViewCall<T>(methodName: string, args: Record<string, unknown>): Promise<T | null> {
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
          method_name: methodName,
          args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        },
      }),
    });
    const data = await res.json() as any;
    if (data.error || !data.result?.result) return null;
    const bytes = new Uint8Array(data.result.result);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch (error) {
    console.error(`[CONTRACT] View ${methodName} failed:`, error);
    return null;
  }
}

/* ─── Change calls ───────────────────────────────────────────────────────── */

/**
 * Call start_coordination on the contract (creates yield + pending request)
 */
export async function localStartCoordination(
  taskConfig: string,
  expectedWorkerCount: number = 3,
  quorum: number = 0,
): Promise<number | null> {
  const beforeId = await localViewCall<number>('get_current_proposal_id', {}) ?? 0;

  // Fire the start_coordination tx in the background — don't await it.
  // The tx creates the proposal via promise_yield_create (synchronous part),
  // then blocks waiting for coordinator_resume (the yield). We only need the
  // proposal to exist, not the yield to resolve.
  contractCall('start_coordination', {
    task_config: taskConfig,
    expected_worker_count: expectedWorkerCount,
    quorum,
  }).catch(err => {
    const msg = err?.message || '';
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT') || msg.includes('Timeout') || msg.includes('yield')) {
      // Expected: tx blocks on yield then times out — ignore
    } else {
      console.warn('[CONTRACT] start_coordination background error:', msg.substring(0, 200));
    }
  });

  // Poll for the proposal ID to increment (means tx landed and proposal was created).
  // Testnet blocks are ~0.5s, so check every 500ms for up to 8s.
  const POLL_MS = 500;
  const MAX_WAIT = 8000;
  const start = Date.now();

  while (Date.now() - start < MAX_WAIT) {
    await new Promise(r => setTimeout(r, POLL_MS));
    const afterId = await localViewCall<number>('get_current_proposal_id', {}) ?? 0;
    if (afterId > beforeId) {
      console.log(`[CONTRACT] start_coordination succeeded, proposal #${afterId} (detected in ${Date.now() - start}ms)`);
      return afterId;
    }
  }

  console.error('[CONTRACT] start_coordination did not create a new proposal within 8s');
  return null;
}

/**
 * Record worker submissions on-chain (nullifier pattern)
 */
export async function localRecordWorkerSubmissions(
  proposalId: number,
  submissions: Array<{ worker_id: string; result_hash: string }>
): Promise<boolean> {
  try {
    await contractCall('record_worker_submissions', {
      proposal_id: proposalId,
      submissions,
    }, GAS_100T);

    console.log(`[CONTRACT] record_worker_submissions succeeded for proposal #${proposalId} (${submissions.length} workers)`);
    return true;
  } catch (error: any) {
    const msg = error.message || '';
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      console.warn('[CONTRACT] record_worker_submissions timed out, checking state...');
      await new Promise(r => setTimeout(r, 3000));

      const proposal = await localViewCall<any>('get_proposal', { proposal_id: proposalId });
      if (proposal && proposal.state === 'WorkersCompleted') {
        console.log(`[CONTRACT] record_worker_submissions verified - proposal #${proposalId} in WorkersCompleted state`);
        return true;
      }
    }

    console.error(`[CONTRACT] record_worker_submissions failed:`, msg.substring(0, 300));
    return false;
  }
}

/* ─── Worker Registration ────────────────────────────────────────────────── */

export async function localRegisterWorker(
  workerId: string,
  accountId?: string
): Promise<boolean> {
  try {
    await contractCall('register_worker', {
      worker_id: workerId,
      account_id: accountId || null,
    });
    console.log(`[CONTRACT] register_worker succeeded: ${workerId}`);
    return true;
  } catch (error: any) {
    console.error(`[CONTRACT] register_worker failed:`, (error.message || '').substring(0, 300));
    return false;
  }
}

export async function localRemoveWorker(workerId: string): Promise<boolean> {
  try {
    await contractCall('remove_worker', { worker_id: workerId });
    console.log(`[CONTRACT] remove_worker succeeded: ${workerId}`);
    return true;
  } catch (error: any) {
    console.error(`[CONTRACT] remove_worker failed:`, (error.message || '').substring(0, 300));
    return false;
  }
}

export async function localGetRegisteredWorkers(): Promise<any[]> {
  return await localViewCall<any[]>('get_registered_workers', {}) ?? [];
}

export async function localGetWorkerCount(): Promise<number> {
  return await localViewCall<number>('get_worker_count', {}) ?? 0;
}

/**
 * Call coordinator_resume on the contract (settles on-chain)
 */
export async function localCoordinatorResume(
  proposalId: number,
  aggregatedResult: string,
  configHash: string,
  resultHash: string
): Promise<boolean> {
  try {
    await contractCall('coordinator_resume', {
      proposal_id: proposalId,
      aggregated_result: aggregatedResult,
      config_hash: configHash,
      result_hash: resultHash,
    }, GAS_100T);

    console.log(`[CONTRACT] coordinator_resume succeeded for proposal #${proposalId}`);
    return true;
  } catch (error: any) {
    const msg = error.message || '';
    // yield/resume may cause timeouts or receipt errors, but tx itself succeeds
    if (msg.includes('timeout') || msg.includes('ETIMEDOUT')) {
      console.warn('[CONTRACT] coordinator_resume timed out, verifying on-chain...');
      await new Promise(r => setTimeout(r, 5000));

      const finalized = await localViewCall<string>('get_finalized_coordination', { proposal_id: proposalId });
      if (finalized) {
        console.log(`[CONTRACT] coordinator_resume verified - proposal #${proposalId} finalized`);
        return true;
      }

      const pending = await localViewCall<[number, any][]>('get_pending_coordinations', { from_index: null, limit: null });
      const stillPending = pending?.some(([id]) => id === proposalId);
      if (!stillPending) {
        console.log(`[CONTRACT] coordinator_resume likely succeeded - proposal #${proposalId} no longer pending`);
        return true;
      }

      console.error(`[CONTRACT] coordinator_resume may have failed - proposal #${proposalId} still pending`);
      return false;
    }

    console.error(`[CONTRACT] coordinator_resume failed:`, msg.substring(0, 300));
    return false;
  }
}

/* ─── Registry Contract ──────────────────────────────────────────────────── */

const REGISTRY_CONTRACT_ID = process.env.REGISTRY_CONTRACT_ID
  || (NEAR_NETWORK === 'mainnet' ? 'registry.agents-coordinator.near' : 'registry.agents-coordinator.testnet');

const DEPOSIT_0_1_NEAR = '100000000000000000000000'; // 0.1 NEAR in yocto

/**
 * View call to the registry contract (no signing needed)
 */
export async function localViewRegistry<T>(methodName: string, args: Record<string, unknown>): Promise<T | null> {
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
          method_name: methodName,
          args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
        },
      }),
    });
    const data = await res.json() as any;
    if (data.error || !data.result?.result) return null;
    const bytes = new Uint8Array(data.result.result);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch (error) {
    console.error(`[REGISTRY] View ${methodName} failed:`, error);
    return null;
  }
}

/**
 * Change call to the registry contract with deposit
 */
export async function localCallRegistry(
  methodName: string,
  args: Record<string, unknown>,
  depositYocto: string = '0',
  gas: string = GAS_200T,
): Promise<any> {
  const account = await getAccount();
  console.log(`[REGISTRY] Calling ${methodName} (deposit: ${depositYocto} yocto)...`);

  const outcome = await account.functionCall({
    contractId: REGISTRY_CONTRACT_ID,
    methodName,
    args,
    gas: BigInt(gas),
    attachedDeposit: BigInt(depositYocto),
  });

  console.log(`[REGISTRY] ${methodName} tx sent`);
  return outcome;
}

/**
 * Register the coordinator in the registry contract (idempotent).
 * Returns true if already registered or registration succeeds.
 */
export async function localRegisterCoordinator(
  coordinatorDid: string,
  endpointUrl: string,
  minWorkers: number,
  maxWorkers: number,
  cvmId: string = 'local',
): Promise<boolean> {
  try {
    // Check if already registered
    const existing = await localViewRegistry<any>('get_coordinator_by_did', {
      coordinator_did: coordinatorDid,
    });
    if (existing) {
      console.log(`[REGISTRY] Coordinator already registered: ${coordinatorDid}`);
      return true;
    }

    await localCallRegistry('register_coordinator', {
      coordinator_did: coordinatorDid,
      endpoint_url: endpointUrl,
      cvm_id: cvmId,
      min_workers: minWorkers,
      max_workers: maxWorkers,
    }, DEPOSIT_0_1_NEAR);

    console.log(`[REGISTRY] Coordinator registered: ${coordinatorDid}`);
    return true;
  } catch (error: any) {
    console.error(`[REGISTRY] register_coordinator failed:`, (error.message || '').substring(0, 300));
    return false;
  }
}

/**
 * Register a worker in the registry contract (idempotent).
 * Returns true if already registered or registration succeeds.
 */
export async function localRegisterWorkerInRegistry(
  coordinatorDid: string,
  workerDid: string,
  endpointUrl: string,
  cvmId: string,
): Promise<boolean> {
  try {
    await localCallRegistry('register_worker', {
      coordinator_did: coordinatorDid,
      worker_did: workerDid,
      endpoint_url: endpointUrl,
      cvm_id: cvmId,
    }, DEPOSIT_0_1_NEAR);

    console.log(`[REGISTRY] Worker registered: ${workerDid} → coordinator ${coordinatorDid}`);
    return true;
  } catch (error: any) {
    console.error(`[REGISTRY] register_worker failed:`, (error.message || '').substring(0, 300));
    return false;
  }
}
