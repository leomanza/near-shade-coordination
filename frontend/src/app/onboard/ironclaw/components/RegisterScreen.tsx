"use client";
import { useEffect, useState } from "react";
import type { AuthState } from "@/lib/auth";
import { onboardOutlayer } from "../lib/outlayer-client-browser";
import { workerDidFromNearAccount } from "../lib/worker-did-derivation";
import type { OnboardingApi } from "../hooks/useOutlayerOnboarding";

interface Props {
  onboard: OnboardingApi;
  auth: AuthState;
  mode: "anonymous" | "autonomous";
}

const REGISTRY_CONTRACT_ID =
  process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID || "registry.agents-coordinator.testnet";

export default function RegisterScreen({ onboard, mode }: Props) {
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (mode === "anonymous") {
          const r = await onboardOutlayer.registerAnonymous();
          if (cancelled) return;
          const worker_did = workerDidFromNearAccount(r.near_account_id);
          onboard.dispatch({
            type: "set_wallet",
            wallet: {
              wallet_id: r.wallet_id,
              api_key: r.api_key,
              near_account_id: r.near_account_id,
            },
            worker_did,
          });
          onboard.advance("fund");
        } else {
          const { wallet, worker_did, endpoint_url, cvm_id } = onboard.state;
          if (!wallet || !worker_did) throw new Error("missing wallet state");
          const r = await onboardOutlayer.registerWorker({
            api_key: wallet.api_key,
            worker_did,
            endpoint_url,
            cvm_id,
            registry_contract_id: REGISTRY_CONTRACT_ID,
          });
          if (cancelled) return;
          onboard.dispatch({ type: "set_register_tx", tx_hash: r.tx_hash });
          onboard.advance("install");
        }
      } catch (e: unknown) {
        if (cancelled) return;
        onboard.setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <main className="mx-auto max-w-xl p-8 text-center">
      <h1 className="text-2xl font-bold">
        {mode === "anonymous" ? "Provisioning your wallet…" : "Submitting registration…"}
      </h1>
      <p className="mt-4 text-gray-600">
        {mode === "anonymous"
          ? "Asking outlayer for a TEE-managed wallet."
          : "The TEE is signing register_worker. No wallet popup needed."}
      </p>
      {busy && <div className="mt-8 animate-pulse">●●●</div>}
      {onboard.state.error && (
        <p className="mt-4 text-sm text-red-600">{onboard.state.error}</p>
      )}
    </main>
  );
}
