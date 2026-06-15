/**
 * In-memory verdict store for x402-paid deliberations.
 *
 * Maps a coordinator-generated deliberation id → the proposal it runs, the
 * Stellar payment receipt that authorized it, the downstream NEAR proposal id
 * (once the coordination loop finishes), and the final verdict.
 *
 * Why in-memory (and not Ensue):
 *   1. The authoritative vote + tally already land in Ensue/on-chain via
 *      triggerLocalCoordination. This store is only the x402 index —
 *      deliberation id → tally lookup path for paid verdict retrieval.
 *   2. The x402 spec is request-scoped: the buyer pays to trigger, then pays
 *      again to read. Between those calls, ephemeral state is fine.
 *   3. Rebuilding from Ensue on server restart would require a separate index;
 *      an in-memory Map keeps the POC simple. Persistence can be added later
 *      by mirroring to Ensue under an x402/* key prefix.
 */

import type { TallyResult } from '@delibera-xyz/shared';

export type VerdictStatus = 'pending' | 'completed' | 'failed';

export interface VerdictRecord {
  /** x402 deliberation id — returned synchronously to the buyer on /x402/deliberate. */
  id: string;
  /** Human-readable proposal text submitted by the buyer. */
  proposal: string;
  /** Optional structured context (links, constraints, voting_config overrides). */
  context?: Record<string, unknown>;
  /** Stellar payment transaction hash once the x402 facilitator has settled. */
  stellarPaymentTx?: string;
  /** NEAR on-chain proposal id once the coordination loop creates it. */
  nearProposalId?: number;
  /** NEAR transaction hash for the final resume() call. */
  nearTxHash?: string;
  /** Current lifecycle state. */
  status: VerdictStatus;
  /** Full tally once workers have voted and the coordinator has aggregated. */
  verdict?: TallyResult;
  /** Optional error message if status === 'failed'. */
  error?: string;
  /** UTC timestamp the deliberation was created (ms since epoch). */
  createdAt: number;
  /** UTC timestamp the deliberation reached a terminal state (ms since epoch). */
  completedAt?: number;
}

const store = new Map<string, VerdictRecord>();

/**
 * Generate a short, URL-safe deliberation id. Format: `delib-<timestamp>-<rand>`.
 * Time prefix keeps ids loosely sortable in logs; random suffix avoids collision
 * when multiple requests arrive in the same millisecond.
 */
export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `delib-${ts}-${rand}`;
}

/**
 * Create a new pending verdict record. Returns the inserted record so callers
 * can read back the generated id + createdAt.
 */
export function createRecord(params: {
  proposal: string;
  context?: Record<string, unknown>;
  stellarPaymentTx?: string;
}): VerdictRecord {
  const record: VerdictRecord = {
    id: generateId(),
    proposal: params.proposal,
    context: params.context,
    stellarPaymentTx: params.stellarPaymentTx,
    status: 'pending',
    createdAt: Date.now(),
  };
  store.set(record.id, record);
  return record;
}

/**
 * Merge updates into an existing record. Returns the updated record, or
 * undefined if the id is unknown. Does not resurrect terminal records.
 */
export function updateRecord(
  id: string,
  updates: Partial<Omit<VerdictRecord, 'id' | 'createdAt'>>,
): VerdictRecord | undefined {
  const existing = store.get(id);
  if (!existing) return undefined;
  const merged: VerdictRecord = { ...existing, ...updates };
  // Stamp completedAt the first time we transition into a terminal state.
  if (
    !existing.completedAt &&
    (merged.status === 'completed' || merged.status === 'failed')
  ) {
    merged.completedAt = Date.now();
  }
  store.set(id, merged);
  return merged;
}

/**
 * Look up a verdict record by id.
 */
export function getRecord(id: string): VerdictRecord | undefined {
  return store.get(id);
}

/**
 * List all records (newest first). Useful for /x402/info diagnostics and tests.
 */
export function listRecords(): VerdictRecord[] {
  return Array.from(store.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Clear the store. Intended for tests only.
 */
export function _clearStore(): void {
  store.clear();
}
