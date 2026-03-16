/**
 * Test script for Storacha identity generation (ESM).
 *
 * Verifies:
 * 1. Ed25519 signer can be created from a private key
 * 2. A valid did:key is produced
 * 3. If delegation proof is set, a full Storacha client can be initialized
 *
 * Usage:
 *   node scripts/test-storacha-identity.mjs
 *
 * Or with env vars:
 *   STORACHA_AGENT_PRIVATE_KEY=Mg... node scripts/test-storacha-identity.mjs
 */

import * as Client from '@storacha/client';
import { StoreMemory } from '@storacha/client/stores/memory';
import * as Proof from '@storacha/client/proof';
import { Signer } from '@storacha/client/principal/ed25519';

async function main() {
  console.log('=== Storacha Identity Test ===\n');

  // Step 1: Check if a private key is set in env
  const privateKey = process.env.STORACHA_AGENT_PRIVATE_KEY;

  if (privateKey) {
    console.log('STORACHA_AGENT_PRIVATE_KEY: set (from env)');

    const signer = Signer.parse(privateKey);
    console.log(`Agent DID: ${signer.did()}`);
    console.log(`DID valid: ${signer.did().startsWith('did:key:')}`);

    // Step 2: Try full client init if delegation is also set
    const delegationProof = process.env.STORACHA_DELEGATION_PROOF;
    if (delegationProof) {
      console.log('\nSTORACHA_DELEGATION_PROOF: set');
      console.log('Initializing full Storacha client...');

      const client = await Client.create({
        principal: signer,
        store: new StoreMemory(),
      });

      const proof = await Proof.parse(delegationProof);
      const space = await client.addSpace(proof);
      await client.setCurrentSpace(space.did());

      console.log(`Space DID: ${space.did()}`);
      console.log('Full client initialized successfully!');
    } else {
      console.log('\nSTORACHA_DELEGATION_PROOF: not set (skipping client init)');
      console.log('To test full client, generate a delegation:');
      console.log(`  storacha delegation create ${signer.did()} -c space/blob/add -c space/index/add -c upload/add --base64`);
    }
  } else {
    // No key in env — generate a fresh one for demo
    console.log('STORACHA_AGENT_PRIVATE_KEY: not set');
    console.log('Generating a fresh Ed25519 keypair for demonstration...\n');

    const signer = await Signer.generate();
    console.log(`Generated Agent DID: ${signer.did()}`);
    console.log(`DID valid: ${signer.did().startsWith('did:key:')}`);

    // Export the private key so user can save it
    const exported = Signer.format(signer);
    console.log(`\nPrivate key (save to STORACHA_AGENT_PRIVATE_KEY):`);
    console.log(`  ${exported}`);
    console.log(`\nNext steps:`);
    console.log(`  1. Save the private key above to your .env file`);
    console.log(`  2. Create a Storacha space: storacha space create delibera-v2`);
    console.log(`  3. Create a delegation:`);
    console.log(`     storacha delegation create ${signer.did()} \\`);
    console.log(`       -c space/blob/add -c space/index/add -c upload/add --base64`);
    console.log(`  4. Save the delegation to STORACHA_DELEGATION_PROOF in your .env`);
  }

  console.log('\n=== Test Complete ===');
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
