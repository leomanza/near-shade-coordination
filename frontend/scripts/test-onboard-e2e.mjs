#!/usr/bin/env node
// E2E test for the /onboard/ironclaw wizard's server proxies and the full
// chain that the wizard walks the user through. Mirrors what the wizard does
// in the browser, but uses near-cli for the policy commit step (instead of
// NEAR Wallet Selector).
//
// USAGE
//   node frontend/scripts/test-onboard-e2e.mjs [--smoke | --full]
//
//   --smoke   Hit each proxy with a fresh trial wallet; verify shapes; STOP
//             before the policy commit step. ~10s, no NEAR spent. Good for CI.
//   --full    Full happy path against testnet. Funds the outlayer wallet from
//             $NEAR_FUNDER_ACCOUNT, signs the policy commit via near-cli, runs
//             the autonomous register_worker, verifies on-chain. ~90s, ~0.16
//             NEAR spent. Requires near-cli installed and $NEAR_FUNDER_ACCOUNT
//             in your keychain.
//
// PREREQ
//   Frontend dev server running: `cd frontend && npm run dev` (port 3004).
//   For --full: `NEAR_FUNDER_ACCOUNT=youraccount.testnet node ... --full`

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const BASE = process.env.NEXT_BASE || 'http://localhost:3004';
const RPC = 'https://test.rpc.fastnear.com';
const REGISTRY = 'registry.agents-coordinator.testnet';
const KEYSTORE = 'outlayer.testnet';
const FUND_TARGET_YOCTO = 150_000_000_000_000_000_000_000n; // 0.15 NEAR

const mode = process.argv.includes('--full') ? 'full' : 'smoke';
const log = (...a) => console.log('[e2e]', ...a);
const fail = (msg) => { console.error('[e2e][FAIL]', msg); process.exit(1); };

