/**
 * Demo all-in-one: start_coordination + finalize within the yield window.
 *
 * Uses near-api-js for start_coordination (returns fast with waitUntil:Final wrapped
 * in a Promise — the function-call receipt waits for yield, but we read the
 * proposal_id from logs as soon as it appears, then immediately call the finalize
 * methods via delibera-client (signed by coord-agent's derived account, which is
 * the registered coordinator with approved codehash).
 *
 * Critical: workers must have ALREADY written their votes to Ensue before this
 * runs (pre-warm pattern). This script does NOT dispatch workers.
 */
import 'dotenv/config';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.development.local' });
import { connect, keyStores, KeyPair } from 'near-api-js';
import { Account } from 'near-api-js';
import fs from 'node:fs';
import crypto from 'crypto';

const NETWORK_ID = process.env.NEAR_NETWORK || 'testnet';
const COORDINATOR_CONTRACT = process.env.NEXT_PUBLIC_contractId || 'coordinator.agents-coordinator.testnet';
const REGISTRY_CONTRACT = process.env.REGISTRY_CONTRACT_ID || 'registry.agents-coordinator.testnet';
const NEAR_RPC = process.env.NEAR_RPC_JSON || 'https://test.rpc.fastnear.com';
const ENSUE_API_KEY = process.env.ENSUE_API_KEY;
const ENSUE_ORG = process.env.ENSUE_COORDINATOR_ORG || 'socialcap';

const TASK_CONFIG = process.argv[2];
if (!TASK_CONFIG) {
  console.error('Usage: node demo-full-finalize.mjs \'<task_config_json>\'');
  process.exit(1);
}

// 1. Load TWO accounts:
//    - coord-factory: for start_coordination (the proposal originator)
//    - agents-coordinator.testnet (owner): for record_worker_submissions + coordinator_resume
//      (only the owner is a registered coordinator with approved codehash per the
//       coordinator contract's owner-only register_coordinator design)
const cfCreds = JSON.parse(fs.readFileSync(`${process.env.HOME}/.near-credentials/testnet/coord-factory.agents-coordinator.testnet.json`, 'utf8'));
const ownerCreds = JSON.parse(fs.readFileSync(`${process.env.HOME}/.near-credentials/testnet/agents-coordinator.testnet.json`, 'utf8'));
const keyStore = new keyStores.InMemoryKeyStore();
await keyStore.setKey(NETWORK_ID, cfCreds.account_id, KeyPair.fromString(cfCreds.private_key));
await keyStore.setKey(NETWORK_ID, ownerCreds.account_id, KeyPair.fromString(ownerCreds.private_key));
const near = await connect({ networkId: NETWORK_ID, keyStore, nodeUrl: NEAR_RPC });
const account = await near.account(cfCreds.account_id);  // for start_coordination
const ownerAccount = await near.account(ownerCreds.account_id);  // for finalize

// 2. Read active demo workers' DIDs
async function nearView(contract, method, args = {}) {
  const res = await fetch(NEAR_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: '1', method: 'query',
      params: {
        request_type: 'call_function', finality: 'final',
        account_id: contract, method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      },
    }),
  });
  const data = await res.json();
  if (data.error || data.result?.error) throw new Error(`view ${method} error: ${JSON.stringify(data.error || data.result.error)}`);
  return JSON.parse(Buffer.from(data.result.result).toString());
}

const workers = await nearView(REGISTRY_CONTRACT, 'list_active_workers', {});
// Default filter: push workers (ironclaw-demo-*) AND polling workers
// (external-polling) — mixed-mode finalization. F35 polling proxy is now
// SHIPPED + verified in prod (2026-05-30), so polling workers vote via
// POST /api/coordinate/poll/vote/:did and finalize alongside push workers.
// WORKER_FILTER env var overrides the default for single-worker testing
// (accepts exact worker_did, exact cvm_id, or cvm_id prefix).
const WORKER_FILTER = process.env.WORKER_FILTER;
const demoWorkers = workers.filter(w => {
  if (WORKER_FILTER) {
    return w.worker_did === WORKER_FILTER || w.cvm_id === WORKER_FILTER || (w.cvm_id?.startsWith(WORKER_FILTER) ?? false);
  }
  return (w.cvm_id?.startsWith('ironclaw-demo-') ?? false) || w.cvm_id === 'external-polling';
});
console.log(`Active demo workers: ${demoWorkers.length}`);
for (const w of demoWorkers) console.log(`  ${w.cvm_id} (${w.worker_did})`);

