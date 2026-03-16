/**
 * Phala Cloud deployment using @phala/cloud SDK.
 * Handles env encryption for TEE + proper CVM provisioning.
 *
 * Endpoint discovery pattern from shade-agent-cli:
 *   1. Poll GET /api/v1/cvms/{id} for `public_urls[].app`
 *   2. Ping the endpoint until health check returns "running"
 */
import { createClient, encryptEnvVars } from '@phala/cloud';

const CLOUD_URL = 'https://cloud.phala.com';
const PHALA_API = 'https://cloud-api.phala.network/api/v1';
const DSTACK_DOMAIN = 'dstack-pha-prod5.phala.network';

export interface DeployCvmResult {
  cvmId: string;
  status: string;
  dashboardUrl: string;
  appId: string;
  endpointUrl?: string;
  deterministicUrl?: string;
}

/**
 * Full deploy flow using @phala/cloud SDK:
 * 1. Provision CVM (validates compose, selects resources)
 * 2. Encrypt env vars with TEE public key
 * 3. Commit provision (creates the CVM)
 * 4. Poll for public endpoint URL
 * 5. Wait for app to be ready (health check)
 */
export async function deployCvm(
  apiKey: string,
  name: string,
  composeContent: string,
  envs: Record<string, string>,
  port = 3001,
): Promise<DeployCvmResult> {
  const client = createClient({ apiKey });

  const envVars = Object.entries(envs).map(([key, value]) => ({ key, value }));
  const allowedEnvKeys = envVars.map(e => e.key);

  // Step 1: Provision
  console.log(`[phala] Provisioning CVM "${name}" with ${allowedEnvKeys.length} env vars...`);
  const provision = await client.provisionCvm({
    name,
    instance_type: 'tdx.small',
    compose_file: {
      docker_compose_file: composeContent,
      allowed_envs: allowedEnvKeys,
    },
  });

  console.log(`[phala] Provisioned: app_id=${provision.app_id}, compose_hash=${provision.compose_hash}`);

  // Step 2: Encrypt env vars
  let encryptedEnv: string | undefined;
  if (envVars.length > 0 && provision.app_env_encrypt_pubkey) {
    console.log(`[phala] Encrypting ${envVars.length} env vars...`);
    encryptedEnv = await encryptEnvVars(envVars, provision.app_env_encrypt_pubkey);
  }

  // Step 3: Commit (create the CVM)
  console.log(`[phala] Committing CVM...`);
  const result = await client.commitCvmProvision({
    app_id: provision.app_id ?? '',
    compose_hash: provision.compose_hash ?? '',
    encrypted_env: encryptedEnv,
    env_keys: allowedEnvKeys,
  });

  const vmUuid = (result as any).vm_uuid ?? String((result as any).id);
  console.log(`[phala] CVM created: ${vmUuid}`);

  // Step 4: Construct deterministic endpoint URL from app_id
  // Pattern: https://{app_id}-{port}.{dstack_domain}
  const appId = provision.app_id ?? '';
  const deterministicUrl = `https://${appId}-${port}.${DSTACK_DOMAIN}`;
  console.log(`[phala] Deterministic endpoint URL: ${deterministicUrl}`);

  // Quick health check (3 attempts × 5s) — container may still be booting
  const ready = await waitForAppReady(deterministicUrl, 3, 5000);
  const endpointUrl = ready ? deterministicUrl : undefined;

  // Also try API-reported URLs as fallback
  if (!endpointUrl) {
    const apiUrl = await getAppUrl(apiKey, vmUuid, 2, 3000);
    if (apiUrl) {
      console.log(`[phala] API-reported URL: ${apiUrl}`);
      return {
        cvmId: vmUuid,
        status: 'running',
        dashboardUrl: `${CLOUD_URL}/dashboard/cvms/${vmUuid}`,
        appId,
        endpointUrl: apiUrl,
      };
    }
  }

  return {
    cvmId: vmUuid,
    status: endpointUrl ? 'running' : 'deploying',
    dashboardUrl: `${CLOUD_URL}/dashboard/cvms/${vmUuid}`,
    appId,
    endpointUrl,
    deterministicUrl,
  };
}

/**
 * Background-poll for a CVM's public endpoint URL and call onFound() when available.
 * Call without await — runs as a fire-and-forget background task.
 * Pattern: shade-agent-cli polls GET /api/v1/cvms/{id} for public_urls[].app
 */
