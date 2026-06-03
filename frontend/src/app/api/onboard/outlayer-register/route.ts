import { NextRequest, NextResponse } from 'next/server';
import { proxyToOutlayer } from '../_constants';

/**
 * Path A: client sends `{}` → outlayer returns anonymous trial wallet w/ api_key.
 * Path B: client sends `{account_id, seed, pubkey, message, signature}` → bound.
 * Body passed through unchanged; no injection.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const res = await proxyToOutlayer('/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}
