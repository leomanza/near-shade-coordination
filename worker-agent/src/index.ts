import dotenv from 'dotenv';
// Load environment variables BEFORE other imports trigger module init
dotenv.config({ path: '.env.development.local' });

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import taskRoute from './routes/task';
import knowledgeRoute from './routes/knowledge';
import { initializeWorker, startWorkerPollingLoop, getWorkerDID } from './workers/task-handler';

const app = new Hono();

// Enable CORS
app.use(cors());

// Health check endpoint — returns DID-based identity (no WORKER_ID needed)
app.get('/', async (c) => {
  let workerDID: string | null = null;
  try { workerDID = getWorkerDID(); } catch { /* not yet initialized */ }

  return c.json({
    message: `Worker Agent is running`,
    status: 'healthy',
    workerDid: workerDID,
    port: process.env.PORT || '3001',
    timestamp: new Date().toISOString(),
  });
});

// Task routes
app.route('/api/task', taskRoute);

// Knowledge/identity routes (Storacha-backed persistent identity)
app.route('/api/knowledge', knowledgeRoute);

// Start server
const port = Number(process.env.PORT || '3001');
console.log(`Worker Agent starting on port ${port}...`);
console.log(`Ensue API configured: ${process.env.ENSUE_API_KEY ? 'YES' : 'NO'}`);
console.log(`Storacha configured: ${process.env.STORACHA_AGENT_PRIVATE_KEY ? 'YES' : 'NO'}`);
console.log(`Registry: ${process.env.REGISTRY_CONTRACT_ID || 'not configured'}`);
console.log(`Coordinator DID: ${process.env.COORDINATOR_DID || 'not set'}`);

serve({ fetch: app.fetch, port }, async (info) => {
  console.log(`Worker Agent running at http://localhost:${info.port}`);
  // initializeWorker() derives DID, sets idle status, and self-registers in registry
  await initializeWorker();
  // Poll Ensue for pending tasks so workers self-trigger in Phala production
  startWorkerPollingLoop();
});
