/**
 * Worker Vault — Encrypt + upload / retrieve + decrypt via Storacha + Lit Protocol.
 *
 * Ported from coordinator-agent/src/storacha/vault.ts for worker-agent use.
 * Uses @storacha/encrypt-upload-client with the Lit crypto adapter for
 * threshold-encrypted decentralized storage.
 *
 * All ESM-only packages are loaded via dynamic import() (CJS project).
 *
 * Environment variables:
 *   STORACHA_AGENT_PRIVATE_KEY  — Ed25519 private key (from `storacha key create`)
 *   STORACHA_DELEGATION_PROOF   — Base64-encoded UCAN delegation CAR
 *   STORACHA_SPACE_DID           — (optional) Space DID
 *   STORACHA_GATEWAY_URL         — (optional) Primary gateway URL (default: https://storacha.link)
 *   LIT_NETWORK                  — Lit network name (default: nagaDev)
 */

import { createStorachaClient } from './identity';

const WORKER_ID = process.env.WORKER_ID || 'worker1';

/**
 * IPFS gateways for CID retrieval, in priority order.
 * The primary is configurable via env var; fallbacks are tried on failure.
 */
const PRIMARY_GATEWAY = process.env.STORACHA_GATEWAY_URL || 'https://storacha.link';
const FALLBACK_GATEWAYS = [
  'https://w3s.link',
  'https://dweb.link',
  'https://ipfs.io',
];

/** Max retries per gateway before moving to the next one. */
const RETRIES_PER_GATEWAY = 2;
/** Delay between retries on the same gateway (ms). */
const RETRY_DELAY_MS = 1500;

// Cached instances (use promise-based singletons for concurrent access)
let _encryptedClientPromise: Promise<any> | null = null;
let _litClientPromise: Promise<any> | null = null;
let _authManager: any = null;

// Lazy-loaded ESM modules (promise-based singleton to prevent race conditions)
let _modules: {
  eucCreate: any;
  litFactory: any;
  createLitClient: any;
  createAuthManager: any;
  nagaDev: any;
  storagePlugins: any;
} | null = null;
let _loadPromise: Promise<any> | null = null;

async function loadModules() {
  if (_modules) return _modules;
  if (!_loadPromise) {
    _loadPromise = (async () => {
      const euc = await import('@storacha/encrypt-upload-client');
      const factories = await import(
        '@storacha/encrypt-upload-client/factories.node' as any
      );
      const litClient = await import('@lit-protocol/lit-client');
      const litAuth = await import('@lit-protocol/auth');
      const networks = await import('@lit-protocol/networks');

      _modules = {
        eucCreate: euc.create,
        litFactory: factories.createGenericLitAdapter,
        createLitClient: litClient.createLitClient,
        createAuthManager: litAuth.createAuthManager,
        nagaDev: networks.nagaDev,
        storagePlugins: litAuth.storagePlugins,
      };
      return _modules;
    })();
  }
  return _loadPromise;
}

/**
 * Get or create the Lit Protocol client (connects to network).
 */
async function getLitClient() {
  if (!_litClientPromise) {
    _litClientPromise = (async () => {
      const mods = await loadModules();
      console.log(`[vault:${WORKER_ID}] Connecting to Lit Protocol network...`);
      const client = await mods!.createLitClient({ network: mods!.nagaDev });
      console.log(`[vault:${WORKER_ID}] Lit client connected`);
      return client;
    })();
  }
  return _litClientPromise;
}

/**
 * Get or create the Lit auth manager.
 */
async function getAuthManager() {
  if (_authManager) return _authManager;
  const mods = await loadModules();

  _authManager = mods!.createAuthManager({
    storage: mods!.storagePlugins.localStorageNode({
      appName: `delibera-${WORKER_ID}`,
      networkName: 'naga-dev',
      storagePath: `./.lit-auth-storage-${WORKER_ID}`,
    }),
  });
  return _authManager;
}

/**
 * Create an encrypted Storacha client pointing at a specific IPFS gateway.
 */
async function createEncryptedClientForGateway(gatewayUrl: string) {
  const mods = await loadModules();
  const storachaClient = await createStorachaClient();
  const litClient = await getLitClient();
  const authManager = await getAuthManager();

  const cryptoAdapter = mods!.litFactory(litClient, authManager);

  return mods!.eucCreate({
    storachaClient,
    cryptoAdapter,
    gatewayURL: new URL(gatewayUrl),
  });
}

