/**
 * One-time migration script: Seed worker profile data to Storacha.
 *
 * Reads config/profiles.json, uploads each section as an ENCRYPTED blob to Storacha,
 * and stores the returned CIDs in Ensue as index pointers.
 * Storacha is the PRIMARY store; Ensue holds only CID pointers.
 *
 * Usage (run from project root):
 *   DOTENV_CONFIG_PATH=worker-agent/.env.worker1.local \
 *     npx tsx -r dotenv/config scripts/migrate-profiles-to-storacha.ts --worker worker1
 *
 * Idempotent — re-running overwrites with fresh seed data.
 * Required before workers can load profiles from Storacha at runtime.
 */

import * as fs from 'fs';
import * as path from 'path';

interface SeedProfile {
  name: string;
  role: string;
  values: string[];
  guidelines: string;
  weights: Record<string, number>;
}

async function main() {
  const args = process.argv.slice(2);
  const workerIdx = args.indexOf('--worker');
  const workerId = workerIdx >= 0 ? args[workerIdx + 1] : process.env.WORKER_ID;

  if (!workerId) {
    console.error('Usage: migrate-profiles-to-storacha.ts --worker <worker1|worker2|worker3>');
    process.exit(1);
  }

  console.log(`\n=== Migrating profile for ${workerId} ===\n`);

  // 1. Read profiles.json
  const profilesPath = path.join(__dirname, '../worker-agent/config/profiles.json');
  const raw = fs.readFileSync(profilesPath, 'utf-8');
  const profiles: Record<string, SeedProfile> = JSON.parse(raw);
  const profile = profiles[workerId];

  if (!profile) {
    console.error(`Worker "${workerId}" not found in profiles.json`);
    console.error(`Available workers: ${Object.keys(profiles).join(', ')}`);
    process.exit(1);
  }

  console.log(`Profile: ${profile.name} (${profile.role})`);
  console.log(`Values: ${profile.values.length}`);
  console.log(`Weights: ${Object.keys(profile.weights).join(', ')}`);

  // 2. Check Storacha configuration
  if (!process.env.STORACHA_AGENT_PRIVATE_KEY || !process.env.STORACHA_DELEGATION_PROOF) {
    console.error('\nStoracha not configured. Set STORACHA_AGENT_PRIVATE_KEY and STORACHA_DELEGATION_PROOF.');
    process.exit(1);
  }

  // 2b. Resolve worker DID from Storacha private key (Ensue keys are DID-prefixed)
  const identity = await import('../worker-agent/src/storacha/identity');
  const workerDid = await identity.getAgentDid();
  console.log(`Worker DID: ${workerDid}`);

  // 3. Build profile data sections (use DID as agentId for consistency with runtime)
  const manifesto = {
    agentId: workerDid,
    name: profile.name,
    role: profile.role,
    values: profile.values,
    guidelines: profile.guidelines,
  };

  const preferences = {
    agentId: workerDid,
    votingWeights: profile.weights,
    knowledgeNotes: [],
    updatedAt: new Date().toISOString(),
  };

  const decisions: unknown[] = [];
  const knowledge: string[] = [];

  // 4. Encrypt + upload each section to Storacha
  console.log('\nEncrypting and uploading to Storacha...');
  const vault = await import('../worker-agent/src/storacha/vault');

  const manifestoCid = await vault.encryptAndVault(manifesto, {
    name: `${workerId}-manifesto.json`,
  });
  console.log(`  ✓ manifesto CID: ${manifestoCid}`);

  const preferencesCid = await vault.encryptAndVault(preferences, {
    name: `${workerId}-preferences.json`,
  });
  console.log(`  ✓ preferences CID: ${preferencesCid}`);

  const decisionsCid = await vault.encryptAndVault(decisions, {
    name: `${workerId}-decisions.json`,
  });
  console.log(`  ✓ decisions CID: ${decisionsCid}`);

  const knowledgeCid = await vault.encryptAndVault(knowledge, {
    name: `${workerId}-knowledge.json`,
  });
  console.log(`  ✓ knowledge CID: ${knowledgeCid}`);

  // 5. Store in Ensue: AES-encrypted data (primary reads) + CID pointers (Storacha backup index)
  console.log('\nStoring data in Ensue (AES-encrypted)...');
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — direct path import; package name not resolvable from scripts/
  const { createEnsueClient } = await import('../shared/dist/index.js');
  const ensue = createEnsueClient();
  const { encryptForEnsue } = await import('../worker-agent/src/storacha/local-crypto');

  // AES-encrypted JSON in Ensue (primary read path — fast, reliable, private)
  const keyPrefix = `agent/${workerDid}`;

  await ensue.updateMemory(`${keyPrefix}/manifesto`, await encryptForEnsue(manifesto));
  console.log(`  ✓ ${keyPrefix}/manifesto (AES-encrypted)`);

  await ensue.updateMemory(`${keyPrefix}/preferences`, await encryptForEnsue(preferences));
  console.log(`  ✓ ${keyPrefix}/preferences (AES-encrypted)`);

  await ensue.updateMemory(`${keyPrefix}/decisions`, await encryptForEnsue(decisions));
  console.log(`  ✓ ${keyPrefix}/decisions (AES-encrypted)`);

  await ensue.updateMemory(`${keyPrefix}/knowledge`, await encryptForEnsue(knowledge));
  console.log(`  ✓ ${keyPrefix}/knowledge (AES-encrypted)`);

  // CID pointers (Storacha backup index)
  await ensue.updateMemory(`${keyPrefix}/manifesto_cid`, manifestoCid);
  console.log(`  ✓ ${keyPrefix}/manifesto_cid → ${manifestoCid}`);

  await ensue.updateMemory(`${keyPrefix}/preferences_cid`, preferencesCid);
  console.log(`  ✓ ${keyPrefix}/preferences_cid → ${preferencesCid}`);

  await ensue.updateMemory(`${keyPrefix}/decisions_cid`, decisionsCid);
  console.log(`  ✓ ${keyPrefix}/decisions_cid → ${decisionsCid}`);

  await ensue.updateMemory(`${keyPrefix}/knowledge_cid`, knowledgeCid);
  console.log(`  ✓ ${keyPrefix}/knowledge_cid → ${knowledgeCid}`);

  // Also set the display name (public, unencrypted)
  await ensue.updateMemory(`${keyPrefix}/display_name`, profile.name);
  console.log(`  ✓ ${keyPrefix}/display_name → ${profile.name}`);

  console.log(`\n=== Migration complete for ${workerId} (${workerDid}) ===`);
  console.log(`Profile data stored in Ensue (AES-encrypted) + Storacha (Lit-encrypted backup).\n`);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