export async function watchForEndpoint(
  apiKey: string,
  cvmId: string,
  onFound: (url: string) => Promise<void>,
  maxMinutes = 15,
  deterministicUrl?: string,
): Promise<void> {
  console.log(`[phala] Background: watching for endpoint of ${cvmId} (up to ${maxMinutes}min)...`);

  // Strategy: alternate between deterministic URL health check and API poll
  const totalAttempts = maxMinutes * 4; // every 15s
  for (let i = 0; i < totalAttempts; i++) {
    // Try deterministic URL first (faster, no API call)
    if (deterministicUrl) {
      try {
        const res = await fetch(deterministicUrl, {
          method: 'GET',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          console.log(`[phala] Background: deterministic URL ready: ${deterministicUrl}`);
          try { await onFound(deterministicUrl); } catch (e) {
            console.error(`[phala] Background: onFound callback failed:`, e);
          }
          return;
        }
      } catch {
        // Not ready yet
      }
    }

    // Try API-reported URL every 3rd attempt
    if (i % 3 === 2) {
      const apiUrl = await getAppUrl(apiKey, cvmId, 1, 0);
      if (apiUrl) {
        console.log(`[phala] Background: API-reported URL found: ${apiUrl}`);
        try { await onFound(apiUrl); } catch (e) {
          console.error(`[phala] Background: onFound callback failed:`, e);
        }
        return;
      }
    }

    if (i < totalAttempts - 1) {
      await new Promise(r => setTimeout(r, 15000));
    }
  }

  console.warn(`[phala] Background: gave up waiting for endpoint of ${cvmId} after ${maxMinutes}min`);
}

/**
 * Get public endpoint URLs from a CVM.
 * Polls GET /api/v1/cvms/{id} for `public_urls[].app`
 * Pattern from: shade-agent-cli/src/commands/deploy/phala.js
 */
async function getAppUrl(
  apiKey: string,
  cvmId: string,
  maxAttempts = 10,
  delay = 3000,
): Promise<string | undefined> {
  console.log(`[phala] Polling for public endpoint...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${PHALA_API}/cvms/${cvmId}`, {
        headers: { 'X-API-Key': apiKey },
      });
      if (!res.ok) {
        console.log(`[phala] Attempt ${attempt}/${maxAttempts}: HTTP ${res.status}`);
        if (attempt < maxAttempts) {
          await new Promise(r => setTimeout(r, delay));
        }
        continue;
      }
      const data = await res.json() as any;
      if (!data.error && Array.isArray(data.public_urls)) {
        const validUrls = data.public_urls.filter(
          (u: any) => u.app && u.app.trim() !== '',
        );
        if (validUrls.length > 0) {
          console.log(`[phala] Found ${validUrls.length} public URL(s):`);
          validUrls.forEach((u: any, i: number) => {
            console.log(`  ${i + 1}. ${u.app}${u.instance ? ` (instance: ${u.instance})` : ''}`);
          });
          return validUrls[0].app;
        }
      }
    } catch (e) {
      console.log(`[phala] Attempt ${attempt}/${maxAttempts}: ${e instanceof Error ? e.message : 'error'}`);
    }

    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.log(`[phala] Public URL not available after ${maxAttempts} attempts`);
  return undefined;
}

/**
 * Ping an endpoint until it responds with a health check.
 * Pattern from: shade-agent-framework/tests-in-tee/test-script.js
 */
async function waitForAppReady(
  baseUrl: string,
  maxAttempts = 20,
  delay = 10000,
): Promise<boolean> {
  console.log(`[phala] Waiting for app to be ready at ${baseUrl}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(baseUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json() as any;
        if (data.message && String(data.message).toLowerCase().includes('running')) {
          console.log(`[phala] App is ready (attempt ${attempt})`);
          return true;
        }
      }
    } catch {
      // Continue retrying
    }

    if (attempt < maxAttempts) {
      console.log(`[phala] Not ready yet (attempt ${attempt}/${maxAttempts}), retrying in ${delay / 1000}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.log(`[phala] App did not become ready after ${maxAttempts * delay / 1000}s`);
  return false;
}

/**
 * Get CVM status (raw API response)
 */
export async function getCvmStatus(
  apiKey: string,
  cvmId: string,
): Promise<any> {
  const res = await fetch(`${PHALA_API}/cvms/${cvmId}`, {
    headers: { 'X-API-Key': apiKey },
  });
  return res.json();
}
