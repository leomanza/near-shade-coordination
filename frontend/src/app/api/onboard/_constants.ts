/**
 * Shared constants + fetch helper for the onboarding API proxies.
 *
 * IMPORTANT: api_keys flow browser → these proxies → outlayer. The proxies
 * MUST NOT log Authorization headers or request bodies that may contain
 * api_keys. The whole point of the browser-holds-the-key model is that the
 * server stays stateless and uncustodial.
 *
 * Host is the TESTNET outlayer wallet-custody API (not the SDK's wrong URL).
 * Confirmed working 2026-06-03 — see reference_outlayer_ecosystem.md memory.
 */

export const OUTLAYER_HOST = 'https://testnet-api.outlayer.fastnear.com';

export async function proxyToOutlayer(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 15_000);
  try {
    return await fetch(OUTLAYER_HOST + path, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timeout);
  }
}
