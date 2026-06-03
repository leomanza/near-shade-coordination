"use client";
import { useState } from "react";
import type { AuthState } from "@/lib/auth";
import { onboardOutlayer } from "../lib/outlayer-client-browser";
import { buildDefaultPolicy } from "../lib/policy-builder";
import type { OnboardingApi } from "../hooks/useOutlayerOnboarding";

const KEYSTORE_CONTRACT = "outlayer.testnet";
const REGISTRY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID || "registry.agents-coordinator.testnet";

interface Props {
  onboard: OnboardingApi;
  auth: AuthState;
}

interface SignAndSendResult {
  transaction?: { hash?: string };
}

export default function PolicyScreen({ onboard, auth }: Props) {
  const [busy, setBusy] = useState(false);

  async function handleCommit() {
    if (!onboard.state.wallet) return;
    setBusy(true);
    onboard.setError(undefined);
    try {
      const rules = buildDefaultPolicy(REGISTRY_CONTRACT_ID);
      const policy = await onboardOutlayer.encryptAndSignPolicy(
        onboard.state.wallet.api_key,
        onboard.state.wallet.wallet_id,
        rules as unknown as Record<string, unknown>,
      );

      const result = (await auth.signAndSendTransaction({
        receiverId: KEYSTORE_CONTRACT,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "store_wallet_policy",
              args: policy as unknown as Record<string, unknown>,
              gas: "100000000000000", // 100 Tgas
              deposit: "1000000000000000000000", // 0.001 NEAR
            },
          },
        ],
      })) as SignAndSendResult;

      onboard.dispatch({
        type: "set_policy_tx",
        tx_hash: result?.transaction?.hash ?? "unknown",
      });

      await onboardOutlayer.invalidateCache(
        onboard.state.wallet.api_key,
        onboard.state.wallet.wallet_id,
      );

      onboard.advance("autonomous");
    } catch (e: unknown) {
      onboard.setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">Commit policy on-chain</h1>
      <p className="mt-2 text-gray-600">
        One small NEAR transaction (≈ 0.001 NEAR storage) tells the outlayer
        keystore which contracts your wallet is allowed to call. After this,
        your agent self-registers without any further signing.
      </p>

      <div className="mt-4 rounded bg-gray-50 p-4 text-sm">
        <h3 className="font-semibold">Policy summary</h3>
        <ul className="mt-2 space-y-1 text-xs text-gray-700">
          <li>
            • Allow contract calls only to <code>{REGISTRY_CONTRACT_ID}</code>
          </li>
          <li>• Per-tx cap: 0.5 NEAR</li>
          <li>• Daily cap: 1 NEAR</li>
        </ul>
      </div>

      <button
        onClick={handleCommit}
        disabled={busy}
        className="mt-8 rounded-md bg-blue-600 px-6 py-3 text-white disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Sign + commit"}
      </button>

      {onboard.state.error && (
        <p className="mt-4 text-sm text-red-600">{onboard.state.error}</p>
      )}
    </main>
  );
}
