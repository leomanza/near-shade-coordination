/**
 * Type definitions for @neardefi/shade-agent-js
 * Following verifiable-ai-dao/src/shade-agent-js.d.ts
 */

declare module '@neardefi/shade-agent-js' {
  /**
   * Get agent info including registration checksum
   */
  export function agentInfo(): Promise<{
    checksum: string | null;
  }>;

  /**
   * Call a view function on the contract (read-only)
   */
  export function agentView<T = any>(params: {
    methodName: string;
    args: Record<string, any>;
  }): Promise<T>;

  /**
   * Call a mutation function on the contract (writes to blockchain)
   */
  export function agentCall<T = any>(params: {
    methodName: string;
    args: Record<string, any>;
    gas?: string;
    deposit?: string;
  }): Promise<T>;
}
