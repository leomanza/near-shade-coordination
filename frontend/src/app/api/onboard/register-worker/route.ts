import { NextRequest, NextResponse } from 'next/server';
import { proxyToOutlayer } from '../_constants';

interface ReqBody {
  api_key: string;
  worker_did: string;
  endpoint_url: string;
  cvm_id: string;
  registry_contract_id: string;
  /**
   * Optional V3.1.1 controller pubkey (base58-encoded 32-byte ed25519). When
   * present, calls `register_worker_with_controller` so the worker can later
   * be deactivated via `deactivate_worker_by_controller` (sovereign-deactivation,
   * no admin/registrant signature required). When omitted, falls back to the
   * 3-arg legacy `register_worker` for backward compatibility.
   */
  controller_pubkey?: string;
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
    controller_pubkey,
  }: ReqBody = await req.json();

  if (!api_key || !worker_did || !endpoint_url || !cvm_id || !registry_contract_id) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 });
  }

  // Pick the contract method based on whether the caller wants V3.1.1
  // sovereign-deactivation enabled for the new worker.
  const method_name = controller_pubkey
    ? 'register_worker_with_controller'
    : 'register_worker';
  const args: Record<string, string> = { worker_did, endpoint_url, cvm_id };
  if (controller_pubkey) args.controller_pubkey = controller_pubkey;

  const res = await proxyToOutlayer('/wallet/v1/call', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${api_key}`,
    },
    body: JSON.stringify({
      receiver_id: registry_contract_id,
      method_name,
      args,
      deposit: REGISTER_DEPOSIT_YOCTO,
      gas: REGISTER_GAS,
    }),
  });
  return new NextResponse(await res.text(), { status: res.status });
}
