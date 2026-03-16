/**
 * Shared DID utility for Delibera agents.
 *
 * Derives `did:key` from a Storacha Ed25519 private key.
 * Both coordinator and worker agents use this to get their sovereign identity.
 *
 * NOTE: @storacha/client is ESM-only. All functions are async to support
 * the dynamic import() pattern required in CJS packages.
 *
 * Usage:
 *   const did = await deriveDidFromPrivateKey(process.env.STORACHA_AGENT_PRIVATE_KEY!)
 */

// Lazy-loaded ESM module (dynamic import to avoid CJS/ESM conflict)
// @storacha/client is not a dependency of shared package — use 'any' type
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _Signer: any = null;

// Use indirect dynamic import to prevent tsc from compiling import() to require().
// @storacha/client is ESM-only; require() fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
const dynamicImport = new Function('specifier', 'return import(specifier)');

async function loadSigner(): Promise<any> {
  if (!_Signer) {
    _Signer = await dynamicImport('@storacha/client/principal/ed25519');
  }
  return _Signer;
}

/**
 * Derive a `did:key` identifier from a Storacha Ed25519 private key string.
 * The private key is the format produced by `storacha key create`.
 */
export async function deriveDidFromPrivateKey(privateKey: string): Promise<string> {
  const Signer = await loadSigner();
  const signer = Signer.Signer.parse(privateKey);
  return signer.did();
}

// ─── Coordinator DID cache ───────────────────────────────────────────────────

let _coordinatorDID: string | null = null;

/**
 * Get the coordinator's `did:key` from env, with caching.
 * Reads STORACHA_AGENT_PRIVATE_KEY (coordinator uses this var name).
 * Call once on startup; subsequent calls return cached value.
 */
export async function getCoordinatorDID(): Promise<string> {
  if (_coordinatorDID) return _coordinatorDID;
  const key = process.env.STORACHA_AGENT_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      'STORACHA_AGENT_PRIVATE_KEY is not set — cannot derive coordinator DID'
    );
  }
  _coordinatorDID = await deriveDidFromPrivateKey(key);
  return _coordinatorDID;
}

/**
 * Reset the coordinator DID cache (for testing).
 */
export function resetCoordinatorDIDCache(): void {
  _coordinatorDID = null;
}
