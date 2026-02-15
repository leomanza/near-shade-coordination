import {
  ensureGroup,
  uploadJson,
  retrieveJson,
  listGroupTransactions,
  isNovaAvailable,
} from './nova-client';
import * as fs from 'fs';
import * as path from 'path';

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

const cidRegistry: Record<string, string> = {};

async function loadRegistry(): Promise<void> {
  try {
    const txs = await listGroupTransactions();
    const registryTxs = txs.filter(tx => tx.file_hash);
    if (registryTxs.length > 0) {
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
  console.log(`[nova-identity] Saved CID registry -> ${cid}`);
}

/* ─── Profile Loading ─────────────────────────────────────────────────────── */

interface AgentProfile {
  name: string;
  role: string;
  values: string[];
  guidelines: string;
  weights: Record<string, number>;
}

/**
 * Load agent profiles from config/profiles.json.
 * Falls back to a generic default if the file doesn't exist or WORKER_ID not found.
 */
function loadProfiles(): Record<string, AgentProfile> {
  try {
    const profilesPath = path.join(__dirname, '../../config/profiles.json');
    const raw = fs.readFileSync(profilesPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

const GENERIC_PROFILE: AgentProfile = {
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

function getProfile(): AgentProfile {
  const profiles = loadProfiles();
  return profiles[WORKER_ID] || GENERIC_PROFILE;
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

export async function initializeIdentity(): Promise<void> {
  console.log(`[nova-identity] Initializing identity for ${WORKER_ID}...`);

  await ensureGroup();

  if (!isNovaAvailable()) {
    console.log(`[nova-identity] Nova unavailable, using default identity for ${WORKER_ID}`);
    return;
  }

  await loadRegistry();

  if (!cidRegistry['manifesto.json']) {
    console.log(`[nova-identity] No manifesto found, seeding defaults...`);
    const manifesto = defaultManifesto();
    cidRegistry['manifesto.json'] = await uploadJson('manifesto.json', manifesto);
    await saveRegistry();
  }

  if (!cidRegistry['preferences.json']) {
    console.log(`[nova-identity] No preferences found, seeding defaults...`);
    const prefs = defaultPreferences();
    cidRegistry['preferences.json'] = await uploadJson('preferences.json', prefs);
    await saveRegistry();
  }

  console.log(`[nova-identity] Identity ready for ${WORKER_ID}`);
}

export async function loadIdentity(): Promise<AgentIdentity> {
  const manifesto = cidRegistry['manifesto.json']
    ? await retrieveJson<AgentManifesto>(cidRegistry['manifesto.json'])
    : defaultManifesto();

  const preferences = cidRegistry['preferences.json']
    ? await retrieveJson<AgentPreferences>(cidRegistry['preferences.json'])
    : defaultPreferences();

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

  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));

  await saveRegistry();

  console.log(`[nova-identity] Recorded decision for proposal ${proposalId}: ${vote}`);
}

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

  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));

  await saveRegistry();

  console.log(`[nova-identity] Manifesto updated`);
  return updated;
}

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

  await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 500));

  await saveRegistry();

  console.log(`[nova-identity] Preferences updated`);
  return current;
}
