import {
  ensureGroup,
  uploadJson,
  retrieveJson,
  listGroupTransactions,
  isNovaAvailable,
} from './nova-client';

const WORKER_ID = process.env.WORKER_ID || 'worker1';

/* ─── Types ───────────────────────────────────────────────────────────────── */

export interface AgentManifesto {
  agentId: string;
  name: string;
  role: string;
  values: string[];
  guidelines: string;
}

export interface AgentPreferences {
  agentId: string;
  votingWeights: Record<string, number>;
  knowledgeNotes: string[];
  updatedAt: string;
}

export interface DecisionRecord {
  proposalId: string;
  proposal: string;
  vote: 'Approved' | 'Rejected';
  reasoning: string;
  timestamp: string;
}

export interface AgentIdentity {
  manifesto: AgentManifesto;
  preferences: AgentPreferences;
  recentDecisions: DecisionRecord[];
}

/* ─── CID Registry ────────────────────────────────────────────────────────── */

/**
 * We track CIDs for known files in memory. On startup, we scan the group's
 * transaction history to find existing uploads by filename convention.
 *
 * Filenames: manifesto.json, preferences.json, history-{proposalId}.json
 */
const cidRegistry: Record<string, string> = {};

/**
 * Scan group transactions to rebuild the CID registry.
 * Nova doesn't have a "list files by name" API, so we track filenames
 * by storing a registry document in Nova itself.
 */
async function loadRegistry(): Promise<void> {
  try {
    const txs = await listGroupTransactions();
    // Look for the registry file — most recent upload wins
    const registryTxs = txs.filter(tx => tx.file_hash);
    if (registryTxs.length > 0) {
      // Try to load the registry from the most recent transaction
      // We'll use a dedicated registry file to track name->CID mappings
      try {
        const latest = registryTxs[registryTxs.length - 1];
        const reg = await retrieveJson<Record<string, string>>(latest.ipfs_hash);
        if (reg && reg._type === 'cid-registry') {
          Object.assign(cidRegistry, reg);
          console.log(`[nova-identity] Loaded CID registry with ${Object.keys(reg).length - 1} entries`);
        }
      } catch {
        // Registry doesn't exist yet or latest file isn't a registry
      }
    }
  } catch (e) {
    console.log(`[nova-identity] No existing registry found, starting fresh`);
  }
}

async function saveRegistry(): Promise<void> {
  const regData = { ...cidRegistry, _type: 'cid-registry' };
  const cid = await uploadJson('_registry.json', regData);
  // The registry itself is always the last upload — we find it by scanning txs
  console.log(`[nova-identity] Saved CID registry -> ${cid}`);
}

/* ─── Default Identity (unique per agent) ─────────────────────────────────── */

/**
 * Each agent starts with a distinct identity. These defaults are seeded on
 * first run and can be updated via the /api/knowledge endpoints.
 *
 * The shared DAO manifesto from the smart contract acts as the "agency rulebook"
 * all agents must follow. These per-agent identities add individual perspective.
 */

