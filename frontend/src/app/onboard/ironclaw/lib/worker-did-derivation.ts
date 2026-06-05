/**
 * Derive a did:key worker DID from an outlayer-returned NEAR account id.
 *
 * Outlayer's `near_account_id` is the hex-encoded 32-byte ed25519 public key
 * that the TEE holds. To turn it into a W3C did:key, prepend the multicodec
 * ed25519-pub identifier (0xed 0x01), base58btc-encode, prepend "z".
 *
 * This matches the derivation used in the CLI autonomy demo
 * (doc/plans/skill-testing/10-outlayer-autonomy-demo.md step 2).
 *
 * No new runtime dep: base58btc encode is hand-rolled below using BigInt math.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const HEX_RE = /^[0-9a-f]+$/i;

function base58btcEncode(bytes: Uint8Array): string {
  // Standard Bitcoin base58 — preserves leading zero bytes as '1' chars.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;

  const ZERO = BigInt(0);
  const EIGHT = BigInt(8);
  const FIFTY_EIGHT = BigInt(58);
  let num = ZERO;
  for (const b of bytes) num = (num << EIGHT) + BigInt(b);

  let out = '';
  while (num > ZERO) {
    const rem = Number(num % FIFTY_EIGHT);
    num /= FIFTY_EIGHT;
    out = BASE58_ALPHABET[rem] + out;
  }

  return '1'.repeat(zeros) + out;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function workerDidFromNearAccount(nearAccountIdHex: string): string {
  if (!HEX_RE.test(nearAccountIdHex)) {
    throw new Error('near_account_id must be hex characters only');
  }
  const pubkey = hexToBytes(nearAccountIdHex);
  if (pubkey.length !== 32) {
    throw new Error(`near_account_id must decode to 32 bytes, got ${pubkey.length}`);
  }
  const multikey = new Uint8Array(34);
  multikey[0] = 0xed;
  multikey[1] = 0x01;
  multikey.set(pubkey, 2);
  return 'did:key:z' + base58btcEncode(multikey);
}

export function ed25519PubkeyFromNearAccount(nearAccountIdHex: string): string {
  if (!HEX_RE.test(nearAccountIdHex) || nearAccountIdHex.length !== 64) {
    throw new Error('invalid near_account_id');
  }
  return 'ed25519:' + base58btcEncode(hexToBytes(nearAccountIdHex));
}

/**
 * Same key as ed25519PubkeyFromNearAccount, but returns the raw base58 string
 * without the `ed25519:` prefix. This is the shape the registry contract's
 * `register_worker_with_controller(controller_pubkey: String)` argument expects
 * (it decodes base58 directly to a 32-byte array; no prefix).
 *
 * Used by the wizard so future-registered workers are deactivatable via the
 * V3.1.1 `deactivate_worker_by_controller` path (signed by the same TEE key
 * outlayer custodies for the worker).
 */
export function controllerPubkeyBase58FromNearAccount(nearAccountIdHex: string): string {
  if (!HEX_RE.test(nearAccountIdHex) || nearAccountIdHex.length !== 64) {
    throw new Error('invalid near_account_id');
  }
  return base58btcEncode(hexToBytes(nearAccountIdHex));
}
