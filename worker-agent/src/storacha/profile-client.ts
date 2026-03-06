/**
 * StorachaProfileClient — Persistent worker profile storage via Storacha + Lit.
 *
 * Storacha is the PRIMARY persistent store for worker identity and memory.
 * Ensue stores ONLY CID pointers (not plaintext data).
 *
 * Architecture:
 *   WRITE: encryptAndVault(data) → Storacha encrypted blob → CID stored in Ensue
 *   READ:  get CID from Ensue → retrieveAndDecrypt(cid) → data
 *
 * Fallback: profiles.json seed (only when Storacha not yet seeded via migration script).
 * Run: scripts/migrate-profiles-to-storacha.ts --worker workerN
 */

import * as fs from 'fs';
import * as path from 'path';
import { encryptAndVault, retrieveAndDecrypt, isVaultConfigured } from './vault';
import { createStorachaClient } from './identity';
import type {
  AgentManifesto,
  AgentPreferences,
  DecisionRecord,
  AgentIdentity,
} from './agent-identity';

const WORKER_ID = process.env.WORKER_ID || 'worker1';

/* ─── Profile Index (tracks CIDs per section) ───────────────────────────── */

interface ProfileIndex {
  workerId: string;
  manifestoCid?: string;
  preferencesCid?: string;
  decisionsCid?: string;
  knowledgeCid?: string;
  updatedAt: string;
}

/* ─── Static seed profile shape (from profiles.json) ────────────────────── */

interface SeedProfile {
  name: string;
  role: string;
  values: string[];
  guidelines: string;
  weights: Record<string, number>;
}

const GENERIC_SEED: SeedProfile = {
  name: 'Agent',
  role: 'Governance Participant',
  values: [
    'Fair and transparent governance',
    'Community benefit',
    'Technical soundness',
  ],
  guidelines: 'Evaluate proposals on their merits. Consider both short-term impact and long-term sustainability.',
  weights: {
    community_benefit: 0.25,
    technical_feasibility: 0.25,
    sustainability: 0.25,
    transparency: 0.25,
  },
};

/**
 * Load a worker's seed profile from config/profiles.json.
 * Used as fallback when Storacha is not yet seeded.
 */
function loadSeedProfile(): SeedProfile {
  try {
    const profilesPath = path.join(__dirname, '../../config/profiles.json');
    const raw = fs.readFileSync(profilesPath, 'utf-8');
    const profiles: Record<string, SeedProfile> = JSON.parse(raw);
    return profiles[WORKER_ID] || GENERIC_SEED;
  } catch {
    return GENERIC_SEED;
  }
}

function seedToManifesto(seed: SeedProfile): AgentManifesto {
  return {
    agentId: WORKER_ID,
    name: seed.name,
    role: seed.role,
    values: seed.values,
    guidelines: seed.guidelines,
  };
}

function seedToPreferences(seed: SeedProfile): AgentPreferences {
  return {
    agentId: WORKER_ID,
    votingWeights: seed.weights,
    knowledgeNotes: [],
    updatedAt: new Date().toISOString(),
  };
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
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
  const wallet = privateKeyToAccount(generatePrivateKey());

  return retrieveAndDecrypt(cidStr, wallet, decryptDelegation);
}

/* ─── StorachaProfileClient ──────────────────────────────────────────────── */

export class StorachaProfileClient {
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
   */
  static async fromEnv(): Promise<StorachaProfileClient> {
    const client = new StorachaProfileClient(WORKER_ID);
    if (client.useStoracha) {
      console.log(`[profile:${WORKER_ID}] Using Storacha-backed persistence`);
    } else {
      console.log(`[profile:${WORKER_ID}] Storacha not configured, using local fallback`);
    }
    return client;
  }

  /* ─── Manifesto ──────────────────────────────────────────────────────── */

  async getManifesto(): Promise<AgentManifesto> {
    const cached = this.cache.get('manifesto') as AgentManifesto | undefined;
    if (cached) return cached;

    if (this.useStoracha) {
      // Read CID from Ensue → decrypt from Storacha (primary path)
      try {
        const { createEnsueClient } = await import('@near-shade-coordination/shared');
        const ensue = createEnsueClient();
        const cidStr = await ensue.readMemory(`agent/${this.workerId}/manifesto_cid`);
        if (cidStr) {
          const manifesto = await readFromStoracha(cidStr) as AgentManifesto;
          this.cache.set('manifesto', manifesto);
          return manifesto;
        }
      } catch (e) {
        console.warn(`[profile:${this.workerId}] Storacha manifesto read failed:`, e);
      }
    }

    // Fall back to seed profile (run migrate-profiles-to-storacha.ts to seed Storacha)
    console.warn(`[profile:${this.workerId}] No Storacha manifesto yet — using seed profile (run migration script)`);
    const seed = loadSeedProfile();
    const manifesto = seedToManifesto(seed);
    this.cache.set('manifesto', manifesto);
    return manifesto;
  }

  /* ─── Preferences ────────────────────────────────────────────────────── */

