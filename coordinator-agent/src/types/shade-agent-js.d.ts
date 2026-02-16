declare module '@neardefi/shade-agent-js' {
  import { Provider } from '@near-js/providers';
  import { SerializedReturnValue, BlockReference, TxExecutionStatus } from '@near-js/types';

  export interface ShadeConfig {
    networkId?: 'testnet' | 'mainnet';
    agentContractId?: string;
    sponsor?: {
      accountId: string;
      privateKey: string;
    };
    rpc?: Provider;
    numKeys?: number;
    derivationPath?: string;
  }

  export class ShadeClient {
    static create(config: ShadeConfig): Promise<ShadeClient>;
    accountId(): string;
    balance(): Promise<number>;
    register(): Promise<boolean>;
    fund(amount: number): Promise<void>;
    isWhitelisted(): Promise<boolean | null>;
    view<T extends SerializedReturnValue>(params: {
      methodName: string;
      args: Record<string, unknown>;
      blockQuery?: BlockReference;
    }): Promise<T>;
    call<T extends SerializedReturnValue>(params: {
      methodName: string;
      args: Uint8Array | Record<string, any>;
      deposit?: bigint | string | number;
      gas?: bigint | string | number;
      waitUntil?: TxExecutionStatus;
    }): Promise<T>;
    getAttestation(): Promise<any>;
    getPrivateKeys(params: { acknowledgeRisk: true }): string[];
  }
}
