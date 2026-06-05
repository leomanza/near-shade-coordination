/**
 * Browser-side wrappers for the 4 onboarding proxies. Each function is a thin
 * `fetch + JSON` helper that surfaces errors as Error.message strings the
 * state machine can display.
 */

export interface AnonymousRegisterResult {
  wallet_id: string;
  api_key: string;
  near_account_id: string;
  handoff_url?: string;
  trial?: { calls_remaining: number; expires_at: string };
}

export interface PolicyArgs {
  wallet_pubkey: string;
  encrypted_data: string;
  wallet_signature: string;
}

export interface RegisterWorkerResult {
  request_id: string;
  status: 'success' | string;
  tx_hash: string;
  result?: {
    account_id: string;
    worker_did: string;
    endpoint_url: string;
    cvm_id: string;
    registered_at: number;
    is_active: boolean;
  };
}

async function postJson<T>(path: string, body: object): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path}: ${res.status} ${text}`);
  }
  return res.json();
}

export const onboardOutlayer = {
  registerAnonymous: () =>
    postJson<AnonymousRegisterResult>('/api/onboard/outlayer-register', {}),

  registerBound: (body: {
    account_id: string;
    seed: string;
    pubkey: string;
    message: string;
    signature: string;
  }) => postJson<AnonymousRegisterResult>('/api/onboard/outlayer-register', body),

  encryptAndSignPolicy: (api_key: string, wallet_id: string, rules: object) =>
    postJson<PolicyArgs>('/api/onboard/policy-encrypt-sign', { api_key, wallet_id, rules }),

  invalidateCache: (api_key: string, wallet_id: string) =>
    postJson<{ ok: boolean }>('/api/onboard/invalidate-cache', { api_key, wallet_id }),

  registerWorker: (args: {
    api_key: string;
    worker_did: string;
    endpoint_url: string;
    cvm_id: string;
    registry_contract_id: string;
    /** V3.1.1 sovereign-deactivation controller (base58 ed25519 pubkey). */
    controller_pubkey?: string;
  }) => postJson<RegisterWorkerResult>('/api/onboard/register-worker', args),
};
