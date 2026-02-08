import dotenv from 'dotenv';
// Load environment variables BEFORE other imports trigger module init
dotenv.config({ path: '.env.development.local' });

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { startCoordinationLoop, startLocalCoordinationLoop } from './monitor/memory-monitor';
import coordinateRoute from './routes/coordinate';

const LOCAL_MODE = process.env.LOCAL_MODE === 'true';

// Validate required environment variables
const required = LOCAL_MODE
  ? ['ENSUE_API_KEY']
  : ['ENSUE_API_KEY', 'NEAR_ACCOUNT_ID', 'NEAR_SEED_PHRASE', 'NEXT_PUBLIC_contractId'];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`ERROR: Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const app = new Hono();

// Enable CORS
app.use(cors());

// Health check endpoint
app.get('/', (c) =>
  c.json({
    message: 'Coordinator Agent is running',
    status: 'healthy',
    localMode: LOCAL_MODE,
    contractId: process.env.NEXT_PUBLIC_contractId || 'N/A (local mode)',
    timestamp: new Date().toISOString(),
  })
);

// Coordination routes
app.route('/api/coordinate', coordinateRoute);

// Start server
const port = Number(process.env.PORT || '3000');
console.log('Coordinator Agent starting on port', port);
console.log('Mode:', LOCAL_MODE ? 'LOCAL (no TEE/contract)' : 'PRODUCTION');
console.log('Contract ID:', process.env.NEXT_PUBLIC_contractId || 'N/A');
console.log('Ensue API configured:', process.env.ENSUE_API_KEY ? 'YES' : 'NO');

serve({ fetch: app.fetch, port }, async (info) => {
  console.log(`\nCoordinator Agent HTTP server running at http://localhost:${info.port}`);

  if (LOCAL_MODE) {
    console.log('\n[LOCAL MODE] Skipping TEE registration');
    console.log('[LOCAL MODE] Starting local coordination loop (Ensue-only)...');
    console.log('[LOCAL MODE] Use POST /api/coordinate/trigger to start a coordination\n');
    startLocalCoordinationLoop();
  } else {
    // Wait for agent registration (following verifiable-ai-dao/src/index.ts:18-24)
    const { agentInfo } = await import('@neardefi/shade-agent-js');
    console.log('\nWaiting for agent registration...');
    while (true) {
      try {
        const res = await agentInfo();
        if (res.checksum) {
          console.log('Agent registered with checksum:', res.checksum);
          break;
        }
      } catch (error) {
        console.error('Error checking agent info:', error);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log('\nStarting coordination loop...');
    startCoordinationLoop();
  }
});
