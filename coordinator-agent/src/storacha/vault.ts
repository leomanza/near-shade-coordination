/**
 * Storacha Vault — Encrypt + upload / retrieve + decrypt via Storacha + Lit Protocol.
 *
 * Uses @storacha/encrypt-upload-client with the Lit crypto adapter for
 * threshold-encrypted decentralized storage.
 *
 * All ESM-only packages are loaded via dynamic import() (CJS project).
 *
 * Environment variables:
 *   STORACHA_AGENT_PRIVATE_KEY  — Ed25519 private key (from `storacha key create`)
 *   STORACHA_DELEGATION_PROOF   — Base64-encoded UCAN delegation CAR
 *   STORACHA_SPACE_DID           — (optional) Space DID
 *   LIT_NETWORK                  — Lit network name (default: nagaDev)
 */

import { createStorachaClient } from './identity';

// Cached instances
let _encryptedClient: any = null;
let _litClient: any = null;
let _authManager: any = null;

// Lazy-loaded ESM modules
let _eucCreate: any = null;
let _litFactory: any = null;
let _createLitClient: any = null;
let _createAuthManager: any = null;
let _nagaDev: any = null;
let _storagePlugins: any = null;

async function loadModules() {
  if (!_eucCreate) {
    const euc = await import('@storacha/encrypt-upload-client');
    _eucCreate = euc.create;

    const factories = await import(
      '@storacha/encrypt-upload-client/factories.node' as any
    );
    _litFactory = factories.createGenericLitAdapter;

    const litClient = await import('@lit-protocol/lit-client');
    _createLitClient = litClient.createLitClient;

    const litAuth = await import('@lit-protocol/auth');
    _createAuthManager = litAuth.createAuthManager;
    _storagePlugins = litAuth.storagePlugins;

    const networks = await import('@lit-protocol/networks');
    _nagaDev = networks.nagaDev;
  }
}

/**
 * Get or create the Lit Protocol client (connects to network).
 */
async function getLitClient() {
  if (_litClient) return _litClient;
  await loadModules();

  console.log('[vault] Connecting to Lit Protocol network...');
  _litClient = await _createLitClient({ network: _nagaDev });
  console.log('[vault] Lit client connected');
  return _litClient;
}

/**
 * Get or create the Lit auth manager.
 */
async function getAuthManager() {
  if (_authManager) return _authManager;
  await loadModules();

  _authManager = _createAuthManager({
    storage: _storagePlugins.localStorageNode({
      appName: 'delibera-coordinator',
      networkName: 'naga-dev',
      storagePath: './.lit-auth-storage',
    }),
  });
  return _authManager;
}

/**
 * Get or create the encrypted Storacha client (with Lit crypto adapter).
 */
export async function getEncryptedClient() {
  if (_encryptedClient) return _encryptedClient;

  const storachaClient = await createStorachaClient();
  const litClient = await getLitClient();
  const authManager = await getAuthManager();

  const cryptoAdapter = _litFactory(litClient, authManager);

  _encryptedClient = await _eucCreate({
    storachaClient,
    cryptoAdapter,
  });

  console.log('[vault] Encrypted client ready (Lit + Storacha)');
  return _encryptedClient;
}

/**
 * Encrypt a JSON object and upload it to Storacha.
 *
 * @param data - Any JSON-serializable object
 * @param metadata - Optional file metadata (name, type, extension)
 * @returns The CID of the uploaded encrypted content
 */
export async function encryptAndVault(
  data: unknown,
  metadata?: { name?: string; type?: string; extension?: string }
): Promise<string> {
  const encryptedClient = await getEncryptedClient();
  const storachaClient = await createStorachaClient();

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  const currentSpace = storachaClient.currentSpace();
  if (!currentSpace) {
    throw new Error('[vault] No current space set on Storacha client');
  }

  const encryptionConfig = {
    issuer: storachaClient.agent,
    spaceDID: currentSpace.did(),
    proofs: storachaClient.proofs(),
    fileMetadata: {
      name: metadata?.name || 'vault-data.json',
      type: metadata?.type || 'application/json',
      extension: metadata?.extension || 'json',
    },
  };

  console.log('[vault] Encrypting and uploading...');
  const cid = await encryptedClient.encryptAndUploadFile(
    blob,
    encryptionConfig
  );

  console.log(`[vault] Upload complete. CID: ${cid}`);
  return cid.toString();
}

/**
 * Retrieve and decrypt a previously vaulted object from Storacha.
 *
 * @param cidString - The CID string returned by encryptAndVault()
 * @param wallet - viem Account for Lit auth (private key account)
 * @param decryptDelegation - UCAN delegation proof with space/content/decrypt capability
 * @returns The decrypted data as a parsed JSON object
 */
export async function retrieveAndDecrypt(
  cidString: string,
  wallet: any,
  decryptDelegation: any
): Promise<unknown> {
  const encryptedClient = await getEncryptedClient();
  const storachaClient = await createStorachaClient();

  const currentSpace = storachaClient.currentSpace();
  if (!currentSpace) {
    throw new Error('[vault] No current space set on Storacha client');
  }

  // Parse CID
  const { CID } = await import('multiformats/cid');
  const cid = CID.parse(cidString);

  const decryptionConfig = {
    decryptDelegation,
    spaceDID: currentSpace.did(),
    proofs: storachaClient.proofs(),
    wallet,
  };

  console.log(`[vault] Retrieving and decrypting CID: ${cidString}`);
  const { stream, fileMetadata } =
    await encryptedClient.retrieveAndDecryptFile(cid, decryptionConfig);

  // Read the stream to a string
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const combined = new Uint8Array(
    chunks.reduce((acc, c) => acc + c.length, 0)
  );
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(combined);
  console.log(`[vault] Decryption complete. File: ${fileMetadata?.name || 'unknown'}`);

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Back up a deliberation transcript to Storacha.
 * Called after coordinator_resume succeeds.
 *
 * @param proposalId - The proposal ID
 * @param taskConfig - The original task config
 * @param tally - The aggregation result
 * @returns The CID of the backup, or null if vault is not configured
 */
export async function backupDeliberation(
  proposalId: string | number,
  taskConfig: string,
  tally: unknown
): Promise<string | null> {
  if (!isVaultConfigured()) {
    console.log('[vault] Storacha not configured, skipping backup');
    return null;
  }

  try {
    const transcript = {
      type: 'deliberation_backup',
      proposalId: String(proposalId),
      taskConfig: (() => { try { return JSON.parse(taskConfig); } catch { return taskConfig; } })(),
      tally,
      backedUpAt: new Date().toISOString(),
    };

    const cid = await encryptAndVault(transcript, {
      name: `deliberation-${proposalId}.json`,
    });

    console.log(`[vault] Deliberation #${proposalId} backed up to Storacha: ${cid}`);
    return cid;
  } catch (error) {
    console.error(`[vault] Failed to back up deliberation #${proposalId}:`, error);
    return null;
  }
}

/**
 * Check if the vault is configured and ready to use.
 */
export function isVaultConfigured(): boolean {
  return !!(
    process.env.STORACHA_AGENT_PRIVATE_KEY &&
    process.env.STORACHA_DELEGATION_PROOF
  );
}
