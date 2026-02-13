import { NovaSdk, NovaError } from 'nova-sdk-js';

const WORKER_ID = process.env.WORKER_ID || 'worker1';

/**
 * Nova SDK client for persistent agent identity storage.
 *
 * Nova always runs on NEAR mainnet. The NEAR smart contract can be on
 * testnet or mainnet independently.
 *
 * All agents share a single Nova group (`shadeboard-agents`). Each agent
 * differentiates its files by prefixing with its worker ID.
 * Ensue handles real-time coordination; Nova handles long-term memory.
 */

let _sdk: NovaSdk | null = null;
let _novaAvailable = true; // Track whether Nova is operational

function getSdk(): NovaSdk {
  if (!_sdk) {
    const accountId = process.env.NOVA_ACCOUNT_ID;
    const apiKey = process.env.NOVA_API_KEY;
    if (!accountId || !apiKey) {
      throw new Error('NOVA_ACCOUNT_ID and NOVA_API_KEY must be set');
    }
    // Nova always uses mainnet (default settings)
    _sdk = new NovaSdk(accountId, { apiKey });
  }
  return _sdk;
}

export function getGroupId(): string {
  return process.env.NOVA_GROUP_ID || 'shadeboard-agents';
}

export function isNovaAvailable(): boolean {
  return _novaAvailable;
}

/**
 * Prefix a filename with the worker ID so multiple agents can share one group.
 * e.g. "manifesto.json" → "worker1/manifesto.json"
 */
export function prefixFilename(filename: string): string {
  return `${WORKER_ID}/${filename}`;
}

/**
 * Diagnose Nova setup issues. Returns diagnostic info for debugging.
 */
