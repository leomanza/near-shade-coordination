/**
 * StorachaProfileClient — Persistent worker profile storage via Storacha + Lit.
 *
 * Replaces the old pattern of fs.readFileSync(profiles.json) + in-memory decision array.
 * Each data section (manifesto, preferences, decisions, knowledge) is stored as a
 * separate encrypted JSON blob in Storacha. A lightweight index blob tracks CIDs.
 *
 * Fallback: When Storacha is not configured, reads profiles.json and stores
 * decisions in memory (current V1 behavior, for LOCAL_MODE development).
 */

import * as fs from 'fs';
import * as path from 'path';
import { encryptAndVault, isVaultConfigured } from './vault';
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
 * Used as fallback when Storacha is not configured and as initial seed data.
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

    // For now, manifesto always comes from seed profile.
    // When migration script runs, this will read from Storacha index CID.
    const seed = loadSeedProfile();
    const manifesto = seedToManifesto(seed);
    this.cache.set('manifesto', manifesto);
    return manifesto;
  }

  /* ─── Preferences ────────────────────────────────────────────────────── */

  async getPreferences(): Promise<AgentPreferences> {
    const cached = this.cache.get('preferences') as AgentPreferences | undefined;
    if (cached) return cached;

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

    // Try to read decisions from Storacha via the Ensue index key
    // The index is stored in Ensue as a known key so we can find it without
    // needing to remember the CID across restarts.
    try {
      const { createEnsueClient, MEMORY_KEYS } = await import('@near-shade-coordination/shared');
      const ensue = createEnsueClient();
      const indexKey = `agent/${this.workerId}/storacha/decisions_cid`;
      const cidStr = await ensue.readMemory(indexKey);
      if (cidStr) {
        // We have a CID — but decryption requires wallet + delegation which
        // adds complexity. For V1 of this client, we store decisions as
        // plaintext in Ensue (encrypted at rest by Ensue) and use Storacha
        // for the encrypted backup. This avoids the decrypt wallet requirement.
        const decisionsStr = await ensue.readMemory(`agent/${this.workerId}/decisions`);
        if (decisionsStr) {
          const decisions = JSON.parse(decisionsStr) as DecisionRecord[];
          this.cache.set('decisions', decisions);
          return decisions;
        }
      }

      // Also check the Ensue-only fallback key
      const decisionsStr = await ensue.readMemory(`agent/${this.workerId}/decisions`);
      if (decisionsStr) {
        const decisions = JSON.parse(decisionsStr) as DecisionRecord[];
        this.cache.set('decisions', decisions);
        return decisions;
      }
    } catch (e) {
      console.warn(`[profile:${this.workerId}] Failed to read decisions from Ensue:`, e);
    }

    return [];
  }

  /**
   * Save a decision to persistent storage.
   * Returns the Storacha CID if encrypted backup succeeded, or null for Ensue-only.
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

    // Persist to Ensue (fast, always available)
    let storachaCid: string | null = null;
    try {
      const { createEnsueClient } = await import('@near-shade-coordination/shared');
      const ensue = createEnsueClient();
      await ensue.updateMemory(
        `agent/${this.workerId}/decisions`,
        JSON.stringify(updated),
      );

      // Encrypted backup to Storacha
      try {
        storachaCid = await encryptAndVault(updated, {
          name: `${this.workerId}-decisions.json`,
        });
        // Store the CID reference in Ensue so we can find it later
        await ensue.updateMemory(
          `agent/${this.workerId}/storacha/decisions_cid`,
          storachaCid,
        );
        console.log(`[profile:${this.workerId}] Decision saved to Ensue + Storacha (CID: ${storachaCid})`);
      } catch (e) {
        console.warn(`[profile:${this.workerId}] Storacha backup failed (Ensue-only):`, e);
      }
    } catch (e) {
      // Ensue also failed — fall back to in-memory
      this.fallbackDecisions = updated;
      console.warn(`[profile:${this.workerId}] All persistence failed, decision in-memory only:`, e);
    }

    return storachaCid;
  }

  /* ─── Knowledge Notes ────────────────────────────────────────────────── */

  async getKnowledgeNotes(): Promise<string[]> {
    const cached = this.cache.get('knowledge') as string[] | undefined;
    if (cached) return cached;

    if (!this.useStoracha) {
      return this.fallbackKnowledge;
    }

    try {
      const { createEnsueClient } = await import('@near-shade-coordination/shared');
      const ensue = createEnsueClient();
      const notesStr = await ensue.readMemory(`agent/${this.workerId}/knowledge`);
      if (notesStr) {
        const notes = JSON.parse(notesStr) as string[];
        this.cache.set('knowledge', notes);
        return notes;
      }
    } catch (e) {
      console.warn(`[profile:${this.workerId}] Failed to read knowledge from Ensue:`, e);
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

    let storachaCid: string | null = null;
    try {
      const { createEnsueClient } = await import('@near-shade-coordination/shared');
      const ensue = createEnsueClient();
      await ensue.updateMemory(
        `agent/${this.workerId}/knowledge`,
        JSON.stringify(updated),
      );

      try {
        storachaCid = await encryptAndVault(updated, {
          name: `${this.workerId}-knowledge.json`,
        });
        await ensue.updateMemory(
          `agent/${this.workerId}/storacha/knowledge_cid`,
          storachaCid,
        );
      } catch (e) {
        console.warn(`[profile:${this.workerId}] Storacha knowledge backup failed:`, e);
      }
    } catch (e) {
      this.fallbackKnowledge = updated;
      console.warn(`[profile:${this.workerId}] Knowledge persistence failed:`, e);
    }

    return storachaCid;
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
