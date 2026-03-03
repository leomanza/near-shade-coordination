/**
 * Test script for Storacha Vault — encrypt + upload, then retrieve + decrypt.
 *
 * Tests the full round-trip:
 *   1. Initialize Storacha client with UCAN delegation
 *   2. Connect to Lit Protocol (nagaDev network, free)
 *   3. Encrypt a JSON object and upload to Storacha
 *   4. Retrieve the CID and decrypt back to original
 *   5. Verify the round-trip produces identical data
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.development.local node --import=dotenv/config scripts/test-vault.mjs
 *
 * Required env vars:
 *   STORACHA_AGENT_PRIVATE_KEY
 *   STORACHA_DELEGATION_PROOF
 */

import * as Client from '@storacha/client';
import { StoreMemory } from '@storacha/client/stores/memory';
import * as Proof from '@storacha/client/proof';
import { Signer } from '@storacha/client/principal/ed25519';
import { create as createEncryptedClient } from '@storacha/encrypt-upload-client';
import { createGenericLitAdapter } from '@storacha/encrypt-upload-client/factories.node';
import { createLitClient } from '@lit-protocol/lit-client';
import { createAuthManager, storagePlugins } from '@lit-protocol/auth';
import { nagaDev } from '@lit-protocol/networks';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

async function main() {
  console.log('=== Storacha Vault Round-Trip Test ===\n');

  // --- Step 1: Validate env vars ---
  const privateKey = process.env.STORACHA_AGENT_PRIVATE_KEY;
  const delegationProof = process.env.STORACHA_DELEGATION_PROOF;

  if (!privateKey || !delegationProof) {
    console.error('Missing required env vars:');
    if (!privateKey) console.error('  - STORACHA_AGENT_PRIVATE_KEY');
    if (!delegationProof) console.error('  - STORACHA_DELEGATION_PROOF');
    console.error('\nRun: DOTENV_CONFIG_PATH=.env.development.local node --import=dotenv/config scripts/test-vault.mjs');
    process.exit(1);
  }

  // --- Step 2: Initialize Storacha client ---
  console.log('[1/6] Initializing Storacha client...');
  const signer = Signer.parse(privateKey);
  console.log(`  Agent DID: ${signer.did()}`);

  const storachaClient = await Client.create({
    principal: signer,
    store: new StoreMemory(),
  });

  const proof = await Proof.parse(delegationProof);
  const space = await storachaClient.addSpace(proof);
  await storachaClient.setCurrentSpace(space.did());
  console.log(`  Space DID: ${space.did()}`);

  // --- Step 3: Initialize Lit Protocol ---
  console.log('[2/6] Connecting to Lit Protocol (nagaDev)...');
  const litClient = await createLitClient({ network: nagaDev });
  console.log('  Lit client connected');

  const authManager = createAuthManager({
    storage: storagePlugins.localStorageNode({
      appName: 'delibera-vault-test',
      networkName: 'naga-dev',
      storagePath: './.lit-auth-storage',
    }),
  });
  console.log('  Auth manager created');

  // --- Step 4: Create encrypted client ---
  console.log('[3/6] Creating encrypted Storacha client...');
  const cryptoAdapter = createGenericLitAdapter(litClient, authManager);

  const encryptedClient = await createEncryptedClient({
    storachaClient,
    cryptoAdapter,
  });
  console.log('  Encrypted client ready');

  // --- Step 5: Encrypt and upload ---
  const testData = {
    type: 'deliberation_transcript',
    proposal: 'Fund a developer education program',
    votes: [
      { workerId: 'worker1', vote: 'Approved' },
      { workerId: 'worker2', vote: 'Approved' },
      { workerId: 'worker3', vote: 'Rejected' },
    ],
    tally: { approved: 2, rejected: 1, decision: 'Approved' },
    timestamp: Date.now(),
  };

  console.log('[4/6] Encrypting and uploading test data...');
  console.log(`  Data: ${JSON.stringify(testData).substring(0, 80)}...`);

  const json = JSON.stringify(testData, null, 2);
  const blob = new Blob([json], { type: 'application/json' });

  const encryptionConfig = {
    issuer: storachaClient.agent,
    spaceDID: space.did(),
    proofs: storachaClient.proofs(),
    fileMetadata: {
      name: 'test-deliberation.json',
      type: 'application/json',
      extension: 'json',
    },
  };

  const cid = await encryptedClient.encryptAndUploadFile(blob, encryptionConfig);
  console.log(`  Upload CID: ${cid}`);

  // --- Step 6: Retrieve and decrypt ---
  console.log('[5/6] Retrieving and decrypting...');

  // Generate an Ethereum wallet for Lit auth (used for session sigs)
  const ethPrivKey = generatePrivateKey();
  const wallet = privateKeyToAccount(ethPrivKey);
  console.log(`  Lit auth wallet: ${wallet.address}`);

  const decryptionConfig = {
    decryptDelegation: proof,
    spaceDID: space.did(),
    proofs: storachaClient.proofs(),
    wallet,
  };

  const { stream, fileMetadata } = await encryptedClient.retrieveAndDecryptFile(
    cid,
    decryptionConfig
  );

  // Read stream to string
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const decryptedText = new TextDecoder().decode(combined);
  const decryptedData = JSON.parse(decryptedText);

  // --- Step 7: Verify ---
  console.log('[6/6] Verifying round-trip...');
  console.log(`  File metadata: ${JSON.stringify(fileMetadata)}`);
  console.log(`  Decrypted type: ${decryptedData.type}`);
  console.log(`  Decrypted tally: ${JSON.stringify(decryptedData.tally)}`);

  const match = JSON.stringify(testData) === JSON.stringify(decryptedData);
  if (match) {
    console.log('\n  PASS: Round-trip encryption/decryption verified!');
  } else {
    console.error('\n  FAIL: Decrypted data does not match original!');
    console.error('  Original:', JSON.stringify(testData));
    console.error('  Decrypted:', JSON.stringify(decryptedData));
    process.exit(1);
  }

  console.log('\n=== Test Complete ===');
}

main().catch((err) => {
  console.error('\nTest failed:', err);
  process.exit(1);
});
