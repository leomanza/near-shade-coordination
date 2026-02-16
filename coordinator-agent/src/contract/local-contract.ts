/**
 * Local contract interaction via NEAR JSON-RPC (for LOCAL_MODE testing)
 * Uses direct RPC calls - no external dependencies needed
 */
import crypto from 'crypto';
import { Buffer } from 'buffer';

const NEAR_NETWORK = process.env.NEAR_NETWORK || 'testnet';
const CONTRACT_ID = process.env.NEXT_PUBLIC_contractId
  || (NEAR_NETWORK === 'mainnet' ? 'coordinator.agents-coordinator.near' : 'coordinator.agents-coordinator.testnet');
const SIGNER_ID = process.env.NEAR_ACCOUNT_ID
  || (NEAR_NETWORK === 'mainnet' ? 'agents-coordinator.near' : 'agents-coordinator.testnet');
const NEAR_RPC = process.env.NEAR_RPC_JSON
  || (NEAR_NETWORK === 'mainnet' ? 'https://rpc.fastnear.com' : 'https://test.rpc.fastnear.com');

// We use near CLI for transaction signing (sign-with-keychain)
import { execSync } from 'child_process';

const NEAR_CLI = process.env.NEAR_CLI_PATH || '/Users/manza/.cargo/bin/near';

function nearCliCall(methodName: string, args: Record<string, unknown>, gas: string = '200 Tgas'): string {
  const argsJson = JSON.stringify(args);
  const argsB64 = Buffer.from(argsJson).toString('base64');
  const cmd = `${NEAR_CLI} contract call-function as-transaction ${CONTRACT_ID} ${methodName} base64-args '${argsB64}' prepaid-gas '${gas}' attached-deposit '0 NEAR' sign-as ${SIGNER_ID} network-config ${NEAR_NETWORK} sign-with-keychain send`;

  console.log(`[CONTRACT] Calling ${methodName} with args (${argsJson.length} bytes)...`);
  try {
    const result = execSync(cmd, {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${process.env.HOME}/.cargo/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}` },
    });
    console.log(`[CONTRACT] ${methodName} CLI output:`, result.substring(0, 500));
    return result;
  } catch (error: any) {
    // Log both stdout and stderr from the failed command
    if (error.stderr) console.error(`[CONTRACT] ${methodName} stderr:`, error.stderr.substring(0, 500));
    if (error.stdout) console.log(`[CONTRACT] ${methodName} stdout:`, error.stdout.substring(0, 500));
    throw error;
  }
}

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

/**
 * Call start_coordination on the contract (creates yield + pending request)
 */
export async function localStartCoordination(taskConfig: string): Promise<number | null> {
  const beforeId = await localViewCall<number>('get_current_proposal_id', {}) ?? 0;

  try {
    nearCliCall('start_coordination', { task_config: taskConfig });
  } catch (error: any) {
    // The CLI times out waiting for yield resolution, but the tx itself succeeds.
    // Check if proposal was actually created by comparing proposal IDs.
    const msg = error.message || '';
    if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
      console.warn('[CONTRACT] CLI timed out (expected for yield/resume pattern), checking if tx succeeded...');
    } else {
      console.error('[CONTRACT] start_coordination failed:', msg.substring(0, 200));
      return null;
    }
  }

  // Wait a moment for the transaction to be finalized
  await new Promise(r => setTimeout(r, 3000));

  // Check if proposal ID incremented (meaning start_coordination succeeded)
  const afterId = await localViewCall<number>('get_current_proposal_id', {}) ?? 0;
  if (afterId > beforeId) {
    const proposalId = afterId; // Contract uses ++id then stores, so proposal = current_proposal_id
    console.log(`[CONTRACT] start_coordination succeeded, proposal #${proposalId}`);
    return proposalId;
  }

  console.error('[CONTRACT] start_coordination did not create a new proposal');
  return null;
}

/**
 * Record worker submissions on-chain (nullifier pattern)
 * Must be called after workers complete, before coordinator_resume
 */
export async function localRecordWorkerSubmissions(
  proposalId: number,
  submissions: Array<{ worker_id: string; result_hash: string }>
): Promise<boolean> {
  try {
    nearCliCall('record_worker_submissions', {
      proposal_id: proposalId,
      submissions,
    }, '100 Tgas');

    console.log(`[CONTRACT] record_worker_submissions succeeded for proposal #${proposalId} (${submissions.length} workers)`);
    return true;
  } catch (error: any) {
    const msg = error.message || '';
    if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
      console.warn('[CONTRACT] record_worker_submissions CLI timed out, checking state...');
      await new Promise(r => setTimeout(r, 3000));

      // Verify by checking proposal state
      const proposal = await localViewCall<any>('get_proposal', { proposal_id: proposalId });
      if (proposal && proposal.state === 'WorkersCompleted') {
        console.log(`[CONTRACT] record_worker_submissions verified - proposal #${proposalId} in WorkersCompleted state`);
        return true;
      }
      console.error(`[CONTRACT] record_worker_submissions may have failed for proposal #${proposalId}`);
      return false;
    }

    console.error(`[CONTRACT] record_worker_submissions failed:`, msg.substring(0, 200));
    return false;
  }
}

