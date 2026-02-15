import { NovaSdk, NovaError } from 'nova-sdk-js';
import { sleep, jitter } from '@near-shade-coordination/shared';
import * as crypto from 'crypto';

/* ─── Robustness & Concurrency Control ────────────────────────────────────── */

interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  onRetry?: (error: any, attempt: number) => void;
}

/**
 * Execute a task with exponential backoff and jitter.
 */
async function withRetry<T>(
  task: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 5,
    baseDelay = 1000,
    maxDelay = 10000,
    onRetry,
  } = options;

  let attempt = 0;
  while (true) {
    try {
      return await task();
    } catch (error: any) {
      attempt++;
      if (attempt > maxRetries) throw error;

      // Extract details if it's a Nova/Axios error
      const status = error?.status || error?.cause?.response?.status;
      const responseData = error?.cause?.response?.data || error?.message;

      // Log the failure
      if (onRetry) onRetry(error, attempt);
      else {
        const errorMsg = typeof responseData === 'object' ? JSON.stringify(responseData) : responseData;
        console.warn(`[nova-robust] Attempt ${attempt} failed (status: ${status}): ${errorMsg}. Retrying...`);
      }

      // Calculate exponential backoff with jitter
      const delay = Math.min(maxDelay, jitter(baseDelay * Math.pow(2, attempt - 1)));
      await sleep(delay);
    }
  }
}

/**
 * Re-implementation of AES-256-GCM encryption compatible with Nova.
 */
async function localEncryptData(data: Buffer, keyB64: string): Promise<string> {
  const keyBytes = Buffer.from(keyB64, 'base64');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: IV (12) + ciphertext + authTag (16)
  const result = Buffer.concat([iv, encrypted, authTag]);
  return result.toString('base64');
}

/**
 * Re-implementation of SHA-256 hash compatible with Nova.
 */
function localComputeHash(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Robust upload flow with internal pauses and step-level retries.
 * Prevents nonce collisions and TEE timing issues.
 */
async function robustUpload(groupId: string, data: Buffer, filename: string): Promise<{ cid: string; trans_id: string }> {
  const sdk = getSdk();
  
  // Step 1: Prepare Upload (Get Encryption Key)
  console.log(`[nova-robust] Step 1: Preparing upload for ${filename}...`);
  const prepareResult = await withRetry(async () => {
    return (sdk as any).callMcpTool('prepare_upload', {
      group_id: groupId,
      filename,
    });
  });

  const { upload_id, key } = prepareResult;

  // DELIBERATE PAUSE: Allow the TEE and MCP state to settle 
  // This reduces consistency errors between prepare and finalize.
  const settleDelay = jitter(1000); 
  await sleep(settleDelay);

  // Step 2: Local Encryption & Hash
  const encryptedB64 = await localEncryptData(data, key);
  const fileHash = localComputeHash(data);

  // Step 3: Finalize Upload
  console.log(`[nova-robust] Step 2: Finalizing upload (ID: ${upload_id.substring(0, 8)})...`);
  const finalizeResult = await withRetry(async () => {
    try {
      return await (sdk as any).callHttpEndpoint('/api/finalize-upload', {
        upload_id,
        encrypted_data: encryptedB64,
        file_hash: fileHash,
      });
    } catch (e: any) {
      // If we see a nonce/record failure, apply a longer specific backoff
      const responseData = e?.cause?.response?.data;
      if (typeof responseData === 'string' && responseData.includes('Record failed')) {
        console.warn(`[nova-robust] Nonce collision detected in finalize. Applying penalty delay...`);
        await sleep(2000); // 2s extra for the on-chain state to clear
      }
      throw e;
    }
  });

  return {
    cid: finalizeResult.cid,
    trans_id: finalizeResult.trans_id
  };
}

/**
 * Nova SDK client for persistent agent identity storage.
 *
 * Nova always runs on NEAR mainnet. The NEAR smart contract can be on
 * testnet or mainnet independently.
 *
 * Each worker agent has its own Nova account and private group
 * (cryptographically isolated via AES-256-GCM keys in the TEE).
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
  const groupId = process.env.NOVA_GROUP_ID;
  if (!groupId) {
    throw new Error('NOVA_GROUP_ID must be set — each worker needs its own private Nova group');
  }
  return groupId;
}

export function isNovaAvailable(): boolean {
  return _novaAvailable;
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
  const buf = Buffer.from(JSON.stringify(data, null, 2));

  // Use the robust upload flow instead of the standard SDK method
  const result = await robustUpload(getGroupId(), buf, filename);

  console.log(`[nova] Uploaded ${filename} -> CID: ${result.cid}`);
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
        filename: 'health-check-probe.json',
      });
      result.prepareUploadTest = { 
        status: 'ok', 
        hasUploadId: !!uploadResult?.upload_id, 
        hasKey: !!uploadResult?.key,
        fullResponse: uploadResult
      };
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