const AGENT_PROFILES: Record<string, { name: string; role: string; values: string[]; guidelines: string; weights: Record<string, number> }> = {
  worker1: {
    name: 'Sentinel',
    role: 'Community Guardian',
    values: [
      'Inclusive governance and broad participation',
      'Protection of minority stakeholder interests',
      'Equitable distribution of resources and opportunity',
      'Transparency and open communication',
      'Resistance to centralization of power',
    ],
    guidelines:
      'Prioritize proposals that benefit the widest range of community members. ' +
      'Be wary of proposals that disproportionately benefit insiders or large holders. ' +
      'Favor transparency and open processes over closed-door decisions. ' +
      'Advocate for underrepresented groups in governance.',
    weights: {
      community_benefit: 0.35,
      fairness_equity: 0.30,
      transparency: 0.20,
      technical_feasibility: 0.15,
    },
  },
  worker2: {
    name: 'Cipher',
    role: 'Technical Analyst',
    values: [
      'Security-first design and risk mitigation',
      'Scalable and maintainable architecture',
      'Proven technology over experimental hype',
      'Data-driven decision making',
      'Code quality and auditability',
    ],
    guidelines:
      'Evaluate proposals primarily on technical merit and security implications. ' +
      'Reject proposals with unaddressed security risks or unproven assumptions. ' +
      'Favor incremental improvements over sweeping changes. ' +
      'Require clear technical specifications before supporting funding requests.',
    weights: {
      technical_feasibility: 0.35,
      security_risk: 0.30,
      scalability: 0.20,
      resource_efficiency: 0.15,
    },
  },
  worker3: {
    name: 'Horizon',
    role: 'Sustainability Strategist',
    values: [
      'Long-term ecosystem health over short-term gains',
      'Environmental and economic sustainability',
      'Strategic resource allocation for future growth',
      'Interoperability and composability with the broader ecosystem',
      'Resilience against market volatility and external shocks',
    ],
    guidelines:
      'Focus on proposals that strengthen the ecosystem in the long run. ' +
      'Be skeptical of proposals optimizing for short-term metrics at the expense of sustainability. ' +
      'Favor investments in infrastructure, education, and ecosystem tooling. ' +
      'Consider second-order effects and downstream consequences of proposals.',
    weights: {
      ecosystem_sustainability: 0.35,
      long_term_impact: 0.25,
      resource_efficiency: 0.25,
      community_benefit: 0.15,
    },
  },
};

function getProfile() {
  return AGENT_PROFILES[WORKER_ID] || AGENT_PROFILES.worker1;
}

function defaultManifesto(): AgentManifesto {
  const profile = getProfile();
  return {
    agentId: WORKER_ID,
    name: profile.name,
    role: profile.role,
    values: profile.values,
    guidelines: profile.guidelines,
  };
}

function defaultPreferences(): AgentPreferences {
  const profile = getProfile();
  return {
    agentId: WORKER_ID,
    votingWeights: profile.weights,
    knowledgeNotes: [],
    updatedAt: new Date().toISOString(),
  };
}

/* ─── Public API ──────────────────────────────────────────────────────────── */

/**
 * Initialize the agent's Nova identity. Creates group and seeds
 * default manifesto/preferences if this is the first run.
 */
export async function initializeIdentity(): Promise<void> {
  console.log(`[nova-identity] Initializing identity for ${WORKER_ID}...`);

  await ensureGroup();

  if (!isNovaAvailable()) {
    console.log(`[nova-identity] Nova unavailable, using default identity for ${WORKER_ID}`);
    return;
  }

  await loadRegistry();

  // Seed manifesto if not present
  if (!cidRegistry['manifesto.json']) {
    console.log(`[nova-identity] No manifesto found, seeding defaults...`);
    const manifesto = defaultManifesto();
    cidRegistry['manifesto.json'] = await uploadJson('manifesto.json', manifesto);
    await saveRegistry();
  }

  // Seed preferences if not present
  if (!cidRegistry['preferences.json']) {
    console.log(`[nova-identity] No preferences found, seeding defaults...`);
    const prefs = defaultPreferences();
    cidRegistry['preferences.json'] = await uploadJson('preferences.json', prefs);
    await saveRegistry();
  }

  console.log(`[nova-identity] Identity ready for ${WORKER_ID}`);
}

/**
 * Load the agent's full identity from Nova. Called before each deliberation
 * so the agent reasons with its latest memory.
 */
export async function loadIdentity(): Promise<AgentIdentity> {
  const manifesto = cidRegistry['manifesto.json']
    ? await retrieveJson<AgentManifesto>(cidRegistry['manifesto.json'])
    : defaultManifesto();

  const preferences = cidRegistry['preferences.json']
    ? await retrieveJson<AgentPreferences>(cidRegistry['preferences.json'])
    : defaultPreferences();

  // Load recent decision history (last 5)
  const historyKeys = Object.keys(cidRegistry)
    .filter(k => k.startsWith('history-'))
    .slice(-5);

  const recentDecisions: DecisionRecord[] = [];
  for (const key of historyKeys) {
    try {
      recentDecisions.push(await retrieveJson<DecisionRecord>(cidRegistry[key]));
    } catch {
      // Skip corrupted entries
    }
  }

  return { manifesto, preferences, recentDecisions };
}

