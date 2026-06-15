// One-shot script: claim an owned outlayer wallet via /register ceremony.
// Reads NEAR credentials, signs `register:<seed>:<unix_ts>` with raw ed25519,
// POSTs to outlayer, prints response. TESTNET only.

import { readFileSync } from 'node:fs';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const CRED_PATH = process.env.NEAR_CRED || `${process.env.HOME}/.near-credentials/testnet/agents-coordinator.testnet.json`;
const SEED = process.env.OUTLAYER_SEED || 'delibera-w1-demo-' + Date.now();
const OUTLAYER_URL = 'https://api.outlayer.fastnear.com/register';

const cred = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
const account_id = cred.account_id;

// NEAR private keys are encoded as `ed25519:<base58(64-byte expanded key)>`.
// The 64 bytes = seed(32) || pubkey(32). tweetnacl.sign uses this 64-byte form directly.
const privB58 = cred.private_key.replace(/^ed25519:/, '');
const privKey = bs58.decode(privB58);
if (privKey.length !== 64) throw new Error(`expected 64-byte private key, got ${privKey.length}`);

const pubB58 = cred.public_key.replace(/^ed25519:/, '');
const pubKey = bs58.decode(pubB58);
if (pubKey.length !== 32) throw new Error(`expected 32-byte pubkey, got ${pubKey.length}`);

const ts = Math.floor(Date.now() / 1000);
const message = `register:${SEED}:${ts}`;
const msgBytes = new TextEncoder().encode(message);

// Raw ed25519 detached signature (what tweetnacl.sign.detached does)
const sig = nacl.sign.detached(msgBytes, privKey);
const sigB58 = bs58.encode(sig);

const payload = {
  account_id,
  seed: SEED,
  pubkey: `ed25519:${pubB58}`,
  message,
  signature: sigB58,
};

console.error('REQUEST PAYLOAD:', JSON.stringify(payload, null, 2));
console.error('---');

const res = await fetch(OUTLAYER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

const body = await res.text();
console.error(`STATUS: ${res.status}`);
console.error('BODY:', body);
