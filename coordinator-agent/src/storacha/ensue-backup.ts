/**
 * Ensue Backup — Serialize the full Ensue coordination tree
 * and upload it encrypted to Storacha via the vault.
 *
 * Reads all keys under `coordination/` from Ensue, bundles them
 * into a single JSON snapshot, then calls encryptAndVault().
 */

import { createEnsueClient, EnsueClient } from '@near-shade-coordination/shared';
import { encryptAndVault, isVaultConfigured } from './vault';

let _ensueClient: EnsueClient | null = null;
function getEnsueClient(): EnsueClient {
  if (!_ensueClient) _ensueClient = createEnsueClient();
  return _ensueClient;
}

/**
 * Serialize the entire Ensue coordination tree to a JSON snapshot.
 * Lists all keys under `coordination/` and reads their values.
 */
export async function serializeEnsueTree(): Promise<Record<string, string>> {
  const client = getEnsueClient();
  const keys = await client.listKeys('coordination/');

  if (keys.length === 0) {
    console.log('[ensue-backup] No keys found under coordination/');
    return {};
  }

  console.log(`[ensue-backup] Found ${keys.length} keys to serialize`);

  // Read all values in batches of 20 to avoid overloading the API
  const tree: Record<string, string> = {};
  const batchSize = 20;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);
    const values = await client.readMultiple(batch);
    Object.assign(tree, values);
  }

  const populated = Object.keys(tree).length;
  console.log(`[ensue-backup] Serialized ${populated}/${keys.length} keys with values`);
  return tree;
}

/**
 * Back up the Ensue coordination tree to Storacha.
 *
 * 1. Serializes all coordination/ keys from Ensue
 * 2. Encrypts the snapshot with Lit Protocol
 * 3. Uploads to Storacha
 *
 * @returns The CID of the encrypted backup, or null if not configured / empty
 */
export async function backupEnsueTree(): Promise<string | null> {
  if (!isVaultConfigured()) {
    console.log('[ensue-backup] Vault not configured, skipping');
    return null;
  }

  try {
    const tree = await serializeEnsueTree();

    if (Object.keys(tree).length === 0) {
      console.log('[ensue-backup] Empty tree, skipping backup');
      return null;
    }

    const snapshot = {
      type: 'ensue_backup',
      version: 1,
      keyCount: Object.keys(tree).length,
      tree,
      backedUpAt: new Date().toISOString(),
    };

    const cid = await encryptAndVault(snapshot, {
      name: `ensue-backup-${Date.now()}.json`,
    });

    console.log(`[ensue-backup] Backup complete. CID: ${cid}`);
    return cid;
  } catch (error) {
    console.error('[ensue-backup] Backup failed:', error);
    return null;
  }
}
