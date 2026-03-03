/**
 * One-time migration script: Seed worker profile data to Storacha via Ensue.
 *
 * Reads config/profiles.json and uploads the specified worker's profile
 * sections (manifesto, preferences, decisions, knowledge) as initial data.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=worker-agent/.env.worker1.local \
 *     npx tsx -r dotenv/config scripts/migrate-profiles-to-storacha.ts --worker worker1
 *
 * Idempotent — re-running overwrites with fresh seed data.
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

  // 3. Write profile sections to Ensue (the primary persistence layer)
  const { createEnsueClient } = await import('@near-shade-coordination/shared');
  const ensue = createEnsueClient();

  const manifesto = {
    agentId: workerId,
    name: profile.name,
    role: profile.role,
    values: profile.values,
    guidelines: profile.guidelines,
  };

  const preferences = {
    agentId: workerId,
    votingWeights: profile.weights,
    knowledgeNotes: [],
    updatedAt: new Date().toISOString(),
  };

  const decisions: unknown[] = [];
  const knowledge: string[] = [];

  console.log('\nWriting to Ensue...');

  await ensue.updateMemory(`agent/${workerId}/manifesto`, JSON.stringify(manifesto));
  console.log(`  ✓ agent/${workerId}/manifesto`);

  await ensue.updateMemory(`agent/${workerId}/preferences`, JSON.stringify(preferences));
  console.log(`  ✓ agent/${workerId}/preferences`);

  await ensue.updateMemory(`agent/${workerId}/decisions`, JSON.stringify(decisions));
  console.log(`  ✓ agent/${workerId}/decisions`);

  await ensue.updateMemory(`agent/${workerId}/knowledge`, JSON.stringify(knowledge));
  console.log(`  ✓ agent/${workerId}/knowledge`);

  // 4. Encrypted backup to Storacha
  console.log('\nEncrypting and uploading to Storacha...');

  // Dynamic import for ESM-only vault module
  const vault = await import('../worker-agent/src/storacha/vault');

  const fullProfile = {
    type: 'worker_profile_seed',
    workerId,
    manifesto,
    preferences,
    decisions,
    knowledge,
    migratedAt: new Date().toISOString(),
  };

  try {
    const cid = await vault.encryptAndVault(fullProfile, {
      name: `${workerId}-profile-seed.json`,
    });

    await ensue.updateMemory(`agent/${workerId}/storacha/profile_seed_cid`, cid);
    console.log(`  ✓ Storacha CID: ${cid}`);
  } catch (error) {
    console.warn(`  ⚠ Storacha upload failed (Ensue data is still valid):`, error);
  }

  console.log(`\n=== Migration complete for ${workerId} ===\n`);
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