/**
 * Format the agent identity as context for the AI model prompt.
 */
export function formatIdentityContext(identity: AgentIdentity): string {
  const { manifesto, preferences, recentDecisions } = identity;

  let context = `=== AGENT IDENTITY ===\n`;
  context += `Agent: ${manifesto.name} (${manifesto.agentId})\n`;
  context += `Role: ${manifesto.role}\n\n`;

  context += `Core Values:\n`;
  manifesto.values.forEach((v, i) => {
    context += `  ${i + 1}. ${v}\n`;
  });
  context += `\nGuidelines: ${manifesto.guidelines}\n`;

  context += `\nVoting Weights:\n`;
  for (const [factor, weight] of Object.entries(preferences.votingWeights)) {
    context += `  - ${factor.replace(/_/g, ' ')}: ${(weight * 100).toFixed(0)}%\n`;
  }

  if (preferences.knowledgeNotes.length > 0) {
    context += `\nAccumulated Knowledge:\n`;
    preferences.knowledgeNotes.forEach(note => {
      context += `  - ${note}\n`;
    });
  }

  if (recentDecisions.length > 0) {
    context += `\nRecent Decision History:\n`;
    recentDecisions.forEach(d => {
      context += `  - [${d.vote}] "${d.proposal.substring(0, 80)}..." (${d.timestamp})\n`;
    });
  }

  return context;
}

/**
 * Record a voting decision to Nova for persistent history.
 * Called after each successful vote.
 */
export async function recordDecision(
  proposalId: string,
  proposal: string,
  vote: 'Approved' | 'Rejected',
  reasoning: string,
): Promise<void> {
  if (!isNovaAvailable()) {
    console.log(`[nova-identity] Nova unavailable, skipping decision recording`);
    return;
  }
  const record: DecisionRecord = {
    proposalId,
    proposal,
    vote,
    reasoning,
    timestamp: new Date().toISOString(),
  };

  const filename = `history-${proposalId}.json`;
  cidRegistry[filename] = await uploadJson(filename, record);
  await saveRegistry();

  console.log(`[nova-identity] Recorded decision for proposal ${proposalId}: ${vote}`);
}

/**
 * Update the agent's manifesto (e.g. when a human feeds new values).
 */
export async function updateManifesto(
  updates: Partial<Omit<AgentManifesto, 'agentId'>>,
): Promise<AgentManifesto> {
  if (!isNovaAvailable()) {
    throw new Error('Nova is not available — cannot persist manifesto updates');
  }
  const current = cidRegistry['manifesto.json']
    ? await retrieveJson<AgentManifesto>(cidRegistry['manifesto.json'])
    : defaultManifesto();

  const updated = { ...current, ...updates, agentId: WORKER_ID };
  cidRegistry['manifesto.json'] = await uploadJson('manifesto.json', updated);
  await saveRegistry();

  console.log(`[nova-identity] Manifesto updated`);
  return updated;
}

/**
 * Add knowledge notes or update voting weights.
 */
export async function updatePreferences(
  updates: {
    addNotes?: string[];
    votingWeights?: Record<string, number>;
  },
): Promise<AgentPreferences> {
  if (!isNovaAvailable()) {
    throw new Error('Nova is not available — cannot persist preference updates');
  }
  const current = cidRegistry['preferences.json']
    ? await retrieveJson<AgentPreferences>(cidRegistry['preferences.json'])
    : defaultPreferences();

  if (updates.addNotes) {
    current.knowledgeNotes.push(...updates.addNotes);
  }
  if (updates.votingWeights) {
    current.votingWeights = { ...current.votingWeights, ...updates.votingWeights };
  }
  current.updatedAt = new Date().toISOString();

  cidRegistry['preferences.json'] = await uploadJson('preferences.json', current);
  await saveRegistry();

  console.log(`[nova-identity] Preferences updated`);
  return current;
}
