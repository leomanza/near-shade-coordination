import dotenv from 'dotenv';
// Load environment variables BEFORE other imports trigger module init
dotenv.config({ path: '.env.development.local' });

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { startCoordinationLoop, startLocalCoordinationLoop } from './monitor/memory-monitor';
import coordinateRoute from './routes/coordinate';

const LOCAL_MODE = process.env.LOCAL_MODE === 'true';

// Check required env vars — warn but don't crash (server should always start for health checks)
const SHADE_AGENT_CONFIGURED = !!(
  process.env.AGENT_CONTRACT_ID &&
  process.env.SPONSOR_ACCOUNT_ID &&
  process.env.SPONSOR_PRIVATE_KEY
);

if (!process.env.ENSUE_API_KEY) {
  console.warn('WARNING: ENSUE_API_KEY is not set — Ensue-based coordination will not work');
}
if (!LOCAL_MODE && !SHADE_AGENT_CONFIGURED) {
  console.warn('WARNING: AGENT_CONTRACT_ID / SPONSOR_ACCOUNT_ID / SPONSOR_PRIVATE_KEY not set');
  console.warn('WARNING: ShadeClient will not initialize — on-chain coordination disabled');
  console.warn('WARNING: Server will start in degraded mode (health check only)');
}

const app = new Hono();

// Enable CORS
app.use(cors());

// Health check endpoint
app.get('/', (c) => {
  const mode = LOCAL_MODE ? 'local' : SHADE_AGENT_CONFIGURED ? 'production' : 'degraded';
  return c.json({
    message: 'Coordinator Agent is running',
    status: mode === 'degraded' ? 'degraded' : 'healthy',
    mode,
    contractId: process.env.AGENT_CONTRACT_ID || process.env.NEXT_PUBLIC_contractId || 'N/A',
    timestamp: new Date().toISOString(),
  });
});

// Coordination routes
app.route('/api/coordinate', coordinateRoute);

/**
 * Initialize ShadeClient, fund, register, and start coordination loop.
 * Extracted so errors don't crash the HTTP server.
 */
async function initShadeAgent(): Promise<void> {
  const { ShadeClient } = await import('@neardefi/shade-agent-js');
  const { setAgent } = await import('./shade-client');

  const networkId = (process.env.NEAR_NETWORK || 'testnet') as 'testnet' | 'mainnet';
  const agentContractId = process.env.AGENT_CONTRACT_ID!;
  const sponsorAccountId = process.env.SPONSOR_ACCOUNT_ID!;
  const sponsorPrivateKey = process.env.SPONSOR_PRIVATE_KEY!;

  console.log('\nInitializing ShadeClient...');
  console.log('Network:', networkId);
  console.log('Agent contract:', agentContractId);
  console.log('Sponsor:', sponsorAccountId);

  const agent = await ShadeClient.create({
    networkId,
    agentContractId,
    sponsor: {
      accountId: sponsorAccountId,
      privateKey: sponsorPrivateKey,
    },
    derivationPath: sponsorPrivateKey, // Deterministic key for local; TEE entropy used in production
  });

  console.log('Agent account ID:', agent.accountId());
  setAgent(agent);

  // Fund agent if low balance
  const balance = await agent.balance();
  console.log('Agent balance:', balance, 'NEAR');
  if (balance < 0.2) {
    console.log('Funding agent...');
    await agent.fund(0.3);
    console.log('Agent funded');
  }

  // Register agent (retry loop like template)
  console.log('\nRegistering agent...');
  while (true) {
    try {
      const isWhitelisted = await agent.isWhitelisted();
      if (isWhitelisted === null || isWhitelisted) {
        const registered = await agent.register();
        if (registered) {
          console.log('Agent registered successfully');
          break;
        }
      } else {
        console.log('Agent not whitelisted yet. Whitelist account:', agent.accountId());
      }
    } catch (error) {
      console.error('Registration error:', error);
    }
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  // Re-register every 6 days
  const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
  setInterval(async () => {
    try {
      const registered = await agent.register();
      if (registered) console.log('Agent re-registered');
    } catch (error) {
      console.error('Error re-registering agent:', error);
    }
  }, SIX_DAYS_MS);

  console.log('\nStarting coordination loop...');
  startCoordinationLoop();
}

// Start server
const port = Number(process.env.PORT || '3000');
console.log('Coordinator Agent starting on port', port);
console.log('Mode:', LOCAL_MODE ? 'LOCAL (no TEE/contract)' : 'PRODUCTION');
console.log('Contract ID:', process.env.AGENT_CONTRACT_ID || process.env.NEXT_PUBLIC_contractId || 'N/A');
console.log('Ensue API configured:', process.env.ENSUE_API_KEY ? 'YES' : 'NO');

serve({ fetch: app.fetch, port }, async (info) => {
  console.log(`\nCoordinator Agent HTTP server running at http://localhost:${info.port}`);

  if (LOCAL_MODE) {
    console.log('\n[LOCAL MODE] Skipping TEE registration');
    console.log('[LOCAL MODE] Starting local coordination loop (Ensue-only)...');
    console.log('[LOCAL MODE] Use POST /api/coordinate/trigger to start a coordination\n');
    startLocalCoordinationLoop();
  } else if (SHADE_AGENT_CONFIGURED) {
    // Initialize ShadeClient (v2 pattern from shade-agent-template 2.0)
    // Run in background so the HTTP server stays responsive during init
    initShadeAgent().catch((err) => {
      console.error('ShadeClient initialization failed:', err);
      console.error('Server will keep running but coordination will not work until agent is registered.');
    });
  } else {
    console.warn('\n[DEGRADED] Missing ShadeClient config — server running for health checks only');
    console.warn('[DEGRADED] Set AGENT_CONTRACT_ID, SPONSOR_ACCOUNT_ID, SPONSOR_PRIVATE_KEY to enable coordination');
  }
});
