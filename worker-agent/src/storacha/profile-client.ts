/**
 * StorachaProfileClient — Persistent worker profile storage via Storacha + Lit.
 *
 * Storacha is the PRIMARY persistent store for worker identity and memory.
 * Ensue is a write-through cache for fast reads (CID pointers + JSON data).
 *
 * Architecture:
 *   WRITE: encryptAndVault(data) → Storacha encrypted blob → CID in Ensue + JSON cache in Ensue
 *   READ:  Storacha (primary) → Ensue cache (fast fallback) → empty (new worker)
 *
 * Key prefix: The worker's DID (did:key:z6Mk...) is used as the Ensue key prefix,
 * NOT the legacy WORKER_ID (worker1/worker2/worker3). This ensures each worker
 * has its own isolated namespace.
 *
 * For freshly deployed workers with no data in Storacha or Ensue, the profile
 * client returns a blank identity that the owner can fill in via the app.
 */

import { encryptAndVault, retrieveAndDecrypt, isVaultConfigured } from './vault';
import { createStorachaClient, getAgentDid, isStorachaConfigured } from './identity';
import { encryptForEnsue, decryptFromEnsue } from './local-crypto';

// Use indirect dynamic import to prevent tsc from compiling import() to require().
// viem is ESM-only; require() fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
const dynamicImport = new Function('specifier', 'return import(specifier)');
import type {
  AgentManifesto,
  AgentPreferences,
  DecisionRecord,
  AgentIdentity,
} from './agent-identity';

/* ─── Profile Index (tracks CIDs per section) ───────────────────────────── */

interface ProfileIndex {
  workerId: string;
  manifestoCid?: string;
  preferencesCid?: string;
  decisionsCid?: string;
  knowledgeCid?: string;
  updatedAt: string;
}

/* ─── Blank identity for new workers ─────────────────────────────────────── */

function blankManifesto(workerId: string): AgentManifesto {
  const displayName = process.env.WORKER_DISPLAY_NAME || '';
  return {
    agentId: workerId,
    name: displayName || 'New Agent',
    role: '',
    values: [],
    guidelines: '',
  };
}

function blankPreferences(workerId: string): AgentPreferences {
  return {
    agentId: workerId,
    votingWeights: {},
    knowledgeNotes: [],
    updatedAt: new Date().toISOString(),
  };
}

/* ─── Ensue helper ──────────────────────────────────────────────────────── */

let _ensueClient: any = null;

async function getEnsue() {
  if (!_ensueClient) {
    const { createEnsueClient } = await import('@near-shade-coordination/shared');
    _ensueClient = createEnsueClient();
  }
  return _ensueClient;
}

/**
 * Read AES-encrypted (or plaintext-fallback) data from Ensue.
 * Returns null if key doesn't exist, is a bare CID, or decryption fails.
 */
async function readJsonFromEnsue(key: string): Promise<unknown | null> {
  try {
    const ensue = await getEnsue();
    const raw = await ensue.readMemory(key);
    if (!raw) return null;
    if (typeof raw !== 'string') return raw; // already parsed object (shouldn't happen)
    return decryptFromEnsue(raw);
  } catch {
    return null;
  }
}

/**
 * Write AES-encrypted data to Ensue.
 * Data is encrypted before storage so Ensue never holds plaintext agent memory.
 */
async function writeJsonToEnsue(key: string, data: unknown): Promise<void> {
  const ensue = await getEnsue();
  const encrypted = await encryptForEnsue(data);
  await ensue.updateMemory(key, encrypted);
}

/* ─── Storacha decrypt helper ────────────────────────────────────────────── */

/**
 * Decrypt a Storacha-vaulted blob by CID.
 * Uses ephemeral EVM wallet for Lit auth session (access is gated by UCAN proof).
 */
async function readFromStoracha(cidStr: string): Promise<unknown> {
  const storachaClient = await createStorachaClient();
  const proofs = storachaClient.proofs();
  if (!proofs || proofs.length === 0) {
    throw new Error('No UCAN proofs available for Storacha decryption');
  }
  const decryptDelegation = proofs[0];

  // Ephemeral EVM wallet — Lit session auth only; access is gated by UCAN proof
  const { generatePrivateKey, privateKeyToAccount } = await dynamicImport('viem/accounts');
  const wallet = privateKeyToAccount(generatePrivateKey());

  return retrieveAndDecrypt(cidStr, wallet, decryptDelegation);
}

