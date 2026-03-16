"use client";

import { useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useProvisionJob } from "./hooks/useProvisionJob";
import EntryScreen from "./components/EntryScreen";
import ConfigScreen from "./components/ConfigScreen";
import ProgressScreen from "./components/ProgressScreen";
import AwaitingSignatureScreen from "./components/AwaitingSignatureScreen";
import SuccessScreen from "./components/SuccessScreen";
import ErrorScreen from "./components/ErrorScreen";

type Screen =
  | "entry"
  | "config"
  | "provisioning"
  | "awaiting_signature"
  | "success"
  | "error";

function deriveScreen(
  accountId: string | null,
  jobStatus: string | undefined
): Screen {
  if (!accountId) return "entry";
  if (!jobStatus) return "config";
  switch (jobStatus) {
    case "complete":
      return "success";
    case "failed":
      return "error";
    case "awaiting_near_signature":
      return "awaiting_signature";
    default:
      return "provisioning";
  }
}

export default function BuyPage() {
  const { accountId, connect, disconnect, connecting, signAndSendTransaction } = useAuth();
  const { job, loading, startProvision, completeRegistration, reset } =
    useProvisionJob();

  const screen = deriveScreen(accountId, job?.status);

  const handleDeploy = useCallback(
    async (params: { coordinatorDid: string; displayName: string }) => {
      if (!accountId) return;
      await startProvision({
        coordinatorDid: params.coordinatorDid,
        displayName: params.displayName,
        nearAccount: accountId,
      });
    },
    [accountId, startProvision]
  );

  const handleSign = useCallback(async () => {
    if (!job?.workerDid || !job?.phalaEndpoint || !job?.cvmId) return;

    const REGISTRY_CONTRACT_ID =
      process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID ||
      "registry.agents-coordinator.testnet";

    try {
      const result = await signAndSendTransaction({
        receiverId: REGISTRY_CONTRACT_ID,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "register_worker",
              args: {
                coordinator_did: job.coordinatorDid,
                worker_did: job.workerDid,
                endpoint_url: job.phalaEndpoint,
                cvm_id: job.cvmId,
              },
              gas: "200000000000000",
              deposit: "100000000000000000000000",
            },
          },
        ],
      });

      const txHash =
        typeof result === "object" && result !== null
          ? (result as any).transaction?.hash || (result as any).txHash
          : undefined;

      await completeRegistration(txHash);
    } catch (err) {
      console.error("Transaction signing failed:", err);
      // Don't silently fail — let user know
      alert(`Transaction failed: ${err instanceof Error ? err.message : "Unknown error"}. You can skip and register manually later.`);
    }
  }, [job, completeRegistration, signAndSendTransaction]);

  const handleSkipSign = useCallback(() => {
    completeRegistration();
  }, [completeRegistration]);

  return (
    <div className="min-h-screen bg-[#050505] p-6 md:p-10 max-w-2xl mx-auto">
      <div className="fixed inset-0 cyber-grid pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none opacity-30" />

      <div className="relative z-10">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <Link
              href="/"
              className="flex items-center gap-3 hover:opacity-80 transition-opacity"
            >
              <img src="/logo-iso.svg" alt="Delibera" className="h-8 w-8" />
              <h1 className="text-xl font-bold text-zinc-100 font-mono">
                Delibera
              </h1>
            </Link>
            {accountId && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 font-mono truncate max-w-[180px]">
                  {accountId}
                </span>
                <button
                  onClick={disconnect}
                  className="text-[10px] px-3 py-1.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 transition-colors font-mono"
                >
                  disconnect
                </button>
              </div>
            )}
          </div>
          <p className="text-sm text-zinc-500 font-mono">
            One-Click Worker Deployment
          </p>
        </header>

        {/* Screen router */}
        {screen === "entry" && (
          <EntryScreen connecting={connecting} onConnect={connect} />
        )}

        {screen === "config" && (
          <ConfigScreen
            accountId={accountId!}
            loading={loading}
            onDeploy={handleDeploy}
          />
        )}

        {screen === "provisioning" && job && (
          <ProgressScreen
            status={job.status}
            step={job.step}
            displayName={job.displayName}
          />
        )}

        {screen === "awaiting_signature" && job && (
          <AwaitingSignatureScreen
            workerDid={job.workerDid!}
            coordinatorDid={job.coordinatorDid!}
            phalaEndpoint={job.phalaEndpoint!}
            cvmId={job.cvmId!}
            nearAccount={job.nearAccount!}
            onSign={handleSign}
            onSkip={handleSkipSign}
          />
        )}

        {screen === "success" && job && (
          <SuccessScreen
            workerDid={job.workerDid!}
            displayName={job.displayName!}
            coordinatorDid={job.coordinatorDid!}
            phalaEndpoint={job.phalaEndpoint}
            cvmId={job.cvmId}
            nearAccount={job.nearAccount!}
            storachaPrivateKey={job.storachaPrivateKey}
            onReset={reset}
          />
        )}

        {screen === "error" && (
          <ErrorScreen
            error={job?.error}
            workerDid={job?.workerDid}
            cvmId={job?.cvmId}
            dashboardUrl={job?.dashboardUrl}
            onRetry={() => {
              reset();
              // User goes back to config screen
            }}
            onReset={reset}
          />
        )}

        <footer className="mt-8 text-center text-[10px] text-zinc-700 font-mono">
          NEAR Protocol &middot; Phala TEE &middot; Storacha &middot; Ensue
          Network
        </footer>
      </div>
    </div>
  );
}
