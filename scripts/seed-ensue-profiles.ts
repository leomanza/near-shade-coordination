/**
 * Seed worker profile data directly into Ensue (no Storacha needed).
 *
 * This writes profile JSON directly to Ensue keys so workers can load
 * persistent identity without depending on Storacha IPFS gateways.
 *
 * Usage (run from project root with any worker's env for Ensue credentials):
 *   DOTENV_CONFIG_PATH=worker-agent/.env.worker1.local \
 *     npx tsx -r dotenv/config scripts/seed-ensue-profiles.ts
 *
 * Seeds all workers defined in config/profiles.json.
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
  const profilesPath = path.join(__dirname, '../worker-agent/config/profiles.json');
  const raw = fs.readFileSync(profilesPath, 'utf-8');
  const profiles: Record<string, SeedProfile> = JSON.parse(raw);

  // @ts-ignore — direct path import
  const { createEnsueClient } = await import('../shared/dist/index.js');
  const ensue = createEnsueClient();

  for (const [workerId, profile] of Object.entries(profiles)) {
    if (workerId.startsWith('_')) continue; // skip comments
    console.log(`\nSeeding ${workerId}: ${profile.name} (${profile.role})`);

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

    await ensue.updateMemory(`agent/${workerId}/manifesto`, JSON.stringify(manifesto));
    console.log(`  ✓ agent/${workerId}/manifesto`);

    await ensue.updateMemory(`agent/${workerId}/preferences`, JSON.stringify(preferences));
    console.log(`  ✓ agent/${workerId}/preferences`);

    await ensue.updateMemory(`agent/${workerId}/decisions`, JSON.stringify([]));
    console.log(`  ✓ agent/${workerId}/decisions`);

    await ensue.updateMemory(`agent/${workerId}/knowledge`, JSON.stringify([]));
    console.log(`  ✓ agent/${workerId}/knowledge`);
  }

  console.log('\nDone. All worker profiles seeded in Ensue.');
}

main().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
