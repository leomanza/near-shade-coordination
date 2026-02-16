/**
 * Contract interaction via NEAR JSON-RPC + CLI
 * Used by protocol-api for worker registration and view calls.
 */
import { Buffer } from 'buffer';
import { execSync } from 'child_process';

const NEAR_NETWORK = process.env.NEAR_NETWORK || 'testnet';
const CONTRACT_ID = process.env.NEXT_PUBLIC_contractId
  || (NEAR_NETWORK === 'mainnet' ? 'coordinator.agents-coordinator.near' : 'coordinator.agents-coordinator.testnet');
const SIGNER_ID = process.env.NEAR_ACCOUNT_ID
  || (NEAR_NETWORK === 'mainnet' ? 'agents-coordinator.near' : 'agents-coordinator.testnet');
const NEAR_RPC = process.env.NEAR_RPC_JSON
  || (NEAR_NETWORK === 'mainnet' ? 'https://rpc.fastnear.com' : 'https://test.rpc.fastnear.com');
const NEAR_CLI = process.env.NEAR_CLI_PATH || `${process.env.HOME}/.cargo/bin/near`;

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

export async function localRegisterWorker(workerId: string, accountId?: string): Promise<boolean> {
  try {
    nearCliCall('register_worker', { worker_id: workerId, account_id: accountId || null });
    console.log(`[CONTRACT] register_worker succeeded: ${workerId}`);
    return true;
  } catch (error: any) {
    console.error(`[CONTRACT] register_worker failed:`, (error.message || '').substring(0, 200));
    return false;
  }
}

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

export async function localGetRegisteredWorkers(): Promise<any[]> {
  return await localViewCall<any[]>('get_registered_workers', {}) ?? [];
}

export async function localGetWorkerCount(): Promise<number> {
  return await localViewCall<number>('get_worker_count', {}) ?? 0;
}