  async getPreferences(): Promise<AgentPreferences> {
    const cached = this.cache.get('preferences') as AgentPreferences | undefined;
    if (cached) return cached;

    if (this.useStoracha) {
      // Read CID from Ensue → decrypt from Storacha (primary path)
      try {
        const { createEnsueClient } = await import('@near-shade-coordination/shared');
        const ensue = createEnsueClient();
        const cidStr = await ensue.readMemory(`agent/${this.workerId}/preferences_cid`);
        if (cidStr) {
          const prefs = await readFromStoracha(cidStr) as AgentPreferences;
          this.cache.set('preferences', prefs);
          return prefs;
        }
      } catch (e) {
        console.warn(`[profile:${this.workerId}] Storacha preferences read failed:`, e);
      }
    }

    // Fall back to seed profile
    console.warn(`[profile:${this.workerId}] No Storacha preferences yet — using seed profile (run migration script)`);
    const seed = loadSeedProfile();
    const prefs = seedToPreferences(seed);
    this.cache.set('preferences', prefs);
    return prefs;
  }

  /* ─── Decisions ──────────────────────────────────────────────────────── */

  async getRecentDecisions(limit = 5): Promise<DecisionRecord[]> {
    const all = await this.getAllDecisions();
    return all.slice(-limit);
  }

  async getAllDecisions(): Promise<DecisionRecord[]> {
    const cached = this.cache.get('decisions') as DecisionRecord[] | undefined;
    if (cached) return cached;

    if (!this.useStoracha) {
      return this.fallbackDecisions;
    }

    // Read CID from Ensue → decrypt decisions from Storacha
    try {
      const { createEnsueClient } = await import('@near-shade-coordination/shared');
      const ensue = createEnsueClient();
      const cidStr = await ensue.readMemory(`agent/${this.workerId}/decisions_cid`);
      if (cidStr) {
        const decisions = await readFromStoracha(cidStr) as DecisionRecord[];
        this.cache.set('decisions', decisions);
        return decisions;
      }
    } catch (e) {
      console.warn(`[profile:${this.workerId}] Storacha decisions read failed:`, e);
    }

    return [];
  }

  /**
   * Save a decision to Storacha (primary) with CID pointer in Ensue.
   * Storacha is the only persistent store — no plaintext in Ensue.
   */
  async saveDecision(record: DecisionRecord): Promise<string | null> {
    // Update in-memory cache
    const existing = await this.getAllDecisions();
    const updated = [...existing, record].slice(-20); // keep last 20
    this.cache.set('decisions', updated);

    if (!this.useStoracha) {
      this.fallbackDecisions = updated;
      console.log(`[profile:${this.workerId}] Decision saved (in-memory fallback)`);
      return null;
    }

    try {
      // Encrypt and upload to Storacha
      const cid = await encryptAndVault(updated, {
        name: `${this.workerId}-decisions.json`,
      });

      // Store CID pointer in Ensue (not plaintext data)
      const { createEnsueClient } = await import('@near-shade-coordination/shared');
      const ensue = createEnsueClient();
      await ensue.updateMemory(
        `agent/${this.workerId}/decisions_cid`,
        cid,
      );

      console.log(`[profile:${this.workerId}] Decision saved to Storacha (CID: ${cid})`);
      return cid;
    } catch (e) {
      // Storacha failed — fall back to in-memory
      this.fallbackDecisions = updated;
      console.warn(`[profile:${this.workerId}] Storacha save failed, decision in-memory only:`, e);
      return null;
    }
  }

  /* ─── Knowledge Notes ────────────────────────────────────────────────── */

  async getKnowledgeNotes(): Promise<string[]> {
    const cached = this.cache.get('knowledge') as string[] | undefined;
    if (cached) return cached;

    if (!this.useStoracha) {
      return this.fallbackKnowledge;
    }

    // Read CID from Ensue → decrypt from Storacha
    try {
      const { createEnsueClient } = await import('@near-shade-coordination/shared');
      const ensue = createEnsueClient();
      const cidStr = await ensue.readMemory(`agent/${this.workerId}/knowledge_cid`);
      if (cidStr) {
        const notes = await readFromStoracha(cidStr) as string[];
        this.cache.set('knowledge', notes);
        return notes;
      }
    } catch (e) {
      console.warn(`[profile:${this.workerId}] Storacha knowledge read failed:`, e);
    }

    return [];
  }

  async appendKnowledgeNote(note: string): Promise<string | null> {
    const existing = await this.getKnowledgeNotes();
    const updated = [...existing, note];
    this.cache.set('knowledge', updated);

    if (!this.useStoracha) {
      this.fallbackKnowledge = updated;
      return null;
    }

    try {
      const cid = await encryptAndVault(updated, {
        name: `${this.workerId}-knowledge.json`,
      });
      const { createEnsueClient } = await import('@near-shade-coordination/shared');
      const ensue = createEnsueClient();
      await ensue.updateMemory(
        `agent/${this.workerId}/knowledge_cid`,
        cid,
      );
      return cid;
    } catch (e) {
      this.fallbackKnowledge = updated;
      console.warn(`[profile:${this.workerId}] Storacha knowledge save failed:`, e);
      return null;
    }
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
