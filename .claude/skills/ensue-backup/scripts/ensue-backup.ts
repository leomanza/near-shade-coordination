/**
 * Ensue Backup — Serialize the full Ensue coordination tree and
 * encrypt + upload it to Storacha via the vault module.
 *
 * Can be called:
 *   1. Programmatically from memory-monitor.ts after each deliberation cycle
 *   2. As a standalone script: npx tsx scripts/ensue-backup.ts
 *
 * Returns the CID of the encrypted backup.
 */

// This file documents the skill logic.
// The actual implementation lives in coordinator-agent/src/storacha/ensue-backup.ts
// so it can be imported by memory-monitor.ts at runtime.
//
// Usage:
//   import { backupEnsueTree } from '../storacha/ensue-backup';
//   const cid = await backupEnsueTree();