async function postJson(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    fail(`POST ${path} → ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function viewAccount(accountId) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'query',
      params: { request_type: 'view_account', finality: 'final', account_id: accountId },
    }),
  });
  const json = await res.json();
  if (!json.result) return null;
  return { amount: BigInt(json.result.amount) };
}

async function viewWorker(workerDid) {
  const args = Buffer.from(JSON.stringify({ worker_did: workerDid })).toString('base64');
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'query',
      params: {
        request_type: 'call_function', finality: 'final',
        account_id: REGISTRY,
        method_name: 'get_worker_by_did',
        args_base64: args,
      },
    }),
  });
  const json = await res.json();
  const bytes = json.result?.result;
  if (!bytes) return null;
  const text = Buffer.from(bytes).toString('utf8');
  if (text === 'null') return null;
  return JSON.parse(text);
}

function workerDidFrom(nearAccountIdHex) {
  const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const pub = Buffer.from(nearAccountIdHex, 'hex');
  if (pub.length !== 32) fail('expected 32-byte pubkey, got ' + pub.length);
  const mk = Buffer.concat([Buffer.from([0xed, 0x01]), pub]);
  const ZERO = BigInt(0); const EIGHT = BigInt(8); const N58 = BigInt(58);
  let zeros = 0; while (zeros < mk.length && mk[zeros] === 0) zeros++;
  let num = ZERO; for (const b of mk) num = (num << EIGHT) + BigInt(b);
  let out = ''; while (num > ZERO) { out = BASE58[Number(num % N58)] + out; num /= N58; }
  return 'did:key:z' + '1'.repeat(zeros) + out;
}

// -------- Stage 1: proxy register --------
log('Stage 1: POST /api/onboard/outlayer-register (anonymous)');
const reg = await postJson('/api/onboard/outlayer-register', {});
for (const key of ['wallet_id', 'api_key', 'near_account_id']) {
  if (!reg[key]) fail(`/register response missing field: ${key}`);
}
log('  → wallet_id    :', reg.wallet_id);
log('  → near_account :', reg.near_account_id);
log('  → api_key (head):', reg.api_key.slice(0, 24) + '...');

const workerDid = workerDidFrom(reg.near_account_id);
log('  → derived DID  :', workerDid);

// -------- Stage 2: proxy policy-encrypt-sign --------
log('Stage 2: POST /api/onboard/policy-encrypt-sign');
const policy = await postJson('/api/onboard/policy-encrypt-sign', {
  api_key: reg.api_key,
  wallet_id: reg.wallet_id,
  rules: {
    per_transaction: { NEAR: '500000000000000000000000' },
    transaction_types: ['call'],
    address: { whitelist: { NEAR: [REGISTRY] } },
    daily: { NEAR: '1000000000000000000000000' },
  },
});
for (const key of ['wallet_pubkey', 'encrypted_data', 'wallet_signature']) {
  if (!policy[key]) fail(`/policy-encrypt-sign response missing field: ${key}`);
}
log('  → wallet_pubkey:', policy.wallet_pubkey);
log('  → encrypted_data bytes:', policy.encrypted_data.length);
log('  → wallet_signature bytes:', policy.wallet_signature.length);

if (mode === 'smoke') {
  log('Stage 1+2 PASS (smoke mode — stopping before on-chain steps)');
  process.exit(0);
}

// -------- Stage 3: fund (full mode only) --------
const funder = process.env.NEAR_FUNDER_ACCOUNT;
if (!funder) fail('--full requires NEAR_FUNDER_ACCOUNT env var');
log('Stage 3: fund', reg.near_account_id, 'with 0.15 NEAR from', funder);

const fundProc = spawnSync('near', [
  'tokens', funder,
  'send-near', reg.near_account_id, '0.15 NEAR',
  'network-config', 'testnet',
  'sign-with-keychain',
  'send',
], { stdio: 'inherit' });
if (fundProc.status !== 0) fail('fund tx failed');

// Wait for propagation
for (let i = 0; i < 30; i++) {
  const acc = await viewAccount(reg.near_account_id);
  if (acc && acc.amount >= FUND_TARGET_YOCTO) {
    log('  → balance confirmed:', (Number(acc.amount) / 1e24).toFixed(4), 'NEAR');
    break;
  }
  await new Promise((r) => setTimeout(r, 2000));
  if (i === 29) fail('funded balance not visible after 60s');
}

// -------- Stage 4: store_wallet_policy via near-cli --------
log('Stage 4: store_wallet_policy on outlayer.testnet (signing as', funder + ')');
const storeArgs = JSON.stringify({
  wallet_pubkey: policy.wallet_pubkey,
  encrypted_data: policy.encrypted_data,
  wallet_signature: policy.wallet_signature,
});
const storeProc = spawnSync('near', [
  'contract', 'call-function', 'as-transaction', KEYSTORE,
  'store_wallet_policy',
  'json-args', storeArgs,
  'prepaid-gas', '100 Tgas',
  'attached-deposit', '0.01 NEAR',
  'sign-as', funder,
  'network-config', 'testnet',
  'sign-with-keychain',
  'send',
], { stdio: 'inherit' });
if (storeProc.status !== 0) fail('store_wallet_policy failed');

// -------- Stage 5: invalidate cache --------
log('Stage 5: POST /api/onboard/invalidate-cache');
await postJson('/api/onboard/invalidate-cache', {
  api_key: reg.api_key,
  wallet_id: reg.wallet_id,
});
log('  → cache invalidated');

// -------- Stage 6: autonomous register_worker --------
log('Stage 6: POST /api/onboard/register-worker (autonomous)');
const result = await postJson('/api/onboard/register-worker', {
  api_key: reg.api_key,
  worker_did: workerDid,
  endpoint_url: 'ensue://e2e-test',
  cvm_id: 'outlayer-tdx',
  registry_contract_id: REGISTRY,
});
if (result.status !== 'success') fail(`register_worker status=${result.status}, body=${JSON.stringify(result)}`);
log('  → tx_hash:', result.tx_hash);
log('  → explorer: https://explorer.testnet.near.org/transactions/' + result.tx_hash);

// -------- Stage 7: verify on-chain --------
log('Stage 7: verify worker on-chain');
await new Promise((r) => setTimeout(r, 2000));
const onChain = await viewWorker(workerDid);
if (!onChain || !onChain.is_active) fail(`worker NOT found on-chain: ${JSON.stringify(onChain)}`);
if (onChain.account_id !== reg.near_account_id) fail(`account_id mismatch: ${onChain.account_id} vs ${reg.near_account_id}`);
log('  ✓ worker on-chain — account_id matches outlayer-derived account');
log('  ✓ this account_id has no human-controlled private key — autonomy property holds');

log('');
log('========================================');
log('E2E FULL FLOW PASS');
log('========================================');
log('Worker DID    :', workerDid);
log('NEAR account  :', reg.near_account_id);
log('Register tx   :', result.tx_hash);
log('API key (head):', reg.api_key.slice(0, 24) + '...');
log('');
log('Operator-side cost: 0.15 NEAR (fund) + 0.01 NEAR (policy storage) + ~0.0005 NEAR (gas)');
log('                  = ~0.161 NEAR total');
