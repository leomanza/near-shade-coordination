import dotenv from 'dotenv';
// Load environment variables BEFORE other imports trigger module init
dotenv.config({ path: '.env.development.local' });

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import taskRoute from './routes/task';
import knowledgeRoute from './routes/knowledge';
import { initializeWorker } from './workers/task-handler';

// Validate required environment variables
const required = ['ENSUE_API_KEY', 'WORKER_ID', 'PORT'];
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
    message: `Worker Agent 3 (${process.env.WORKER_ID}) is running`,
    status: 'healthy',
    workerId: process.env.WORKER_ID,
    timestamp: new Date().toISOString(),
  })
);

// Task routes
app.route('/api/task', taskRoute);

// Knowledge/identity routes (Nova-backed persistent memory)
app.route('/api/knowledge', knowledgeRoute);

// Start server
const port = Number(process.env.PORT || '3003');
console.log(`Worker Agent 3 (${process.env.WORKER_ID}) starting on port ${port}...`);
console.log(`Ensue API configured: ${process.env.ENSUE_API_KEY ? 'YES' : 'NO'}`);
console.log(`Nova SDK configured: ${process.env.NOVA_API_KEY ? 'YES' : 'NO'}`);

serve({ fetch: app.fetch, port }, async (info) => {
  console.log(`Worker Agent 3 running at http://localhost:${info.port}`);
  await initializeWorker();
});
