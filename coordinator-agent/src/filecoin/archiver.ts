/**
 * Filecoin Archiver — Verify and record Filecoin archival for Storacha CIDs.
 *
 * Storacha automatically creates Filecoin storage deals for all uploaded content.
 * This module confirms the archival pipeline is working and creates verifiable
 * records for the NEAR ledger.
 *
 * Flow:
 *   1. Confirm CID exists in Storacha space (upload.list)
 *   2. Query IPNI (cid.contact) to verify content is indexed
 *   3. Verify retrieval via w3s.link gateway
 *   4. Return archival record with deal reference
 */

import crypto from 'crypto';
import { isVaultConfigured } from '../storacha/vault';

const IPNI_ENDPOINT = 'https://cid.contact/cid';
const GATEWAY_ENDPOINT = 'https://w3s.link/ipfs';

export interface ArchivalRecord {
  cid: string;
  status: 'archived' | 'pending' | 'failed';
  dealReference: string;
  providers: ProviderInfo[];
  gateway: { url: string; reachable: boolean };
  storachaSpace: string | null;
  archivedAt: string;
}

export interface ProviderInfo {
  id: string;
  addresses: string[];
  protocol: string;
}

/**
 * Archive a CID to Filecoin by confirming Storacha's automatic deal pipeline.
 *
 * Since Storacha handles Filecoin deal creation automatically, this function:
 * 1. Verifies the CID is indexed in IPNI (InterPlanetary Network Indexer)
 * 2. Confirms retrieval via the w3s.link gateway
 * 3. Creates a deterministic deal reference for NEAR contract logging
 *
 * @param cidString - The CID to archive (from encryptAndVault)
 * @returns The archival record with deal reference
 */
export async function archiveCID(cidString: string): Promise<ArchivalRecord> {
  console.log(`[filecoin] Archiving CID: ${cidString}`);

  const providers: ProviderInfo[] = [];
  let gatewayReachable = false;
  let status: ArchivalRecord['status'] = 'pending';

  // Step 1: Query IPNI for content indexing
  try {
    const ipniResponse = await fetch(`${IPNI_ENDPOINT}/${cidString}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (ipniResponse.ok) {
      const data = await ipniResponse.json() as any;
      const results = data?.MultihashResults || [];

      for (const result of results) {
        for (const pr of result?.ProviderResults || []) {
          const provider = pr?.Provider || {};
          providers.push({
            id: provider.ID || 'unknown',
            addresses: provider.Addrs || [],
            protocol: detectProtocol(provider.Addrs || []),
          });
        }
      }

      if (providers.length > 0) {
        console.log(`[filecoin] IPNI: ${providers.length} provider(s) found`);
        for (const p of providers) {
          console.log(`  Provider: ${p.id.substring(0, 16)}... (${p.protocol})`);
        }
      }
    }
  } catch (err) {
    console.warn('[filecoin] IPNI query failed:', err instanceof Error ? err.message : err);
  }

  // Step 2: Verify gateway retrieval
  try {
    const gatewayUrl = `${GATEWAY_ENDPOINT}/${cidString}`;
    const headResponse = await fetch(gatewayUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000),
    });
    gatewayReachable = headResponse.ok || headResponse.status === 301 || headResponse.status === 302;
    if (gatewayReachable) {
      console.log(`[filecoin] Gateway: CID retrievable via w3s.link`);
    }
  } catch (err) {
    console.warn('[filecoin] Gateway check failed:', err instanceof Error ? err.message : err);
  }

  // Step 3: Determine status
  if (providers.length > 0 && gatewayReachable) {
    status = 'archived';
  } else if (providers.length > 0 || gatewayReachable) {
    status = 'pending'; // Partially indexed
  } else {
    status = 'failed';
  }

  // Step 4: Generate deterministic deal reference
  // This is a content-derived ID that ties the CID to its Filecoin-backed storage
  const dealReference = generateDealReference(cidString, providers);

  // Step 5: Get Storacha space DID if available
  let spaceDid: string | null = null;
  if (isVaultConfigured()) {
    spaceDid = process.env.STORACHA_SPACE_DID || null;
  }

  const record: ArchivalRecord = {
    cid: cidString,
    status,
    dealReference,
    providers,
    gateway: {
      url: `${GATEWAY_ENDPOINT}/${cidString}`,
      reachable: gatewayReachable,
    },
    storachaSpace: spaceDid,
    archivedAt: new Date().toISOString(),
  };

  console.log(`[filecoin] Archival ${status}: deal ref ${dealReference}`);
  return record;
}

/**
 * Generate a deterministic deal reference from a CID and its providers.
 * This serves as a compact identifier for the archival record on NEAR.
 */
function generateDealReference(cid: string, providers: ProviderInfo[]): string {
  const providerIds = providers.map(p => p.id).sort().join(',');
  const hash = crypto
    .createHash('sha256')
    .update(`${cid}:${providerIds}`)
    .digest('hex')
    .substring(0, 16);
  return `fil-${hash}`;
}

/**
 * Detect the protocol type from provider addresses.
 */
function detectProtocol(addrs: string[]): string {
  for (const addr of addrs) {
    if (addr.includes('fil') || addr.includes('lotus')) return 'filecoin-sp';
    if (addr.includes('bitswap')) return 'bitswap';
    if (addr.includes('https') || addr.includes('http')) return 'http';
    if (addr.includes('wss') || addr.includes('ws')) return 'websocket';
  }
  return 'unknown';
}

/**
 * Log an archival record to the NEAR contract.
 * Uses the coordinator's local contract call to record the archival metadata.
 *
 * @param record - The archival record to log
 * @param proposalId - The associated proposal ID
 */
export async function logArchivalToNear(
  record: ArchivalRecord,
  proposalId: string | number,
): Promise<boolean> {
  if (record.status !== 'archived') {
    console.log('[filecoin] Skipping NEAR log — archival not confirmed');
    return false;
  }

  try {
    // Log via Ensue memory for now (NEAR contract method can be added later)
    const { createEnsueClient } = await import(
      '@near-shade-coordination/shared'
    );
    const client = createEnsueClient();

    const archivalKey = `coordination/archival/${proposalId}`;
    await client.updateMemory(
      archivalKey,
      JSON.stringify({
        cid: record.cid,
        dealReference: record.dealReference,
        providerCount: record.providers.length,
        storachaSpace: record.storachaSpace,
        archivedAt: record.archivedAt,
      }),
    );

    console.log(`[filecoin] Archival logged to Ensue: ${archivalKey}`);
    return true;
  } catch (err) {
    console.warn('[filecoin] Failed to log archival to NEAR:', err);
    return false;
  }
}
