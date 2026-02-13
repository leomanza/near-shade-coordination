import { Hono } from 'hono';
import {
  loadIdentity,
  updateManifesto,
  updatePreferences,
  formatIdentityContext,
} from '../nova/agent-identity';
import { diagnoseNova, isNovaAvailable, novaHealthInfo } from '../nova/nova-client';

const app = new Hono();

/**
 * GET /api/knowledge/identity
 * Get the agent's current identity (manifesto + preferences + recent history).
 */
app.get('/identity', async (c) => {
  try {
    const identity = await loadIdentity();
    return c.json({
      manifesto: identity.manifesto,
      preferences: identity.preferences,
      recentDecisions: identity.recentDecisions,
      formatted: formatIdentityContext(identity),
    });
  } catch (error) {
    return c.json(
      { error: 'Failed to load identity', details: error instanceof Error ? error.message : 'Unknown' },
      500,
    );
  }
});

/**
 * POST /api/knowledge/manifesto
 * Update the agent's manifesto. This is how a human or group shapes
 * what the agent cares about.
 *
 * Body: { name?, role?, values?: string[], guidelines?: string }
 */
app.post('/manifesto', async (c) => {
  try {
    const body = await c.req.json();
    const updated = await updateManifesto(body);
    return c.json({ message: 'Manifesto updated', manifesto: updated });
  } catch (error) {
    return c.json(
      { error: 'Failed to update manifesto', details: error instanceof Error ? error.message : 'Unknown' },
      500,
    );
  }
});

/**
 * POST /api/knowledge/feed
 * Feed knowledge to the agent. Adds notes to the agent's accumulated
 * knowledge and optionally adjusts voting weights.
 *
 * Body: {
 *   notes?: string[],       — knowledge notes to add
 *   votingWeights?: Record<string, number>  — adjust voting weight factors
 * }
 */
app.post('/feed', async (c) => {
  try {
    const body = await c.req.json();
    const { notes, votingWeights } = body;

    if (!notes && !votingWeights) {
      return c.json({ error: 'Provide at least "notes" or "votingWeights"' }, 400);
    }

    const updated = await updatePreferences({
      addNotes: notes,
      votingWeights,
    });

    return c.json({ message: 'Knowledge fed to agent', preferences: updated });
  } catch (error) {
    return c.json(
      { error: 'Failed to feed knowledge', details: error instanceof Error ? error.message : 'Unknown' },
      500,
    );
  }
});

/**
 * GET /api/knowledge/diagnose
 * Diagnose Nova SDK setup and connectivity.
 */
app.get('/diagnose', async (c) => {
  try {
    const diagnostics = await diagnoseNova();
    return c.json({
      novaAvailable: isNovaAvailable(),
      ...diagnostics,
    });
  } catch (error) {
    return c.json(
      { error: 'Diagnosis failed', details: error instanceof Error ? error.message : 'Unknown' },
      500,
    );
  }
});

/**
 * GET /api/knowledge/nova-health
 * Comprehensive Nova health check: balance, group info, transactions,
 * fees, shade key and prepare_upload probe.
 */
app.get('/nova-health', async (c) => {
  try {
    const health = await novaHealthInfo();
    return c.json(health);
  } catch (error) {
    return c.json(
      { error: 'Nova health check failed', details: error instanceof Error ? error.message : 'Unknown' },
      500,
    );
  }
});

export default app;
