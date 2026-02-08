import { Hono } from 'hono';
import { executeTask, getTaskStatus } from '../workers/task-handler';
import type { TaskConfig } from '../../../shared/src/types';

const app = new Hono();

/**
 * POST /api/task/execute
 * Start executing a task
 *
 * Body: { taskConfig: TaskConfig }
 * Returns: { message: string, worker: string }
 */
app.post('/execute', async (c) => {
  try {
    const body = await c.req.json();
    const taskConfig: TaskConfig = body.taskConfig;

    if (!taskConfig) {
      return c.json({ error: 'taskConfig is required' }, 400);
    }

    // Execute task asynchronously (don't block response)
    executeTask(taskConfig).catch((err) => {
      console.error('Task execution failed:', err);
    });

    return c.json({
      message: 'Task started',
      worker: process.env.WORKER_ID || 'worker1',
      taskType: taskConfig.type,
    });
  } catch (error) {
    console.error('Error starting task:', error);
    return c.json(
      {
        error: 'Failed to start task',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/task/status
 * Get current task status from Ensue
 *
 * Returns: { status: TaskStatus, timestamp?: number }
 */
app.get('/status', async (c) => {
  try {
    const statusInfo = await getTaskStatus();
    return c.json(statusInfo);
  } catch (error) {
    console.error('Error getting status:', error);
    return c.json(
      {
        error: 'Failed to get status',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/task/health
 * Health check for worker agent
 */
app.get('/health', (c) =>
  c.json({
    healthy: true,
    worker: process.env.WORKER_ID || 'worker1',
    timestamp: new Date().toISOString(),
  })
);

export default app;
