/**
 * Deploy Delibera NEAR contracts (registry + coordinator) to testnet.
 * Usage (from coordinator-agent dir):
 *   npx tsx -r dotenv/config ../scripts/deploy-contracts.ts [--registry-only] [--coordinator-only]
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import * as nearApi from 'near-api-js';
import { parseSeedPhrase } from 'near-seed-phrase';

const ROOT = join(__dirname, '../..');
const NEAR_RPC = 'https://test.rpc.fastnear.com';
const NEAR_NETWORK = 'testnet';

async function viewCall<T>(contractId: string, methodName: string, args: Record<string, unknown> = {}): Promise<T | null> {
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
  const data = await res.json() as any;
  if (data.error || !data.result?.result) return null;
  const bytes = new Uint8Array(data.result.result);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

async function main() {
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
  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  const keyPair = nearApi.KeyPair.fromString(secretKey as any);
  await keyStore.setKey(NEAR_NETWORK, MASTER_ACCOUNT, keyPair);

  const near = await nearApi.connect({ networkId: NEAR_NETWORK, keyStore, nodeUrl: NEAR_RPC });

  // ─── Deploy Registry ────────────────────────────────────────────────────────
  if (doRegistry) {
    const REGISTRY_ID = 'registry.agents-coordinator.testnet';
    const REGISTRY_WASM = join(ROOT, 'registry-contract/target/near/registry_contract.wasm');

    console.log(`\n=== Deploying Registry Contract ===`);
    console.log(`  Account: ${REGISTRY_ID}`);

    await keyStore.setKey(NEAR_NETWORK, REGISTRY_ID, keyPair);
    const registryAccount = await near.account(REGISTRY_ID);

    const wasm = readFileSync(REGISTRY_WASM);
    console.log(`  WASM size: ${(wasm.length / 1024).toFixed(0)}KB`);

    try {
      await registryAccount.deployContract(wasm);
      console.log(`  WASM deployed.`);
    } catch (e: any) {
      console.error(`  Deploy failed:`, e.message);
    }

    // Reinitialize with new DID-keyed schema (force_reinitialize clears stale state)
    console.log(`  Reinitializing registry (force_reinitialize)...`);
    try {
      await (registryAccount as any).functionCall({
        contractId: REGISTRY_ID,
        methodName: 'force_reinitialize',
        args: { admin: MASTER_ACCOUNT },
        gas: BigInt('300000000000000'),
        attachedDeposit: BigInt('0'),
      });
      console.log(`  Reinitialized. Admin: ${MASTER_ACCOUNT}`);
    } catch (e: any) {
      console.warn(`  force_reinitialize warning:`, (e.message || '').substring(0, 300));
    }

    // Verify
    try {
      const workers = await viewCall<any[]>(REGISTRY_ID, 'list_active_workers');
      const coordinators = await viewCall<any[]>(REGISTRY_ID, 'list_active_coordinators');
      console.log(`  Active workers: ${workers?.length ?? 0}, coordinators: ${coordinators?.length ?? 0}`);
      console.log(`  Registry OK.`);
    } catch (e: any) {
      console.warn(`  Verify failed:`, e.message);
    }
  }

  // ─── Deploy Coordinator ──────────────────────────────────────────────────────
  if (doCoordinator) {
    const COORDINATOR_ID = 'coordinator.agents-coordinator.testnet';
    const COORDINATOR_WASM = join(ROOT, 'coordinator-contract/target/near/coordinator_contract.wasm');

    console.log(`\n=== Deploying Coordinator Contract ===`);
    console.log(`  Account: ${COORDINATOR_ID}`);

    await keyStore.setKey(NEAR_NETWORK, COORDINATOR_ID, keyPair);
    const coordAccount = await near.account(COORDINATOR_ID);

    const wasm = readFileSync(COORDINATOR_WASM);
    console.log(`  WASM size: ${(wasm.length / 1024).toFixed(0)}KB`);

    try {
      await coordAccount.deployContract(wasm);
      console.log(`  WASM deployed.`);
    } catch (e: any) {
      console.error(`  Deploy failed:`, e.message);
      process.exit(1);
    }

    // Preserve existing proposal count across migration
    let currentProposalId = 0;
    try {
      const pid = await viewCall<number>(COORDINATOR_ID, 'get_current_proposal_id', {});
      currentProposalId = pid ?? 0;
      console.log(`  Current proposal ID: ${currentProposalId}`);
    } catch {}

    // force_migrate: reinitialize with new state shape, preserving existing maps
    console.log(`  Calling force_migrate(owner=${MASTER_ACCOUNT}, current_proposal_id=${currentProposalId})...`);
    try {
      await (coordAccount as any).functionCall({
        contractId: COORDINATOR_ID,
        methodName: 'force_migrate',
        args: { owner: MASTER_ACCOUNT, current_proposal_id: currentProposalId },
        gas: BigInt('300000000000000'),
        attachedDeposit: BigInt('0'),
      });
      console.log(`  force_migrate complete.`);
    } catch (e: any) {
      console.warn(`  force_migrate warning:`, (e.message || '').substring(0, 300));
    }

    // Verify
    try {
      const pid = await viewCall<number>(COORDINATOR_ID, 'get_current_proposal_id', {});
      const manifesto = await viewCall<any>(COORDINATOR_ID, 'get_manifesto', {});
      console.log(`  proposal_id: ${pid}, manifesto: ${manifesto ? 'set' : 'not set'}`);
      console.log(`  Coordinator OK.`);
    } catch (e: any) {
      console.warn(`  Verify failed:`, e.message);
    }
  }

  console.log('\n=== Deployment complete ===\n');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
