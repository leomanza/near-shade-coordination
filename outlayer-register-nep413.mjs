// /register WITHOUT seed field, using NEP-413 canonical signing.
import { readFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

const CRED_PATH = process.env.NEAR_CRED || `${process.env.HOME}/.near-credentials/testnet/agents-coordinator.testnet.json`;
const RECIPIENT = process.env.OUTLAYER_RECIPIENT || 'outlayer.fastnear.com';
const URL = 'https://api.outlayer.fastnear.com/register';

const cred = JSON.parse(readFileSync(CRED_PATH, 'utf8'));
const privKey = bs58.decode(cred.private_key.replace(/^ed25519:/, ''));
const pubB58 = cred.public_key.replace(/^ed25519:/, '');

const ts = Math.floor(Date.now() / 1000);
const message = `register:${ts}`;
const nonce = randomBytes(32);

// NEP-413 borsh payload: { tag: u32, message: string, nonce: [u8;32], recipient: string, callbackUrl: Option<String> }
function u32le(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; }
function bstr(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u32le(b.length), b]); }
const TAG = 2147484061;
const payload = Buffer.concat([
  u32le(TAG),
  bstr(message),
  Buffer.from(nonce),
  bstr(RECIPIENT),
  Buffer.from([0]),               // Option<String>::None
]);

const digest = createHash('sha256').update(payload).digest();
const sig = nacl.sign.detached(digest, privKey);
const sigB64 = Buffer.from(sig).toString('base64');
const sigB58 = bs58.encode(sig);

const body = {
  account_id: cred.account_id,
  pubkey: `ed25519:${pubB58}`,
  message,
  signature: sigB58,        // try base58 first, can rerun with base64 if rejected
  nonce: Buffer.from(nonce).toString('base64'),
  recipient: RECIPIENT,
};

console.error('=== Variant 1: bs58 sig + nonce/recipient in body ===');
console.error('payload (raw signed = sha256 of NEP-413 borsh):', JSON.stringify(body, null, 2));
let res = await fetch(URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
console.error(`STATUS: ${res.status}`);
console.error('BODY:', await res.text());

console.error('\n=== Variant 2: base64 sig ===');
const b2 = { ...body, signature: sigB64 };
res = await fetch(URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(b2) });
console.error(`STATUS: ${res.status}`);
console.error('BODY:', await res.text());

console.error('\n=== Variant 3: ed25519:<b58> prefix ===');
const b3 = { ...body, signature: `ed25519:${sigB58}` };
res = await fetch(URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(b3) });
console.error(`STATUS: ${res.status}`);
console.error('BODY:', await res.text());

console.error('\n=== Variant 4: omit nonce + recipient (let server use defaults) ===');
const b4 = { account_id: cred.account_id, pubkey: `ed25519:${pubB58}`, message, signature: sigB58 };
res = await fetch(URL, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(b4) });
console.error(`STATUS: ${res.status}`);
console.error('BODY:', await res.text());
