/**
 * Agent Identity — Storacha-backed persistent identity for worker agents.
 *
 * Profile data (manifesto, values, voting weights) is loaded via
 * StorachaProfileClient, which persists decisions to Ensue + Storacha.
 * Falls back to profiles.json + in-memory storage when Storacha is not configured.
 *
 * The agent's sovereign identity is its `did:key` from Storacha.
 */

import { isStorachaConfigured, getAgentDid } from './identity';
import { getProfileClient } from './profile-client';

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

/* ─── Public API ──────────────────────────────────────────────────────────── */

export async function initializeIdentity(): Promise<void> {
  // Warm up the profile client singleton
  const client = await getProfileClient();

  if (isStorachaConfigured()) {
    const did = await getAgentDid();
    console.log(`[identity] Worker ${WORKER_ID} identity ready (DID: ${did}, Storacha-backed)`);
  } else {
    console.log(`[identity] Worker ${WORKER_ID} using local fallback (Storacha not configured)`);
  }

  // Pre-load identity to cache it
  const identity = await client.loadIdentity();
  console.log(`[identity] Worker ${WORKER_ID} profile loaded: ${identity.manifesto.name} (${identity.manifesto.role}), ${identity.recentDecisions.length} past decisions`);
}

export async function loadIdentity(): Promise<AgentIdentity> {
  const client = await getProfileClient();
  return client.loadIdentity();
}

export function formatIdentityContext(identity: AgentIdentity): string {
  const { manifesto, preferences, recentDecisions: decisions } = identity;

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

  if (decisions.length > 0) {
    context += `\nRecent Decision History:\n`;
    decisions.forEach(d => {
      context += `  - [${d.vote}] "${d.proposal.substring(0, 80)}..." (${d.timestamp})\n`;
    });
  }

  return context;
}

/**
 * Record a decision to persistent storage.
 * Returns the Storacha CID if encrypted backup succeeded, or null.
 */
export async function recordDecision(
  proposalId: string,
  proposal: string,
  vote: 'Approved' | 'Rejected',
  reasoning: string,
): Promise<string | null> {
  const record: DecisionRecord = {
    proposalId,
    proposal,
    vote,
    reasoning,
    timestamp: new Date().toISOString(),
  };

  const client = await getProfileClient();
  const cid = await client.saveDecision(record);

  console.log(`[identity] Recorded decision for proposal ${proposalId}: ${vote}${cid ? ` (CID: ${cid})` : ''}`);
  return cid;
}
