import { Hono } from 'hono';
import {
  loadIdentity,
  formatIdentityContext,
} from '../storacha/agent-identity';
import { isStorachaConfigured, getAgentDid } from '../storacha/identity';

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
