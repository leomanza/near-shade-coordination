const FACTORY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_FACTORY_CONTRACT_ID ||
  "coord-factory.agents-coordinator.testnet";

const REGISTRY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID ||
  "registry.agents-coordinator.testnet";

/** Tx #1: Deploy coordinator contract via factory */
export function buildCreateCoordinatorAction(params: {
  prefix: string;
  minWorkers: number;
  maxWorkers: number;
}) {
  return {
    receiverId: FACTORY_CONTRACT_ID,
    actions: [
      {
        type: "FunctionCall" as const,
        params: {
          methodName: "create_coordinator",
          args: {
            prefix: params.prefix,
            min_workers: params.minWorkers,
            max_workers: params.maxWorkers,
          },
          gas: "100000000000000", // 100 TGas (factory embeds deploy + init)
          deposit: "3000000000000000000000000", // 3 NEAR for account + storage
        },
      },
    ],
  };
}

/** Tx #2: Register coordinator on registry */
export function buildRegisterCoordinatorAction(params: {
  coordinatorDid: string;
  endpointUrl: string;
  cvmId: string;
  minWorkers: number;
  maxWorkers: number;
}) {
  return {
    receiverId: REGISTRY_CONTRACT_ID,
    actions: [
      {
        type: "FunctionCall" as const,
        params: {
          methodName: "register_coordinator",
          args: {
            coordinator_did: params.coordinatorDid,
            endpoint_url: params.endpointUrl,
            cvm_id: params.cvmId,
            min_workers: params.minWorkers,
            max_workers: params.maxWorkers,
          },
          gas: "200000000000000", // 200 TGas
          deposit: "100000000000000000000000", // 0.1 NEAR
        },
      },
    ],
  };
}

/** Derive coordinator contract address from factory call result */
export function deriveContractAddress(prefix: string): string {
  return `${prefix}.${FACTORY_CONTRACT_ID}`;
}
