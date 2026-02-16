/**
 * Singleton ShadeClient instance for production mode (TEE/Phala).
 * Only initialized when not in LOCAL_MODE.
 */
import type { ShadeClient } from '@neardefi/shade-agent-js';

let _agent: ShadeClient | null = null;

export function setAgent(agent: ShadeClient): void {
  _agent = agent;
}

export function getAgent(): ShadeClient {
  if (!_agent) {
    throw new Error('ShadeClient not initialized — are you running in LOCAL_MODE?');
  }
  return _agent;
}
