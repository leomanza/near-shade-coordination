import { NextRequest, NextResponse } from 'next/server';
import { proxyToOutlayer } from '../_constants';

/**
 * Tell the outlayer coordinator to drop its cached `no_policy` flag for this
 * wallet so the next /wallet/v1/call sees the freshly-stored policy.
 */
export async function POST(req: NextRequest) {
  const { api_key, wallet_id } = await req.json();
  const res = await proxyToOutlayer('/wallet/v1/invalidate-cache', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify({ wallet_id }),
  });
  return new NextResponse(await res.text(), { status: res.status });
}