/* ─── StorachaProfileClient ──────────────────────────────────────────────── */

export class StorachaProfileClient {
  /** Worker's DID (did:key:z6Mk...) — used as Ensue key prefix */
  private workerId: string;
  private cache: Map<string, unknown> = new Map();
  private useStoracha: boolean;

  // In-memory fallback for when Storacha is not configured
  private fallbackDecisions: DecisionRecord[] = [];
  private fallbackKnowledge: string[] = [];

  private constructor(workerId: string) {
    this.workerId = workerId;
    this.useStoracha = isVaultConfigured();
  }

  /**
   * Create a StorachaProfileClient from environment variables.
   * Uses the worker's DID as the key prefix for isolated storage.
   */
  static async fromEnv(): Promise<StorachaProfileClient> {
    // Use DID as workerId to ensure each worker has isolated storage
    let workerId: string;
    if (isStorachaConfigured()) {
      workerId = await getAgentDid();
      console.log(`[profile] Using DID-keyed Storacha persistence: ${workerId.substring(0, 24)}...`);
    } else {
      // Fallback for LOCAL_MODE without Storacha
      workerId = process.env.WORKER_ID || 'worker1';
      console.log(`[profile] Storacha not configured, using local fallback with ID: ${workerId}`);
    }
    const client = new StorachaProfileClient(workerId);
    return client;
  }

  /* ─── Manifesto ──────────────────────────────────────────────────────── */

  async getManifesto(): Promise<AgentManifesto> {
    const cached = this.cache.get('manifesto') as AgentManifesto | undefined;
    if (cached) return cached;

    // 1. Try Storacha (primary persistent store)
    if (this.useStoracha) {
      try {
        const ensue = await getEnsue();
        const cidStr = await ensue.readMemory(`agent/${this.workerId}/manifesto_cid`);
        if (cidStr && typeof cidStr === 'string' && cidStr.startsWith('baf')) {
          const manifesto = await readFromStoracha(cidStr) as AgentManifesto;
          this.cache.set('manifesto', manifesto);
          // Write-through cache to Ensue for fast reads
          writeJsonToEnsue(`agent/${this.workerId}/manifesto`, manifesto).catch(() => {});
          return manifesto;
        }
      } catch (e) {
        console.warn(`[profile:${this.workerId}] Storacha manifesto read failed:`, e);
      }
    }

    // 2. Try Ensue JSON cache (fast fallback)
    const ensueData = await readJsonFromEnsue(`agent/${this.workerId}/manifesto`);
    if (ensueData) {
      const manifesto = ensueData as AgentManifesto;
      this.cache.set('manifesto', manifesto);
      return manifesto;
    }

    // 3. Blank identity for new workers — owner fills in via app
    console.log(`[profile:${this.workerId}] No persistent manifesto — returning blank (new worker)`);
    const manifesto = blankManifesto(this.workerId);
    this.cache.set('manifesto', manifesto);
    return manifesto;
  }

  /* ─── Preferences ────────────────────────────────────────────────────── */

  async getPreferences(): Promise<AgentPreferences> {
    const cached = this.cache.get('preferences') as AgentPreferences | undefined;
    if (cached) return cached;

    // 1. Try Storacha (primary persistent store)
    if (this.useStoracha) {
      try {
        const ensue = await getEnsue();
        const cidStr = await ensue.readMemory(`agent/${this.workerId}/preferences_cid`);
        if (cidStr && typeof cidStr === 'string' && cidStr.startsWith('baf')) {
          const prefs = await readFromStoracha(cidStr) as AgentPreferences;
          this.cache.set('preferences', prefs);
          writeJsonToEnsue(`agent/${this.workerId}/preferences`, prefs).catch(() => {});
          return prefs;
        }
      } catch (e) {
        console.warn(`[profile:${this.workerId}] Storacha preferences read failed:`, e);
      }
    }

    // 2. Try Ensue JSON cache (fast fallback)
    const ensueData = await readJsonFromEnsue(`agent/${this.workerId}/preferences`);
    if (ensueData) {
      const prefs = ensueData as AgentPreferences;
      this.cache.set('preferences', prefs);
      return prefs;
    }

    // 3. Blank preferences for new workers
    console.log(`[profile:${this.workerId}] No persistent preferences — returning blank (new worker)`);
    const prefs = blankPreferences(this.workerId);
    this.cache.set('preferences', prefs);
    return prefs;
  }

