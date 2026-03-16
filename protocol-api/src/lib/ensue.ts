/**
 * Ensue provisioning helpers for the coordinator buy flow.
 *
 * Coordinator orgs are registered via the Ensue agent-register endpoint.
 * No admin key is required — the API key is returned once at registration
 * and must be stored immediately.
 */

const ENSUE_BASE = 'https://api.ensue-network.ai';

export interface EnsueOrgResult {
  apiKey: string;
  claimUrl: string;
  verificationCode: string;
  orgName: string;
}

/**
 * Register a new Ensue org for a coordinator agent.
 *
 * CRITICAL: `apiKey` is returned exactly once. The caller must persist it
 * to the job record before this function returns — it cannot be recovered.
 *
 * The returned API key is inactive until the human operator claims it via
 * the claimUrl + verificationCode. Surface both prominently in the buy flow.
 */
export async function provisionCoordinatorEnsueOrg(coordinatorDid: string): Promise<EnsueOrgResult> {
  // Org names: max 64 chars, alphanumeric + hyphens/underscores only
  const suffix = coordinatorDid.slice(-12).replace(/[^a-z0-9]/gi, '').toLowerCase();
  const name = `delibera-coord-${suffix}`;

  const res = await fetch(`${ENSUE_BASE}/auth/agent-register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ensue agent-register failed (${res.status}): ${text}`);
  }

  const data = await res.json() as {
    agent: {
      api_key: string;
      claim_url: string;
      verification_code: string;
    };
  };

  if (!data.agent?.api_key) {
    throw new Error('Ensue agent-register returned no api_key');
  }

  return {
    apiKey: data.agent.api_key,
    claimUrl: data.agent.claim_url,
    verificationCode: data.agent.verification_code,
    orgName: name,
  };
}
