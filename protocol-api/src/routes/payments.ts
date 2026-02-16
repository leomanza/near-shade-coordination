import { Hono } from 'hono';
import { EnsueClient, createEnsueClient } from '@near-shade-coordination/shared';

const app = new Hono();

const PINGPAY_API_URL = process.env.PINGPAY_API_URL || 'https://pay.pingpay.io/api';
const PINGPAY_API_KEY = process.env.PINGPAY_API_KEY || '';
const PINGPAY_WEBHOOK_SECRET = process.env.PINGPAY_WEBHOOK_SECRET || '';

let _ensueClient: EnsueClient | null = null;
function getEnsueClient(): EnsueClient {
  if (!_ensueClient) _ensueClient = createEnsueClient();
  return _ensueClient;
}

/**
 * POST /api/payments/checkout
 * Create a PingPay hosted checkout session
 */
app.post('/checkout', async (c) => {
  try {
    if (!PINGPAY_API_KEY) {
      return c.json({ error: 'PingPay API key not configured' }, 500);
    }

    const body = await c.req.json();
    const {
      amount,
      chain = 'NEAR',
      symbol = 'USDC',
      successUrl,
      cancelUrl,
      metadata,
    } = body;

    if (!amount || !successUrl || !cancelUrl) {
      return c.json({ error: 'amount, successUrl, and cancelUrl are required' }, 400);
    }

    const res = await fetch(`${PINGPAY_API_URL}/checkout/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': PINGPAY_API_KEY,
      },
      body: JSON.stringify({
        amount,
        asset: { chain, symbol },
        successUrl,
        cancelUrl,
        metadata: metadata || {},
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
      console.error('PingPay checkout error:', err);
      return c.json({ error: 'Failed to create checkout session', details: err }, res.status as any);
    }

    const data = await res.json() as {
      sessionUrl: string;
      session?: { sessionId: string; expiresAt?: string };
    };
    console.log('PingPay checkout session created:', data.session?.sessionId);

    return c.json({
      sessionUrl: data.sessionUrl,
      sessionId: data.session?.sessionId,
      expiresAt: data.session?.expiresAt,
    });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return c.json(
      { error: 'Failed to create checkout session', details: error instanceof Error ? error.message : 'Unknown' },
      500
    );
  }
});

/**
 * POST /api/payments/webhook
 * Receive PingPay webhook events
 */
app.post('/webhook', async (c) => {
  try {
    const signature = c.req.header('x-ping-signature');
    const timestamp = c.req.header('x-ping-timestamp');
    const rawBody = await c.req.text();

    if (PINGPAY_WEBHOOK_SECRET && signature && timestamp) {
      const { createHmac } = await import('crypto');
      const expected = createHmac('sha256', PINGPAY_WEBHOOK_SECRET)
        .update(`${timestamp}${rawBody}`)
        .digest('hex');
      if (expected !== signature) {
        console.warn('PingPay webhook signature mismatch');
        return c.json({ error: 'Invalid signature' }, 401);
      }
    }

    const event = JSON.parse(rawBody);
    console.log(`PingPay webhook received: ${event.type}`, {
      id: event.id,
      resourceId: event.resourceId,
      createdAt: event.createdAt,
    });

    try {
      const key = `coordination/payments/events/${event.id || Date.now()}`;
      await getEnsueClient().updateMemory(key, rawBody);
    } catch (e) {
      console.warn('Failed to store webhook event in Ensue:', e);
    }

    return c.json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return c.json(
      { error: 'Failed to process webhook', details: error instanceof Error ? error.message : 'Unknown' },
      500
    );
  }
});

export default app;
