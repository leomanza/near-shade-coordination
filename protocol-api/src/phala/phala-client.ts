/**
 * Phala Cloud deployment using @phala/cloud SDK.
 * Handles env encryption for TEE + proper CVM provisioning.
 */
import { createClient, encryptEnvVars } from '@phala/cloud';

const CLOUD_URL = 'https://cloud.phala.com';

export interface DeployCvmResult {
  cvmId: string;
  status: string;
  dashboardUrl: string;
  appId: string;
  endpointUrl?: string;
}

/**
 * Full deploy flow using @phala/cloud SDK:
 * 1. Provision CVM (validates compose, selects resources)
 * 2. Encrypt env vars with TEE public key
 * 3. Commit provision (creates the CVM)
 */
export async function deployCvm(
  apiKey: string,
  name: string,
  composeContent: string,
  envs: Record<string, string>,
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

  // Try to get the public endpoint URL by polling CVM status
  let endpointUrl: string | undefined;
  try {
    // Wait a bit for the CVM to get assigned, then query
    await new Promise(r => setTimeout(r, 3000));
    const cvmInfo = await getCvmStatus(apiKey, vmUuid);
    if (cvmInfo?.hosted_url) {
      endpointUrl = cvmInfo.hosted_url;
    } else if (cvmInfo?.dstack_dashboard_url) {
      // Derive endpoint from dashboard URL pattern: replace -8090 with -PORT
      const dashUrl = cvmInfo.dstack_dashboard_url as string;
      const match = dashUrl.match(/^(https:\/\/[a-f0-9]+)-8090\./);
      if (match) {
        endpointUrl = dashUrl.replace('-8090.', '-3001.');
      }
    }
    console.log(`[phala] Endpoint URL: ${endpointUrl || 'not yet available'}`);
  } catch (e) {
    console.log(`[phala] Could not fetch endpoint URL yet (CVM still provisioning)`);
  }

  return {
    cvmId: vmUuid,
    status: 'deploying',
    dashboardUrl: `${CLOUD_URL}/dashboard/cvms/${vmUuid}`,
    appId: provision.app_id ?? '',
    endpointUrl,
  };
}

/**
 * Get CVM status
 */
export async function getCvmStatus(
  apiKey: string,
  cvmId: string,
): Promise<any> {
  const client = createClient({ apiKey });
  // Use raw fetch since getCvm may not exist on all SDK versions
  const res = await fetch(`https://cloud-api.phala.network/api/v1/cvms/${cvmId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  return res.json();
}
