"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useCoordinatorProvision } from "./hooks/useCoordinatorProvision";
import EntryScreen from "./components/EntryScreen";
import ConfigScreen from "./components/ConfigScreen";
import SignFactoryScreen from "./components/SignFactoryScreen";
import ProgressScreen from "./components/ProgressScreen";
import AwaitingSignatureScreen from "./components/AwaitingSignatureScreen";
import SuccessScreen from "./components/SuccessScreen";
import ErrorScreen from "./components/ErrorScreen";
import {
  buildCreateCoordinatorAction,
  buildRegisterCoordinatorAction,
  deriveContractAddress,
} from "./utils/near-tx";

type Screen =
  | "entry"
  | "config"
  | "sign_factory"
  | "provisioning"
  | "awaiting_signature"
  | "success"
  | "error";

interface PendingConfig {
  displayName: string;
  minWorkers: number;
  maxWorkers: number;
  prefix: string;
  contractAddress: string;
}

function deriveScreen(
  accountId: string | null,
  jobStatus: string | undefined,
  hasPendingConfig: boolean
): Screen {
  if (!accountId) return "entry";
  if (!jobStatus) return hasPendingConfig ? "sign_factory" : "config";
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

export default function CoordinatorBuyPage() {
  const { accountId, connect, disconnect, connecting, signAndSendTransaction } = useAuth();
  const { job, loading, startProvision, completeRegistration, reset } =
    useCoordinatorProvision();

  const [pendingConfig, setPendingConfig] = useState<PendingConfig | null>(null);
  const [contractAddress, setContractAddress] = useState<string | undefined>();

  const screen = deriveScreen(accountId, job?.status, !!pendingConfig);

  /** Config form submitted — derive contract address and go to sign_factory */
  const handleDeploy = useCallback(
    (params: { displayName: string; minWorkers: number; maxWorkers: number }) => {
      if (!accountId) return;
      const prefix = params.displayName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32);
      const addr = deriveContractAddress(prefix);
      setPendingConfig({ ...params, prefix, contractAddress: addr });
    },
    [accountId]
  );

  /** Tx #1: Sign factory deploy, then kick off Phala provisioning */
  const handleFactorySignAndProvision = useCallback(async () => {
    if (!pendingConfig || !accountId) return;

    const tx = buildCreateCoordinatorAction({
      prefix: pendingConfig.prefix,
      minWorkers: pendingConfig.minWorkers,
      maxWorkers: pendingConfig.maxWorkers,
    });

    await signAndSendTransaction(tx);

    const addr = pendingConfig.contractAddress;
    setContractAddress(addr);

    // Start Phala provisioning now that we have the contract address
    await startProvision({
      displayName: pendingConfig.displayName,
      nearAccount: accountId,
      minWorkers: pendingConfig.minWorkers,
      maxWorkers: pendingConfig.maxWorkers,
      contractAddress: addr,
    });
  }, [pendingConfig, accountId, signAndSendTransaction, startProvision]);

  /** Tx #2: Registry register */
  const handleRegistryRegister = useCallback(async () => {
    if (!job?.coordinatorDid || !job?.phalaEndpoint || !job?.cvmId) return;
    const addr = contractAddress || job.contractAddress || "";

    const tx = buildRegisterCoordinatorAction({
      coordinatorDid: job.coordinatorDid,
      endpointUrl: job.phalaEndpoint,
      cvmId: job.cvmId,
      minWorkers: job.minWorkers ?? 1,
      maxWorkers: job.maxWorkers ?? 10,
    });

    await signAndSendTransaction(tx);
    await completeRegistration(addr);
  }, [job, contractAddress, signAndSendTransaction, completeRegistration]);

  const handleSkip = useCallback(() => {
    completeRegistration(contractAddress || job?.contractAddress);
  }, [completeRegistration, contractAddress, job?.contractAddress]);

  const handleReset = useCallback(() => {
    setPendingConfig(null);
    setContractAddress(undefined);
    reset();
  }, [reset]);

  const resolvedContractAddress =
    contractAddress || job?.contractAddress || pendingConfig?.contractAddress;

  return (
    <div className="min-h-screen bg-[#050505] p-6 md:p-10 max-w-2xl mx-auto">
      <div className="fixed inset-0 cyber-grid pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none opacity-30" />

      <div className="relative z-10">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <Link
              href="/buy"
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
            One-Click Coordinator Deployment
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

        {screen === "sign_factory" && pendingConfig && (
          <SignFactoryScreen
            displayName={pendingConfig.displayName}
            contractAddress={pendingConfig.contractAddress}
            minWorkers={pendingConfig.minWorkers}
            maxWorkers={pendingConfig.maxWorkers}
            nearAccount={accountId!}
            onSign={handleFactorySignAndProvision}
            onBack={() => setPendingConfig(null)}
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
            coordinatorDid={job.coordinatorDid!}
            phalaEndpoint={job.phalaEndpoint!}
            cvmId={job.cvmId!}
            nearAccount={job.nearAccount!}
            displayName={job.displayName!}
            contractAddress={resolvedContractAddress || ""}
            minWorkers={job.minWorkers ?? 1}
            maxWorkers={job.maxWorkers ?? 10}
            onRegistryRegister={handleRegistryRegister}
            onSkip={handleSkip}
          />
        )}

        {screen === "success" && job && (
          <SuccessScreen
            coordinatorDid={job.coordinatorDid!}
            displayName={job.displayName!}
            contractAddress={resolvedContractAddress}
            phalaEndpoint={job.phalaEndpoint}
            cvmId={job.cvmId}
            nearAccount={job.nearAccount!}
            storachaPrivateKey={job.storachaPrivateKey}
            minWorkers={job.minWorkers ?? 1}
            maxWorkers={job.maxWorkers ?? 10}
            ensueOrgName={job.ensueOrgName}
            ensueClaimUrl={job.ensueClaimUrl}
            ensueVerificationCode={job.ensueVerificationCode}
            onReset={handleReset}
          />
        )}

        {screen === "error" && (
          <ErrorScreen
            error={job?.error}
            coordinatorDid={job?.coordinatorDid}
            cvmId={job?.cvmId}
            dashboardUrl={job?.dashboardUrl}
            onRetry={() => handleReset()}
            onReset={handleReset}
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
