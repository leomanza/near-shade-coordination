#!/usr/bin/env node
/**
 * Deploy Delibera NEAR contracts (registry + coordinator) to testnet.
 * Usage:
 *   node scripts/deploy-contracts.mjs [--registry-only] [--coordinator-only]
 *   NEAR_SEED_PHRASE="..." NEAR_ACCOUNT_ID="..." node scripts/deploy-contracts.mjs
 *
 * Reads env from coordinator-agent/.env.development.local if not set.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load env file
function loadEnv() {
  const envFile = join(ROOT, 'coordinator-agent', '.env.development.local');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

const { connect, keyStores, KeyPair } = await import('near-api-js');
const { parseSeedPhrase } = await import('near-seed-phrase');

const NEAR_RPC = 'https://test.rpc.fastnear.com';
const NEAR_NETWORK = 'testnet';
const MASTER_ACCOUNT = process.env.NEAR_ACCOUNT_ID || 'agents-coordinator.testnet';
const SEED_PHRASE = process.env.NEAR_SEED_PHRASE;

if (!SEED_PHRASE) {
  console.error('Error: NEAR_SEED_PHRASE is required');
  process.exit(1);
}

const args = process.argv.slice(2);
const registryOnly = args.includes('--registry-only');
const coordinatorOnly = args.includes('--coordinator-only');
const doRegistry = !coordinatorOnly;
const doCoordinator = !registryOnly;

// Set up NEAR connection
const { secretKey } = parseSeedPhrase(SEED_PHRASE);
const keyStore = new keyStores.InMemoryKeyStore();
const keyPair = KeyPair.fromString(secretKey);
await keyStore.setKey(NEAR_NETWORK, MASTER_ACCOUNT, keyPair);

const near = await connect({ networkId: NEAR_NETWORK, keyStore, nodeUrl: NEAR_RPC });
const masterAccount = await near.account(MASTER_ACCOUNT);

async function viewCall(contractId, methodName, args = {}) {
  const res = await fetch(NEAR_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: '1',
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contractId,
        method_name: methodName,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      },
    }),
  });
  const data = await res.json();
  if (data.error || !data.result?.result) return null;
  const bytes = new Uint8Array(data.result.result);
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function deployContract(contractAccount, wasmPath, initMethod, initArgs) {
  const wasm = readFileSync(wasmPath);
  console.log(`  Deploying WASM (${(wasm.length / 1024).toFixed(0)}KB)...`);

  const outcome = await masterAccount.deployContract(wasm);
  console.log(`  Deployed: txHash=${outcome.transaction?.hash ?? 'unknown'}`);

  if (initMethod) {
    console.log(`  Calling ${initMethod}...`);
    const account = await near.account(contractAccount);
    try {
      await account.functionCall({
        contractId: contractAccount,
        methodName: initMethod,
        args: initArgs,
        gas: BigInt('300000000000000'),
        attachedDeposit: BigInt('0'),
      });
      console.log(`  Initialized.`);
    } catch (e) {
      console.warn(`  Init failed (may already be initialized):`, e.message?.substring(0, 200));
    }
  }
}

// ─── Deploy Registry ──────────────────────────────────────────────────────────
if (doRegistry) {
  const REGISTRY_ID = 'registry.agents-coordinator.testnet';
  const REGISTRY_WASM = join(ROOT, 'registry-contract/target/near/registry_contract.wasm');

  console.log(`\n=== Deploying Registry Contract ===`);
  console.log(`  Account: ${REGISTRY_ID}`);
  console.log(`  WASM:    ${REGISTRY_WASM}`);

  // Switch key to registry account (uses same key as master)
  await keyStore.setKey(NEAR_NETWORK, REGISTRY_ID, keyPair);
  const registryAccount = await near.account(REGISTRY_ID);

  const wasm = readFileSync(REGISTRY_WASM);
  console.log(`  Deploying WASM (${(wasm.length / 1024).toFixed(0)}KB)...`);
  try {
    await registryAccount.deployContract(wasm);
    console.log(`  WASM deployed.`);
  } catch (e) {
    console.error(`  Deploy failed:`, e.message);
    if (!registryOnly) console.log('  Continuing with coordinator...');
  }

  // Initialize (fresh deploy — no migration needed per plan)
  console.log(`  Initializing registry...`);
  try {
    await registryAccount.functionCall({
      contractId: REGISTRY_ID,
      methodName: 'new',
      args: { admin: MASTER_ACCOUNT },
      gas: BigInt('300000000000000'),
      attachedDeposit: BigInt('0'),
    });
    console.log(`  Registry initialized with admin: ${MASTER_ACCOUNT}`);
  } catch (e) {
    const msg = e.message || '';
    if (msg.includes('already initialized') || msg.includes('Contract already initialized')) {
      console.log(`  Already initialized — checking state...`);
    } else {
      console.warn(`  Init failed:`, msg.substring(0, 200));
    }
  }

  // Verify
  try {
    const activeWorkers = await viewCall(REGISTRY_ID, 'list_active_workers');
    console.log(`  Registry active workers: ${activeWorkers?.length ?? 0}`);
    const activeCoors = await viewCall(REGISTRY_ID, 'list_active_coordinators');
    console.log(`  Registry active coordinators: ${activeCoors?.length ?? 0}`);
    console.log(`  Registry contract OK.`);
  } catch (e) {
    console.warn(`  Verification failed:`, e.message);
  }
}

// ─── Deploy Coordinator ───────────────────────────────────────────────────────
if (doCoordinator) {
  const COORDINATOR_ID = 'coordinator.agents-coordinator.testnet';
  const COORDINATOR_WASM = join(ROOT, 'coordinator-contract/target/near/coordinator_contract.wasm');

  console.log(`\n=== Deploying Coordinator Contract ===`);
  console.log(`  Account: ${COORDINATOR_ID}`);
  console.log(`  WASM:    ${COORDINATOR_WASM}`);

  await keyStore.setKey(NEAR_NETWORK, COORDINATOR_ID, keyPair);
  const coordAccount = await near.account(COORDINATOR_ID);

  const wasm = readFileSync(COORDINATOR_WASM);
  console.log(`  Deploying WASM (${(wasm.length / 1024).toFixed(0)}KB)...`);
  try {
    await coordAccount.deployContract(wasm);
    console.log(`  WASM deployed.`);
  } catch (e) {
    console.error(`  Deploy failed:`, e.message);
    process.exit(1);
  }

  // Check current proposal count (to preserve it in force_migrate)
  let currentProposalId = 0;
  try {
    const proposal = await viewCall(COORDINATOR_ID, 'get_current_proposal_id', {});
    currentProposalId = proposal ?? 0;
    console.log(`  Current proposal ID: ${currentProposalId}`);
  } catch {}

  // Use force_migrate to reinitialize with new state shape
  // This preserves existing IterableMap data at same storage prefixes
  console.log(`  Calling force_migrate(owner=${MASTER_ACCOUNT}, current_proposal_id=${currentProposalId})...`);
  try {
    await coordAccount.functionCall({
      contractId: COORDINATOR_ID,
      methodName: 'force_migrate',
      args: { owner: MASTER_ACCOUNT, current_proposal_id: currentProposalId },
      gas: BigInt('300000000000000'),
      attachedDeposit: BigInt('0'),
    });
    console.log(`  force_migrate complete.`);
  } catch (e) {
    const msg = e.message || '';
    console.warn(`  force_migrate warning:`, msg.substring(0, 300));
  }

  // Verify
  try {
    const pid = await viewCall(COORDINATOR_ID, 'get_current_proposal_id', {});
    console.log(`  Coordinator current_proposal_id: ${pid}`);
    const manifesto = await viewCall(COORDINATOR_ID, 'get_manifesto', {});
    console.log(`  Coordinator manifesto: ${manifesto ? 'set' : 'not set'}`);
    console.log(`  Coordinator contract OK.`);
  } catch (e) {
    console.warn(`  Verification failed:`, e.message);
  }
}

console.log('\n=== Deployment complete ===\n');
