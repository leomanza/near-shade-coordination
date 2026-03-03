/**
 * Storacha identity layer for the coordinator agent.
 *
 * Provides sovereign `did:key` identity via @storacha/client.
 * Uses the official server-side init pattern:
 *   Signer.parse(privateKey) → StoreMemory → Proof.parse(delegation) → client
 *
 * NOTE: @storacha/client is ESM-only. This CJS project uses dynamic import().
 * All public functions are async to support the lazy ESM import.
 *
 * Environment variables:
 *   STORACHA_AGENT_PRIVATE_KEY  — Ed25519 private key (from `storacha key create`)
 *   STORACHA_DELEGATION_PROOF   — Base64-encoded UCAN delegation CAR
 *   STORACHA_SPACE_DID           — (optional) Space DID for logging/verification
 */

// Cached instances
let _client: any = null;
let _signer: any = null;

// Lazy-loaded ESM modules
let _Client: typeof import('@storacha/client') | null = null;
let _Signer: typeof import('@storacha/client/principal/ed25519') | null = null;
let _Proof: typeof import('@storacha/client/proof') | null = null;
let _StoreMemory: any = null;

async function loadModules() {
  if (!_Client) {
    _Client = await import('@storacha/client');
    _Signer = await import('@storacha/client/principal/ed25519');
    _Proof = await import('@storacha/client/proof');
    const stores = await import('@storacha/client/stores/memory');
    _StoreMemory = stores.StoreMemory;
  }
}

/**
 * Check whether all required Storacha env vars are set.
 */
export function isStorachaConfigured(): boolean {
  return !!(
    process.env.STORACHA_AGENT_PRIVATE_KEY &&
    process.env.STORACHA_DELEGATION_PROOF
  );
}

/**
 * Parse the agent's Ed25519 signer from the private key env var.
 * The signer's DID (`did:key:z6Mk...`) is the agent's sovereign identity.
 */
async function getSigner() {
  if (!_signer) {
    await loadModules();
    const key = process.env.STORACHA_AGENT_PRIVATE_KEY;
    if (!key) {
      throw new Error(
        'STORACHA_AGENT_PRIVATE_KEY is not set. Run `storacha key create` to generate one.'
      );
    }
    _signer = _Signer!.Signer.parse(key);
  }
  return _signer;
}

/**
 * Get the agent's `did:key` identifier.
 * Works even without a delegation proof — only needs the private key.
 */
export async function getAgentDid(): Promise<string> {
  const signer = await getSigner();
  return signer.did();
}

/**
 * Create (or return cached) Storacha client with UCAN delegation.
 * Requires both STORACHA_AGENT_PRIVATE_KEY and STORACHA_DELEGATION_PROOF.
 */
export async function createStorachaClient() {
  if (_client) return _client;

  await loadModules();
  const signer = await getSigner();

  const delegationProof = process.env.STORACHA_DELEGATION_PROOF;
  if (!delegationProof) {
    throw new Error(
      'STORACHA_DELEGATION_PROOF is not set. Run `storacha delegation create <DID> --base64` to generate one.'
    );
  }

  const client = await _Client!.create({
    principal: signer,
    store: new _StoreMemory(),
  });

  const proof = await _Proof!.parse(delegationProof);
  const space = await client.addSpace(proof);
  await client.setCurrentSpace(space.did());

  console.log(`[storacha] Coordinator identity ready`);
  console.log(`[storacha]   Agent DID: ${signer.did()}`);
  console.log(`[storacha]   Space DID: ${space.did()}`);

  _client = client;
  return client;
}
