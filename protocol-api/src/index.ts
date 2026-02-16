import dotenv from 'dotenv';
dotenv.config({ path: '.env.development.local' });

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import deployRoute from './routes/deploy';
import agentsRoute from './routes/agents';
import workersRoute from './routes/workers';
import paymentsRoute from './routes/payments';

const app = new Hono();
app.use(cors());

app.get('/', (c) =>
  c.json({
    message: 'Delibera Protocol API running',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  })
);

app.route('/api/deploy', deployRoute);
app.route('/api/agents', agentsRoute);
app.route('/api/workers', workersRoute);
app.route('/api/payments', paymentsRoute);

const port = Number(process.env.PORT || '3005');
console.log('Protocol API starting on port', port);

serve({ fetch: app.fetch, port }, () => {
  console.log(`Protocol API running at http://localhost:${port}`);
});
