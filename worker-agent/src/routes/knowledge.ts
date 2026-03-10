import { Hono } from 'hono';
import {
  loadIdentity,
  formatIdentityContext,
} from '../storacha/agent-identity';
import { isStorachaConfigured, getAgentDid } from '../storacha/identity';
import { getProfileClient } from '../storacha/profile-client';

const app = new Hono();

/**
 * GET /api/knowledge/identity
 * Get the agent's current identity (manifesto + preferences + recent history).
 */
app.get('/identity', async (c) => {
  try {
    const identity = await loadIdentity();
    const did = isStorachaConfigured() ? await getAgentDid() : null;
    return c.json({
      manifesto: identity.manifesto,
      preferences: identity.preferences,
      recentDecisions: identity.recentDecisions,
      formatted: formatIdentityContext(identity),
      storacha: {
        configured: isStorachaConfigured(),
        agentDid: did,
        spaceDid: process.env.STORACHA_SPACE_DID || null,
      },
    });
  } catch (error) {
    return c.json(
      { error: 'Failed to load identity', details: error instanceof Error ? error.message : 'Unknown' },
      500,
    );
  }
});

/**
 * POST /api/knowledge/feed
 * Feed knowledge notes to the agent. Persists to Storacha.
 */
app.post('/feed', async (c) => {
  try {
    const body = await c.req.json<{ notes?: string[]; votingWeights?: Record<string, number> }>();
    const client = await getProfileClient();

    // Append knowledge notes
    if (body.notes && body.notes.length > 0) {
      for (const note of body.notes) {
        await client.appendKnowledgeNote(note);
      }
    }

    // Update voting weights if provided
    if (body.votingWeights) {
      const prefs = await client.getPreferences();
      const updated = {
        ...prefs,
        votingWeights: { ...prefs.votingWeights, ...body.votingWeights },
        updatedAt: new Date().toISOString(),
      };
      await client.savePreferences(updated);
    }

    const preferences = await client.getPreferences();
    const knowledge = await client.getKnowledgeNotes();

    return c.json({
      message: `Knowledge fed: ${body.notes?.length || 0} notes`,
      preferences: { ...preferences, knowledgeNotes: knowledge },
    });
  } catch (error) {
    return c.json(
      { error: 'Failed to feed knowledge', details: error instanceof Error ? error.message : 'Unknown' },
      500,
    );
  }
});

/**
 * POST /api/knowledge/manifesto
 * Update the agent's manifesto. Persists to Storacha.
 */
app.post('/manifesto', async (c) => {
  try {
    const updates = await c.req.json<{ name?: string; role?: string; guidelines?: string; values?: string[] }>();
    const client = await getProfileClient();
    const current = await client.getManifesto();

    const updated = {
      ...current,
      ...(updates.name !== undefined && { name: updates.name }),
      ...(updates.role !== undefined && { role: updates.role }),
      ...(updates.guidelines !== undefined && { guidelines: updates.guidelines }),
      ...(updates.values !== undefined && { values: updates.values }),
    };

    await client.saveManifesto(updated);

    return c.json({
      message: 'Manifesto updated',
      manifesto: updated,
    });
  } catch (error) {
    return c.json(
      { error: 'Failed to update manifesto', details: error instanceof Error ? error.message : 'Unknown' },
      500,
    );
  }
});

/**
 * GET /api/knowledge/health
 * Agent identity health check.
 */
app.get('/health', async (c) => {
  try {
    const did = isStorachaConfigured() ? await getAgentDid() : null;
    return c.json({
      storachaConfigured: isStorachaConfigured(),
      agentDid: did,
      spaceDid: process.env.STORACHA_SPACE_DID || null,
    });
  } catch (error) {
    return c.json(
      { error: 'Health check failed', details: error instanceof Error ? error.message : 'Unknown' },
      500,
    );
  }
});

export default app;
