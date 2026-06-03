import { NextRequest, NextResponse } from 'next/server';
import { proxyToOutlayer } from '../_constants';

interface ReqBody {
  api_key: string;
  worker_did: string;
  endpoint_url: string;
  cvm_id: string;
  registry_contract_id: string;
}

const REGISTER_DEPOSIT_YOCTO = '100000000000000000000000'; // 0.1 NEAR
const REGISTER_GAS = '50000000000000'; // 50 Tgas

/**
 * The autonomous call. Outlayer's TEE signs `register_worker(...)` and
 * broadcasts on testnet. No user wallet signature involved at this step.
 */
export async function POST(req: NextRequest) {
  const {
    api_key,
    worker_did,
    endpoint_url,
    cvm_id,
    registry_contract_id,
  }: ReqBody = await req.json();

  if (!api_key || !worker_did || !endpoint_url || !cvm_id || !registry_contract_id) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  const res = await proxyToOutlayer('/wallet/v1/call', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify({
      receiver_id: registry_contract_id,
      method_name: 'register_worker',
      args: { worker_did, endpoint_url, cvm_id },
      deposit: REGISTER_DEPOSIT_YOCTO,
      gas: REGISTER_GAS,
    }),
  });
  return new NextResponse(await res.text(), { status: res.status });
}
