import { Hono } from 'hono';
import {
  localRegisterWorker,
  localRemoveWorker,
  localGetRegisteredWorkers,
  localGetWorkerCount,
} from '../contract/local-contract';

const app = new Hono();

/**
 * GET /api/workers/registered
 * Get all registered workers from the on-chain contract
 */
app.get('/registered', async (c) => {
  try {
    const workers = await localGetRegisteredWorkers();
    const count = await localGetWorkerCount();
    return c.json({ workers, activeCount: count });
  } catch (error) {
    console.error('Error getting registered workers:', error);
    return c.json(
      { error: 'Failed to get registered workers', details: error instanceof Error ? error.message : 'Unknown' },
      500
    );
  }
});

/**
 * POST /api/workers/register
 * Register a new worker on-chain
 */
app.post('/register', async (c) => {
  try {
    const { workerId, accountId } = await c.req.json();
    if (!workerId) {
      return c.json({ error: 'workerId is required' }, 400);
    }

    const success = await localRegisterWorker(workerId, accountId);
    if (success) {
      return c.json({ message: `Worker ${workerId} registered`, workerId, accountId: accountId || null });
    }
    return c.json({ error: `Failed to register worker ${workerId}` }, 500);
  } catch (error) {
    console.error('Error registering worker:', error);
    return c.json(
      { error: 'Failed to register worker', details: error instanceof Error ? error.message : 'Unknown' },
      500
    );
  }
});

/**
 * DELETE /api/workers/:workerId
 * Remove a worker from the on-chain registry
 */
app.delete('/:workerId', async (c) => {
  try {
    const workerId = c.req.param('workerId');
    const success = await localRemoveWorker(workerId);
    if (success) {
      return c.json({ message: `Worker ${workerId} removed` });
    }
    return c.json({ error: `Failed to remove worker ${workerId}` }, 500);
  } catch (error) {
    console.error('Error removing worker:', error);
    return c.json(
      { error: 'Failed to remove worker', details: error instanceof Error ? error.message : 'Unknown' },
      500
    );
  }
});

export default app;
