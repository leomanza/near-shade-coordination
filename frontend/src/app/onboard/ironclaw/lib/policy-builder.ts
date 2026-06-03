/**
 * Build the default Phase 1 safe outlayer policy: function-calls allowed only
 * to the Delibera registry contract, per-tx cap 0.5 NEAR, daily cap 1 NEAR.
 *
 * Matches the policy that succeeded in the CLI autonomy demo
 * (doc/plans/skill-testing/10-outlayer-autonomy-demo.md step 5).
 *
 * Operators can later relax/tighten via outlayer's handoff UI; this is the
 * tight + safe starting point.
 */

export interface PolicyRules {
  per_transaction: { NEAR: string };
  transaction_types: string[];
  address: { whitelist: { NEAR: string[] } };
  daily?: { NEAR: string };
}

const ONE_NEAR_YOCTO = '1000000000000000000000000';
const HALF_NEAR_YOCTO = '500000000000000000000000';

export function buildDefaultPolicy(registryContractId: string): PolicyRules {
  return {
    per_transaction: { NEAR: HALF_NEAR_YOCTO },
    // NOTE: outlayer's policy taxonomy uses "call" (NOT "function_call",
    // which is the NEAR action-level name). The autonomy demo cost us one
    // tx until we figured this out. Same value as outlayer's UI uses.
    transaction_types: ['call'],
    address: { whitelist: { NEAR: [registryContractId] } },
    daily: { NEAR: ONE_NEAR_YOCTO },
  };
}