export async function diagnoseNova(): Promise<{
  accountId: string;
  groupId: string;
  networkInfo: unknown;
  authStatus: unknown;
  isAuthorized: boolean;
  groupOwner: string | null;
  balance: string | null;
  error?: string;
}> {
  const accountId = process.env.NOVA_ACCOUNT_ID || '';
  const groupId = getGroupId();

  const result: any = {
    accountId,
    groupId,
    networkInfo: null,
    authStatus: null,
    isAuthorized: false,
    groupOwner: null,
    balance: null,
  };

  try {
    const sdk = getSdk();
    result.networkInfo = sdk.getNetworkInfo();

    try {
      result.balance = await sdk.getBalance();
    } catch (e) {
      result.balance = `Error: ${e instanceof Error ? e.message : e}`;
    }

    try {
      result.groupOwner = await sdk.getGroupOwner(groupId);
    } catch (e) {
      result.groupOwner = null;
    }

    try {
      result.isAuthorized = await sdk.isAuthorized(groupId);
    } catch (e) {
      result.isAuthorized = false;
    }

    try {
      result.authStatus = await sdk.authStatus(groupId);
    } catch (e) {
      result.authStatus = `Error: ${e instanceof Error ? e.message : e}`;
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  return result;
}

/**
 * Ensure the shared Nova group exists and this account is authorized.
 * Safe to call multiple times.
 */
export async function ensureGroup(): Promise<void> {
  const groupId = getGroupId();
  const sdk = getSdk();

  // Step 1: Check if group exists
  let groupOwner: string | null = null;
  try {
    groupOwner = await sdk.getGroupOwner(groupId);
    if (groupOwner) {
      console.log(`[nova] Group "${groupId}" exists (owner: ${groupOwner})`);
    }
  } catch {
    // Group doesn't exist yet
  }

  // Step 2: Register group if it doesn't exist
  if (!groupOwner) {
    try {
      await sdk.registerGroup(groupId);
      console.log(`[nova] Registered group "${groupId}"`);
    } catch (e) {
      if (e instanceof NovaError && e.message.includes('already')) {
        console.log(`[nova] Group "${groupId}" already registered`);
      } else if (e instanceof NovaError && e.message.includes('balance')) {
        console.warn(`[nova] Insufficient NEAR balance to register group. Fund your Nova account at nova-sdk.com`);
        _novaAvailable = false;
        throw e;
      } else {
        console.warn(`[nova] Failed to register group:`, e instanceof Error ? e.message : e);
        _novaAvailable = false;
        throw e;
      }
    }
  }

  // Step 3: Check authorization
  try {
    const authorized = await sdk.isAuthorized(groupId);
    if (!authorized) {
      console.warn(`[nova] Account not authorized for group "${groupId}". ` +
        `Group owner must add this account as a member.`);
      _novaAvailable = false;
      return;
    }
    console.log(`[nova] Account authorized for group "${groupId}"`);
  } catch (e) {
    console.warn(`[nova] Auth check failed:`, e instanceof Error ? e.message : e);
    // Continue anyway - auth check might fail but uploads could still work
  }
}

/**
 * Upload a JSON document to the shared Nova group.
 * Filename is auto-prefixed with worker ID.
 * Returns the IPFS CID for later retrieval.
 */
export async function uploadJson(filename: string, data: unknown): Promise<string> {
  if (!_novaAvailable) {
    throw new Error('Nova is not available (setup incomplete or unauthorized)');
  }
  const prefixed = prefixFilename(filename);
  const buf = Buffer.from(JSON.stringify(data, null, 2));
  const result = await getSdk().upload(getGroupId(), buf, prefixed);
  console.log(`[nova] Uploaded ${prefixed} -> CID: ${result.cid}`);
  return result.cid;
}

/**
 * Retrieve and parse a JSON document from Nova by CID.
 */
export async function retrieveJson<T = unknown>(cid: string): Promise<T> {
  if (!_novaAvailable) {
    throw new Error('Nova is not available (setup incomplete or unauthorized)');
  }
  const { data } = await getSdk().retrieve(getGroupId(), cid);
  return JSON.parse(data.toString()) as T;
}

/**
 * Check auth status for the shared group.
 */
export async function checkAuth(): Promise<boolean> {
  try {
    const status = await getSdk().authStatus(getGroupId());
    return status.authenticated;
  } catch {
    return false;
  }
}

/**
 * Get all transactions (uploads) for the shared group.
 */
export async function listGroupTransactions() {
  return getSdk().getTransactionsForGroup(getGroupId());
}

/**
 * Comprehensive Nova health/info query.
 * Returns balance, group info, transactions, fees, and shade key status.
 */
export async function novaHealthInfo(): Promise<Record<string, unknown>> {
  const accountId = process.env.NOVA_ACCOUNT_ID || '';
  const groupId = getGroupId();
  const result: Record<string, unknown> = {
    accountId,
    groupId,
    novaAvailable: _novaAvailable,
    networkInfo: null,
    balance: null,
    groupOwner: null,
    groupChecksum: null,
    isAuthorized: null,
    authStatus: null,
    transactions: null,
    feeEstimate: null,
    shadeKeyTest: null,
    prepareUploadTest: null,
  };

  try {
    const sdk = getSdk();
    result.networkInfo = sdk.getNetworkInfo();

    // Balance
    try { result.balance = await sdk.getBalance(); }
    catch (e) { result.balance = { error: e instanceof Error ? e.message : String(e) }; }

    // Group owner
    try { result.groupOwner = await sdk.getGroupOwner(groupId); }
    catch (e) { result.groupOwner = { error: e instanceof Error ? e.message : String(e) }; }

    // Group checksum
    try { result.groupChecksum = await sdk.getGroupChecksum(groupId); }
    catch (e) { result.groupChecksum = { error: e instanceof Error ? e.message : String(e) }; }

    // Authorization
    try { result.isAuthorized = await sdk.isAuthorized(groupId); }
    catch (e) { result.isAuthorized = { error: e instanceof Error ? e.message : String(e) }; }

    // Auth status (MCP)
    try { result.authStatus = await sdk.authStatus(groupId); }
    catch (e) { result.authStatus = { error: e instanceof Error ? e.message : String(e) }; }

    // Transactions
    try { result.transactions = await sdk.getTransactionsForGroup(groupId); }
    catch (e) { result.transactions = { error: e instanceof Error ? e.message : String(e) }; }

    // Fee estimation
    try {
      const fee = await sdk.estimateFee('register_group');
      result.feeEstimate = { register_group: fee.toString() };
    } catch (e) { result.feeEstimate = { error: e instanceof Error ? e.message : String(e) }; }

    // Shade key test (probes TEE key availability — the root cause of prepare_upload failures)
    try {
      const keyResult = await (sdk as any).callMcpTool('get_shade_key', { group_id: groupId });
      result.shadeKeyTest = { status: 'ok', hasKey: !!keyResult?.key };
    } catch (e) {
      result.shadeKeyTest = {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
        serverResponse: (e as any)?.cause?.response?.data || null,
      };
    }

    // prepare_upload test (the actual failing call)
    try {
      const uploadResult = await (sdk as any).callMcpTool('prepare_upload', {
        group_id: groupId,
        filename: `${WORKER_ID}/health-check-probe.json`,
      });
      result.prepareUploadTest = { status: 'ok', hasUploadId: !!uploadResult?.upload_id, hasKey: !!uploadResult?.key };
    } catch (e) {
      result.prepareUploadTest = {
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
        serverResponse: (e as any)?.cause?.response?.data || null,
      };
    }
  } catch (e) {
    result.sdkError = e instanceof Error ? e.message : String(e);
  }

  return result;
}
