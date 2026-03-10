/**
 * NameResolver — Cache-first display name resolution for worker DIDs.
 *
 * Display names are stored in Ensue at `agent/{did}/display_name`.
 * They are public metadata (not encrypted) and set at registration time
 * or via the worker rename API.
 *
 * Fallback: truncated DID (e.g. "z6MkuLv3...qYv").
 */

import { createEnsueClient, type EnsueClient } from './ensue-client';

export class NameResolver {
  private cache: Map<string, string> = new Map();
  private ensue: EnsueClient;

  constructor(ensue?: EnsueClient) {
    this.ensue = ensue ?? createEnsueClient();
  }

  /**
   * Resolve a display name for a DID. Returns cached value if available,
   * otherwise reads from Ensue. Falls back to truncated DID on failure.
   */
  async resolveName(did: string): Promise<string> {
    const cached = this.cache.get(did);
    if (cached) return cached;

    try {
      const name = await this.ensue.readMemory(`agent/${did}/display_name`);
      if (name && name.trim()) {
        this.cache.set(did, name);
        return name;
      }
    } catch {
      // Ensue read failed — use fallback
    }

    const fallback = truncateDid(did);
    this.cache.set(did, fallback);
    return fallback;
  }

  /**
   * Resolve names for multiple DIDs in parallel.
   */
  async resolveAll(dids: string[]): Promise<Map<string, string>> {
    await Promise.all(dids.map((did) => this.resolveName(did)));
    return new Map(this.cache);
  }

  /**
   * Set a display name (writes to Ensue and updates cache).
   */
  async setName(did: string, name: string): Promise<void> {
    await this.ensue.updateMemory(`agent/${did}/display_name`, name);
    this.cache.set(did, name);
  }

  /**
   * Invalidate a cached name (forces re-fetch on next resolve).
   */
  invalidate(did: string): void {
    this.cache.delete(did);
  }

  /**
   * Get all cached names (for passing to frontend).
   */
  getCachedNames(): Record<string, string> {
    return Object.fromEntries(this.cache);
  }
}

/**
 * Truncate a DID for display. E.g. "did:key:z6MkuLv3...qYv"
 */
export function truncateDid(did: string): string {
  if (did.startsWith('did:key:')) {
    const key = did.slice('did:key:'.length);
    if (key.length > 16) {
      return `${key.slice(0, 8)}...${key.slice(-4)}`;
    }
    return key;
  }
  if (did.length > 24) {
    return `${did.slice(0, 12)}...${did.slice(-6)}`;
  }
  return did;
}