  /**
   * Save manifesto. Storacha is primary persistent store, Ensue is write-through cache.
   */
  async saveManifesto(manifesto: AgentManifesto): Promise<string | null> {
    this.cache.set('manifesto', manifesto);
    let cid: string | null = null;

    // 1. Write to Storacha (primary)
    if (this.useStoracha) {
      try {
        cid = await encryptAndVault(manifesto, { name: `manifesto.json` });
        const ensue = await getEnsue();
        await ensue.updateMemory(`agent/${this.workerId}/manifesto_cid`, cid);
        console.log(`[profile] Manifesto saved to Storacha (CID: ${cid})`);
      } catch (e) {
        console.warn(`[profile] Storacha manifesto save failed:`, e);
      }
    }

    // 2. Write-through to Ensue cache
    try {
      await writeJsonToEnsue(`agent/${this.workerId}/manifesto`, manifesto);
    } catch (e) {
      console.warn(`[profile] Ensue cache write failed (non-fatal):`, e);
    }

    return cid;
  }

  /**
   * Save preferences. Storacha is primary persistent store, Ensue is write-through cache.
   */
  async savePreferences(prefs: AgentPreferences): Promise<string | null> {
    this.cache.set('preferences', prefs);
    let cid: string | null = null;

    // 1. Write to Storacha (primary)
    if (this.useStoracha) {
      try {
        cid = await encryptAndVault(prefs, { name: `preferences.json` });
        const ensue = await getEnsue();
        await ensue.updateMemory(`agent/${this.workerId}/preferences_cid`, cid);
        console.log(`[profile] Preferences saved to Storacha (CID: ${cid})`);
      } catch (e) {
        console.warn(`[profile] Storacha preferences save failed:`, e);
      }
    }

    // 2. Write-through to Ensue cache
    try {
      await writeJsonToEnsue(`agent/${this.workerId}/preferences`, prefs);
    } catch (e) {
      console.warn(`[profile] Ensue cache write failed (non-fatal):`, e);
    }

    return cid;
  }

  /* ─── Decisions ──────────────────────────────────────────────────────── */

  async getRecentDecisions(limit = 5): Promise<DecisionRecord[]> {
    const all = await this.getAllDecisions();
    return all.slice(-limit);
  }

  async getAllDecisions(): Promise<DecisionRecord[]> {
    const cached = this.cache.get('decisions') as DecisionRecord[] | undefined;
    if (cached) return cached;

    // 1. Try Storacha (primary persistent store)
    if (this.useStoracha) {
      try {
        const ensue = await getEnsue();
        const cidStr = await ensue.readMemory(`agent/${this.workerId}/decisions_cid`);
        if (cidStr && typeof cidStr === 'string' && cidStr.startsWith('baf')) {
          const decisions = await readFromStoracha(cidStr) as DecisionRecord[];
          this.cache.set('decisions', decisions);
          writeJsonToEnsue(`agent/${this.workerId}/decisions`, decisions).catch(() => {});
          return decisions;
        }
      } catch (e) {
        console.warn(`[profile:${this.workerId}] Storacha decisions read failed:`, e);
      }
    }

    // 2. Try Ensue JSON cache
    const ensueData = await readJsonFromEnsue(`agent/${this.workerId}/decisions`);
    if (ensueData && Array.isArray(ensueData)) {
      this.cache.set('decisions', ensueData);
      return ensueData as DecisionRecord[];
    }

    // 3. Empty for new workers
    return this.fallbackDecisions;
  }

