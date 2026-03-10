/**
 * Local AES-256-GCM encryption using a key derived from the agent's Storacha private key.
 *
 * Used to encrypt data stored in Ensue (which is not encrypted natively).
 * This keeps agent memory private at rest without relying on external services.
 *
 * Key derivation: HMAC-SHA256(STORACHA_AGENT_PRIVATE_KEY, "delibera-ensue-cache-v1")
 * No new dependencies — uses Node.js built-in `crypto.subtle`.
 */

import { createHmac, webcrypto } from 'crypto';

const { subtle } = webcrypto;
type AESKey = ReturnType<typeof subtle.importKey> extends Promise<infer K> ? K : never;

const CONTEXT = 'delibera-ensue-cache-v1';
const ENC_PREFIX = 'aes256gcm:'; // marks encrypted values stored in Ensue

let _keyPromise: Promise<AESKey> | null = null;

/**
 * Derive an AES-256-GCM CryptoKey from STORACHA_AGENT_PRIVATE_KEY.
 * Returns null if the env var is not set (LOCAL_MODE without Storacha).
 */
export async function getAESKey(): Promise<AESKey | null> {
  const rawKey = process.env.STORACHA_AGENT_PRIVATE_KEY;
  if (!rawKey) return null;

  if (!_keyPromise) {
    _keyPromise = (async () => {
      // Decode the base64 or hex private key to bytes
      let keyBytes: Buffer;
      try {
        keyBytes = Buffer.from(rawKey, 'base64');
        if (keyBytes.length < 16) throw new Error('too short');
      } catch {
        keyBytes = Buffer.from(rawKey, 'hex');
      }

      // HMAC-SHA256 as KDF: produce a 32-byte AES key
      const aesKeyBytes = createHmac('sha256', keyBytes)
        .update(CONTEXT)
        .digest();

      return subtle.importKey(
        'raw',
        aesKeyBytes,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    })();
  }
  return _keyPromise;
}

/**
 * Encrypt a JSON-serializable value with AES-256-GCM.
 * Returns a prefixed base64 string suitable for Ensue storage.
 */
export async function encryptForEnsue(data: unknown): Promise<string> {
  const key = await getAESKey();
  if (!key) {
    // No key configured — store as plain JSON (LOCAL_MODE fallback)
    return JSON.stringify(data);
  }

  const iv = webcrypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
  const plaintext = Buffer.from(JSON.stringify(data), 'utf8');
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  // Format: prefix + base64(iv || ciphertext)
  const combined = Buffer.concat([Buffer.from(iv), Buffer.from(ciphertext)]);
  return ENC_PREFIX + combined.toString('base64');
}

/**
 * Decrypt a value encrypted by `encryptForEnsue`.
 * Returns null if the value is missing, unparseable, or decryption fails.
 */
export async function decryptFromEnsue(stored: string | null | undefined): Promise<unknown | null> {
  if (!stored) return null;

  // Plain JSON fallback (no prefix, LOCAL_MODE or old plaintext cache entries)
  if (!stored.startsWith(ENC_PREFIX)) {
    if (stored.startsWith('baf')) return null; // bare CID — skip
    try { return JSON.parse(stored); } catch { return null; }
  }

  const key = await getAESKey();
  if (!key) return null;

  try {
    const combined = Buffer.from(stored.slice(ENC_PREFIX.length), 'base64');
    const iv = combined.subarray(0, 12);
    const ciphertext = combined.subarray(12);
    const plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    return JSON.parse(Buffer.from(plaintext).toString('utf8'));
  } catch (e) {
    console.warn('[local-crypto] AES decryption failed:', e);
    return null;
  }
}

/** Returns true if the stored string is an AES-encrypted blob. */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(ENC_PREFIX);
}
