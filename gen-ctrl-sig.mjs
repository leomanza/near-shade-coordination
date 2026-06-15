import nacl from 'tweetnacl';
import bs58 from 'bs58';

const WORKER_DID = process.argv[2] || 'did:key:z6MkDeliberaTestCtrl1';
const NONCE = process.argv[3] || 'smoke-1';
const DOMAIN = Buffer.from('delibera.deactivate-worker.v1\x00');

// Same seed as in registry-contract/scripts/gen-test-keypair.mjs
const seed = Buffer.from('delibera-test-controller-seed-42'.padEnd(32, '\x00'));
const kp = nacl.sign.keyPair.fromSeed(seed);
const privKey = Buffer.from(kp.secretKey);

const msg = Buffer.concat([
  DOMAIN, Buffer.from(WORKER_DID, 'utf8'),
  Buffer.from([0]),
  Buffer.from(NONCE, 'utf8'),
]);
const sig = nacl.sign.detached(msg, privKey);

console.log(JSON.stringify({
  worker_did: WORKER_DID,
  nonce: NONCE,
  signature_b58: bs58.encode(sig),
  controller_pubkey_b58: bs58.encode(Buffer.from(kp.publicKey)),
}));
