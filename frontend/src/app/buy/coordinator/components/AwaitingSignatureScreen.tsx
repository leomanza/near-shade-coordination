"use client";

import { useState } from "react";

interface AwaitingSignatureScreenProps {
  coordinatorDid: string;
  phalaEndpoint: string;
  cvmId: string;
  nearAccount: string;
  displayName: string;
  contractAddress: string;
  minWorkers: number;
  maxWorkers: number;
  /** Called for tx #2: registry register. */
  onRegistryRegister: () => Promise<void>;
  onSkip: () => void;
}

export default function AwaitingSignatureScreen({
  coordinatorDid,
  phalaEndpoint,
  cvmId,
  nearAccount,
  displayName,
  contractAddress,
  minWorkers,
  maxWorkers,
  onRegistryRegister,
  onSkip,
}: AwaitingSignatureScreenProps) {
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSign() {
    setSigning(true);
    setError(null);
    try {
      await onRegistryRegister();
      setDone(true);
    } catch (err: any) {
      setError(`Registry registration failed: ${err?.message || "Unknown error"}`);
      setSigning(false);
    }
  }

  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 terminal-card">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[#00ff41] text-lg">&#10003;</span>
        <span className="text-[10px] text-zinc-600 font-mono">Step 2 of 2</span>
      </div>
      <h3 className="text-sm font-semibold text-zinc-100 mb-1 font-mono">
        Activate your coordinator
      </h3>
      <p className="text-[10px] text-zinc-500 font-mono mb-5 leading-relaxed">
        Your Phala agent is live. Register it on the NEAR network so workers can find and join it.
      </p>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded p-3 mb-5 space-y-2">
        <div className="text-[10px] font-mono">
          <span className="text-zinc-600">Agent endpoint: </span>
          <span className="text-[#00ff41]/80 break-all">{phalaEndpoint}</span>
        </div>
        <div className="text-[10px] font-mono">
          <span className="text-zinc-600">Contract: </span>
          <span className="text-zinc-400 break-all">{contractAddress || "—"}</span>
        </div>
        <div className="text-[10px] font-mono">
          <span className="text-zinc-600">Coordinator DID: </span>
          <span className="text-zinc-500 break-all">{coordinatorDid}</span>
        </div>
        <div className="text-[10px] font-mono">
          <span className="text-zinc-600">Deposit: </span>
          <span className="text-zinc-400">0.1 NEAR</span>
        </div>
      </div>

      {error && (
        <div className="p-2 mb-3 rounded text-[10px] font-mono bg-red-950/30 border border-red-900/40 text-red-400">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleSign}
          disabled={signing || done}
          className="flex-1 px-4 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-sm font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-40"
        >
          {signing ? "signing..." : done ? "registered ✓" : "Sign with NEAR Wallet"}
        </button>
        <button
          onClick={onSkip}
          disabled={signing}
          className="px-4 py-3 rounded border border-zinc-700 bg-zinc-800 text-xs text-zinc-400 font-mono hover:border-zinc-600 transition-colors disabled:opacity-40"
        >
          Skip
        </button>
      </div>

      <p className="text-[9px] text-zinc-600 font-mono mt-3">
        Skip to register manually later via CLI.
      </p>
    </div>
  );
}