  /**
   * Save a decision. Storacha is primary persistent store, Ensue is write-through cache.
   */
  async saveDecision(record: DecisionRecord): Promise<string | null> {
    // Update in-memory cache
    const existing = await this.getAllDecisions();
    const updated = [...existing, record].slice(-20); // keep last 20
    this.cache.set('decisions', updated);

    let cid: string | null = null;

    // 1. Write to Storacha (primary persistent store)
    if (this.useStoracha) {
      try {
        cid = await encryptAndVault(updated, {
          name: `decisions.json`,
        });
        const ensue = await getEnsue();
        await ensue.updateMemory(`agent/${this.workerId}/decisions_cid`, cid);
        console.log(`[profile] Decision saved to Storacha (CID: ${cid})`);
      } catch (e) {
        console.warn(`[profile] Storacha decision save failed:`, e);
      }
    } else {
      this.fallbackDecisions = updated;
    }

    // 2. Write-through to Ensue cache
    try {
      await writeJsonToEnsue(`agent/${this.workerId}/decisions`, updated);
    } catch (e) {
      console.warn(`[profile] Ensue cache write failed (non-fatal):`, e);
    }

    return cid;
  }

  /* ─── Knowledge Notes ────────────────────────────────────────────────── */

  async getKnowledgeNotes(): Promise<string[]> {
    const cached = this.cache.get('knowledge') as string[] | undefined;
    if (cached) return cached;

    // 1. Try Storacha (primary persistent store)
    if (this.useStoracha) {
      try {
        const ensue = await getEnsue();
        const cidStr = await ensue.readMemory(`agent/${this.workerId}/knowledge_cid`);
        if (cidStr && typeof cidStr === 'string' && cidStr.startsWith('baf')) {
          const notes = await readFromStoracha(cidStr) as string[];
          this.cache.set('knowledge', notes);
          writeJsonToEnsue(`agent/${this.workerId}/knowledge`, notes).catch(() => {});
          return notes;
        }
      } catch (e) {
        console.warn(`[profile:${this.workerId}] Storacha knowledge read failed:`, e);
      }
    }

    // 2. Try Ensue JSON cache
    const ensueData = await readJsonFromEnsue(`agent/${this.workerId}/knowledge`);
    if (ensueData && Array.isArray(ensueData)) {
      this.cache.set('knowledge', ensueData);
      return ensueData as string[];
    }

    // 3. Empty for new workers
    return this.fallbackKnowledge;
  }

  async appendKnowledgeNote(note: string): Promise<string | null> {
    const existing = await this.getKnowledgeNotes();
    const updated = [...existing, note];
    this.cache.set('knowledge', updated);

    let cid: string | null = null;

    // 1. Write to Storacha (primary persistent store)
    if (this.useStoracha) {
      try {
        cid = await encryptAndVault(updated, {
          name: `knowledge.json`,
        });
        const ensue = await getEnsue();
        await ensue.updateMemory(`agent/${this.workerId}/knowledge_cid`, cid);
      } catch (e) {
        console.warn(`[profile] Storacha knowledge save failed:`, e);
      }
    } else {
      this.fallbackKnowledge = updated;
    }

    // 2. Write-through to Ensue cache
    try {
      await writeJsonToEnsue(`agent/${this.workerId}/knowledge`, updated);
    } catch (e) {
      console.warn(`[profile] Ensue cache write failed (non-fatal):`, e);
    }

    return cid;
  }

  /* ─── Full Identity (convenience) ────────────────────────────────────── */

  async loadIdentity(): Promise<AgentIdentity> {
    const [manifesto, preferences, recentDecisions] = await Promise.all([
      this.getManifesto(),
      this.getPreferences(),
      this.getRecentDecisions(5),
    ]);

    // Merge knowledge notes into preferences
    const knowledge = await this.getKnowledgeNotes();
    const prefsWithKnowledge: AgentPreferences = {
      ...preferences,
      knowledgeNotes: knowledge,
    };

    return {
      manifesto,
      preferences: prefsWithKnowledge,
      recentDecisions,
    };
  }
}

/* ─── Singleton instance ─────────────────────────────────────────────────── */

let _instance: StorachaProfileClient | null = null;

/**
 * Get or create the singleton StorachaProfileClient.
 */
export async function getProfileClient(): Promise<StorachaProfileClient> {
  if (!_instance) {
    _instance = await StorachaProfileClient.fromEnv();
  }
  return _instance;
}
