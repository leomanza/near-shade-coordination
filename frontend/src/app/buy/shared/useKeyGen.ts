"use client";

import { useState, useCallback } from "react";

export interface GeneratedKey {
  did: string;
  privateKeyBase64: string;
}

/**
 * Client-side Ed25519 keypair generation using Web Crypto API.
 * Returns a did:key DID and base64-encoded private key.
 * NOTE: For the current buy flow, key generation is done server-side during provisioning.
 * This hook is reserved for future client-side key generation flows.
 */
export function useKeyGen() {
  const [key, setKey] = useState<GeneratedKey | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const keyPair = await crypto.subtle.generateKey(
        { name: "Ed25519" },
        true,
        ["sign", "verify"]
      );

      // Export private key
      const privateKeyBytes = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
      const privateKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(privateKeyBytes)));

      // Export public key to derive DID
      const publicKeyBytes = await crypto.subtle.exportKey("raw", keyPair.publicKey);
      const pubKeyArray = new Uint8Array(publicKeyBytes);

      // Encode as did:key using multibase + multicodec (ed25519-pub = 0xed01)
      const multicodec = new Uint8Array([0xed, 0x01, ...pubKeyArray]);
      // Base58btc encode with 'z' prefix
      const did = `did:key:z${base58btcEncode(multicodec)}`;

      const result: GeneratedKey = { did, privateKeyBase64 };
      setKey(result);
      return result;
    } catch (err: any) {
      setError(err?.message || "Key generation failed");
      return null;
    } finally {
      setGenerating(false);
    }
  }, []);

  return { key, generating, error, generate };
}

// Minimal base58btc encoder (Bitcoin alphabet)
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58btcEncode(bytes: Uint8Array): string {
  let num = BigInt(0);
  for (const byte of bytes) {
    num = num * BigInt(256) + BigInt(byte);
  }
  let encoded = "";
  while (num > BigInt(0)) {
    const remainder = Number(num % BigInt(58));
    encoded = BASE58_ALPHABET[remainder] + encoded;
    num = num / BigInt(58);
  }
  // Add leading '1's for leading zero bytes
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = "1" + encoded;
  }
  return encoded;
}