// 3. Pre-read votes from Ensue
async function ensueGet(keys) {
  const res = await fetch(`https://api.ensue-network.ai/?organization=${ENSUE_ORG}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ENSUE_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_memory', arguments: { key_names: keys } } }),
  });
  const text = await res.text();
  const matches = text.match(/^data: (\{.*\})$/m);
  if (!matches) throw new Error('Ensue response parse failed: ' + text.slice(0, 200));
  return JSON.parse(matches[1]).result?.structuredContent?.results || [];
}

const resultKeys = demoWorkers.map(w => `coordination/tasks/${w.worker_did}/result`);
const ensueResults = await ensueGet(resultKeys);
const votesByDid = {};
for (const r of ensueResults) {
  if (r.status !== 'success' || !r.value) continue;
  const m = r.key_name.match(/coordination\/tasks\/(.+)\/result/);
  if (!m) continue;
  votesByDid[m[1]] = r.value;
}
console.log(`Pre-warmed votes: ${Object.keys(votesByDid).length}/${demoWorkers.length}`);
for (const [did, v] of Object.entries(votesByDid)) {
  try { const p = JSON.parse(v); console.log(`  ${did.slice(-10)}: ${p.option}`); } catch {}
}
if (Object.keys(votesByDid).length !== demoWorkers.length) {
  console.error('Missing some votes — pre-warm not complete. Aborting.');
  process.exit(1);
}

// 4. Compute submissions + aggregated_result + hashes
const submissions = demoWorkers.map(w => ({
  worker_id: w.worker_did,
  result_hash: crypto.createHash('sha256').update(votesByDid[w.worker_did]).digest('hex'),
}));
const counts = {};
for (const did of Object.keys(votesByDid)) {
  try { const p = JSON.parse(votesByDid[did]); counts[p.option] = (counts[p.option] || 0) + 1; } catch {}
}
const aggregated_result = JSON.stringify({ tally: counts, total: submissions.length });
const result_hash = crypto.createHash('sha256').update(aggregated_result).digest('hex');
console.log('Aggregated:', aggregated_result);

// 5. Fire start_coordination — DON'T wait for full final, use EXECUTED_OPTIMISTIC
console.log('\n--- start_coordination ---');
const t0 = Date.now();
let proposalId;
let scResolved = false;
const scPromise = account.functionCall({
  contractId: COORDINATOR_CONTRACT,
  methodName: 'start_coordination',
  args: { task_config: TASK_CONFIG, expected_worker_count: demoWorkers.length, quorum: Math.ceil(demoWorkers.length * 2 / 3) },
  gas: BigInt('300000000000000'),
  attachedDeposit: 0n,
  // Default waitUntil is 'EXECUTED_OPTIMISTIC' since near-api-js v4+
}).then(outcome => {
  scResolved = true;
  console.log(`start_coordination tx finalized at +${Date.now() - t0}ms`);
}).catch(err => {
  scResolved = true;
  console.log(`start_coordination tx error at +${Date.now() - t0}ms:`, err.message?.slice(0, 200));
});

// 6. Poll for the new proposal in Created state (it appears on-chain immediately even though tx hasn't finalized)
console.log('Polling for new proposal in Created state...');
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 1000));
  try {
    const proposals = await nearView(COORDINATOR_CONTRACT, 'get_proposals_by_state', { state: 'Created', from_index: 0, limit: 5 });
    if (proposals && proposals.length > 0) {
      // Sort by proposal_id desc, take highest (most recent)
      proposals.sort((a, b) => b[0] - a[0]);
      proposalId = proposals[0][0];
      console.log(`Found Created proposal: #${proposalId} at +${Date.now() - t0}ms`);
      break;
    }
  } catch (e) {
    // Sometimes the contract method is named differently; try get_pending_coordinations
    try {
      const pending = await nearView(COORDINATOR_CONTRACT, 'get_pending_coordinations', {});
      if (pending && pending.length > 0) {
        pending.sort((a, b) => b[0] - a[0]);
        proposalId = pending[0][0];
        console.log(`Found pending proposal: #${proposalId} at +${Date.now() - t0}ms`);
        break;
      }
    } catch {}
  }
}
if (!proposalId) {
  console.error('Could not find new proposal in Created state within 30s. Aborting.');
  process.exit(1);
}

const proposal = await nearView(COORDINATOR_CONTRACT, 'get_proposal', { proposal_id: proposalId });
console.log(`Proposal #${proposalId}: state=${proposal.state}, config_hash=${proposal.config_hash}`);

// 7. Use OWNER account directly (registered as coordinator with approved codehash)
//    coordinator-contract's register_coordinator is owner-only self-registration,
//    so only the owner is in coordinator_by_account_id with approved codehash.
console.log(`\n--- finalize signer: ${ownerAccount.accountId} (owner-as-coordinator) ---`);

async function coordCall(methodName, args) {
  const outcome = await ownerAccount.functionCall({
    contractId: COORDINATOR_CONTRACT,
    methodName,
    args,
    gas: BigInt('200000000000000'),
    attachedDeposit: 0n,
  });
  return outcome;
}

// 8. Call record_worker_submissions
console.log('\n--- record_worker_submissions ---');
await coordCall('record_worker_submissions', { proposal_id: proposalId, submissions });
console.log(`✓ submissions recorded at +${Date.now() - t0}ms`);

// 9. Call coordinator_resume
console.log('\n--- coordinator_resume ---');
await coordCall('coordinator_resume', {
  proposal_id: proposalId,
  aggregated_result,
  config_hash: proposal.config_hash,
  result_hash,
});
console.log(`✓ coordinator_resume called at +${Date.now() - t0}ms`);

// 10. Wait for start_coordination tx to finalize (yield should now resume since we called coordinator_resume)
console.log('\n--- waiting for start_coordination tx to finalize after yield resume ---');
await scPromise;

// 11. Verify on-chain Finalized state — retry to absorb FastNEAR finality
// propagation lag. The yield-resume receipt may land before the read replica
// reflects the new state; ~1s is usually enough, give it up to 6s of retries.
let final;
for (let i = 0; i < 6; i++) {
  final = await nearView(COORDINATOR_CONTRACT, 'get_proposal', { proposal_id: proposalId });
  if (final.state === 'Finalized') break;
  if (i < 5) await new Promise(r => setTimeout(r, 1000));
}
console.log(`\nFinal state: ${final.state}`);
console.log(`Finalized result: ${final.finalized_result}`);
console.log(`Total elapsed: ${Date.now() - t0}ms`);

if (final.state === 'Finalized') {
  console.log('\n🎯 LIVE FINALIZATION SUCCESS');
  process.exit(0);
} else {
  console.error('\n❌ Did not reach Finalized state after 6s of retries — check explorer for actual state');
  process.exit(1);
}
