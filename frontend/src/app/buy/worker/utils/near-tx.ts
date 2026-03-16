/**
 * Build and broadcast a register_worker transaction via NEAR wallet.
 *
 * Uses @hot-labs/near-connect to sign the transaction in the user's wallet.
 */

const NEAR_NETWORK = process.env.NEXT_PUBLIC_NEAR_NETWORK || "testnet";
const REGISTRY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID ||
  "registry.agents-coordinator.testnet";

export interface RegisterWorkerParams {
  coordinatorDid: string;
  workerDid: string;
  endpointUrl: string;
  cvmId: string;
}

/**
 * Build the register_worker function call action for wallet signing.
 * Returns the transaction params that can be passed to near-connect.
 */
export function buildRegisterWorkerAction(params: RegisterWorkerParams) {
  return {
    receiverId: REGISTRY_CONTRACT_ID,
    actions: [
      {
        type: "FunctionCall" as const,
        params: {
          methodName: "register_worker",
          args: {
            coordinator_did: params.coordinatorDid,
            worker_did: params.workerDid,
            endpoint_url: params.endpointUrl,
            cvm_id: params.cvmId,
          },
          gas: "200000000000000", // 200 TGas
          deposit: "100000000000000000000000", // 0.1 NEAR
        },
      },
    ],
  };
}
