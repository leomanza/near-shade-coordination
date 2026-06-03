import { NextRequest, NextResponse } from 'next/server';
import { proxyToOutlayer } from '../_constants';

interface ReqBody {
  api_key: string;
  wallet_id: string;
  rules: Record<string, unknown>;
}

/**
 * Chain `/encrypt-policy` + `/sign-policy`. Returns the three fields the
 * browser needs to submit `store_wallet_policy` on outlayer.testnet:
 * { wallet_pubkey, encrypted_data, wallet_signature }.
 */
export async function POST(req: NextRequest) {
  const { api_key, wallet_id, rules }: ReqBody = await req.json();
  if (!api_key || !wallet_id || !rules) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  const encRes = await proxyToOutlayer('/wallet/v1/encrypt-policy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify({ wallet_id, rules }),
  });
  if (!encRes.ok) return new NextResponse(await encRes.text(), { status: encRes.status });
  const { encrypted_base64 } = await encRes.json();

  const signRes = await proxyToOutlayer('/wallet/v1/sign-policy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify({ encrypted_data: encrypted_base64 }),
  });
  if (!signRes.ok) return new NextResponse(await signRes.text(), { status: signRes.status });
  const { signature_hex, public_key_hex } = await signRes.json();

  return NextResponse.json({
    wallet_pubkey: `ed25519:${public_key_hex}`,
    encrypted_data: encrypted_base64,
    wallet_signature: signature_hex,
  });
}