// ========== Worker Registration ==========

/**
 * Register a worker on-chain
 */
export async function localRegisterWorker(
  workerId: string,
  accountId?: string
): Promise<boolean> {
  try {
    nearCliCall('register_worker', {
      worker_id: workerId,
      account_id: accountId || null,
    });
    console.log(`[CONTRACT] register_worker succeeded: ${workerId}`);
    return true;
  } catch (error: any) {
    console.error(`[CONTRACT] register_worker failed:`, (error.message || '').substring(0, 200));
    return false;
  }
}

/**
 * Remove a worker from the on-chain registry
 */
export async function localRemoveWorker(workerId: string): Promise<boolean> {
  try {
    nearCliCall('remove_worker', { worker_id: workerId });
    console.log(`[CONTRACT] remove_worker succeeded: ${workerId}`);
    return true;
  } catch (error: any) {
    console.error(`[CONTRACT] remove_worker failed:`, (error.message || '').substring(0, 200));
    return false;
  }
}

/**
 * Get registered workers from contract (view call)
 */
export async function localGetRegisteredWorkers(): Promise<any[]> {
  return await localViewCall<any[]>('get_registered_workers', {}) ?? [];
}

/**
 * Get active worker count from contract (view call)
 */
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
    nearCliCall('coordinator_resume', {
      proposal_id: proposalId,
      aggregated_result: aggregatedResult,
      config_hash: configHash,
      result_hash: resultHash,
    }, '100 Tgas');

    console.log(`[CONTRACT] coordinator_resume succeeded for proposal #${proposalId}`);
    return true;
  } catch (error: any) {
    // CLI may time out waiting for yield callback receipts, but tx itself succeeds.
    const msg = error.message || '';
    if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) {
      console.warn('[CONTRACT] coordinator_resume CLI timed out, verifying on-chain...');
      await new Promise(r => setTimeout(r, 5000));

      // Verify by checking if the coordination was finalized
      const finalized = await localViewCall<string>('get_finalized_coordination', { proposal_id: proposalId });
      if (finalized) {
        console.log(`[CONTRACT] coordinator_resume verified - proposal #${proposalId} finalized on-chain`);
        return true;
      }

      // Also check if it was at least removed from pending
      const pending = await localViewCall<[number, any][]>('get_pending_coordinations', { from_index: null, limit: null });
      const stillPending = pending?.some(([id]) => id === proposalId);
      if (!stillPending) {
        console.log(`[CONTRACT] coordinator_resume likely succeeded - proposal #${proposalId} no longer pending`);
        return true;
      }

      console.error(`[CONTRACT] coordinator_resume may have failed - proposal #${proposalId} still pending`);
      return false;
    }

    console.error(`[CONTRACT] coordinator_resume failed:`, msg.substring(0, 200));
    return false;
  }
}