/**
 * Get or create the primary encrypted Storacha client (with Lit crypto adapter).
 */
export async function getEncryptedClient() {
  if (!_encryptedClientPromise) {
    _encryptedClientPromise = (async () => {
      const client = await createEncryptedClientForGateway(PRIMARY_GATEWAY);
      console.log(`[vault:${WORKER_ID}] Encrypted client ready (Lit + Storacha, gateway: ${PRIMARY_GATEWAY})`);
      return client;
    })();
  }
  return _encryptedClientPromise;
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
    throw new Error(`[vault:${WORKER_ID}] No current space set on Storacha client`);
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

  const cid = await encryptedClient.encryptAndUploadFile(
    blob,
    encryptionConfig
  );

  console.log(`[vault:${WORKER_ID}] Upload complete. CID: ${cid}`);
  return cid.toString();
}

/** Sleep helper for retry delays. */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Attempt to retrieve + decrypt a CID using a specific encrypted client.
 * Returns the decrypted JSON or throws on failure.
 */
async function tryRetrieveAndDecrypt(
  encryptedClient: any,
  cidString: string,
  decryptionConfig: any,
): Promise<unknown> {
  const { CID } = await import('multiformats/cid');
  const cid = CID.parse(cidString);

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
    chunks.reduce((acc: number, c: Uint8Array) => acc + c.length, 0)
  );
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const text = new TextDecoder().decode(combined);
  console.log(`[vault:${WORKER_ID}] Decryption complete. File: ${fileMetadata?.name || 'unknown'}`);

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Retrieve and decrypt a previously vaulted object from Storacha.
 *
 * Tries the primary gateway first, then falls back to alternative IPFS gateways
 * if retrieval fails (e.g. 520 errors, corrupt CAR data, timeouts).
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
  const storachaClient = await createStorachaClient();

  const currentSpace = storachaClient.currentSpace();
  if (!currentSpace) {
    throw new Error(`[vault:${WORKER_ID}] No current space set on Storacha client`);
  }

  const decryptionConfig = {
    decryptDelegation,
    spaceDID: currentSpace.did(),
    proofs: storachaClient.proofs(),
    wallet,
  };

  // Build ordered list of gateways to try: primary + fallbacks (deduplicated)
  const allGateways = [PRIMARY_GATEWAY, ...FALLBACK_GATEWAYS.filter(g => g !== PRIMARY_GATEWAY)];
  const errors: Array<{ gateway: string; error: string }> = [];

  for (const gateway of allGateways) {
    for (let attempt = 1; attempt <= RETRIES_PER_GATEWAY; attempt++) {
      try {
        console.log(
          `[vault:${WORKER_ID}] Retrieving CID ${cidString} via ${gateway}` +
          (attempt > 1 ? ` (attempt ${attempt}/${RETRIES_PER_GATEWAY})` : '')
        );

        // Use primary cached client for primary gateway, fresh client for fallbacks
        const client = gateway === PRIMARY_GATEWAY
          ? await getEncryptedClient()
          : await createEncryptedClientForGateway(gateway);

        return await tryRetrieveAndDecrypt(client, cidString, decryptionConfig);
      } catch (err: any) {
        const errMsg = err?.message || String(err);
        errors.push({ gateway, error: errMsg });
        console.warn(
          `[vault:${WORKER_ID}] Gateway ${gateway} failed (attempt ${attempt}/${RETRIES_PER_GATEWAY}): ${errMsg.slice(0, 120)}`
        );

        // Don't delay after the last attempt on the last gateway
        const isLastGateway = gateway === allGateways[allGateways.length - 1];
        const isLastAttempt = attempt === RETRIES_PER_GATEWAY;
        if (!(isLastGateway && isLastAttempt)) {
          await sleep(RETRY_DELAY_MS);
        }
      }
    }
  }

  // All gateways exhausted
  const summary = errors.map(e => `  ${e.gateway}: ${e.error.slice(0, 100)}`).join('\n');
  throw new Error(
    `[vault:${WORKER_ID}] All gateways failed for CID ${cidString}:\n${summary}`
  );
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
