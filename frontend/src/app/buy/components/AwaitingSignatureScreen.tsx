"use client";

import { useState } from "react";

interface AwaitingSignatureScreenProps {
  workerDid: string;
  coordinatorDid: string;
  phalaEndpoint: string;
  cvmId: string;
  nearAccount: string;
  onSign: () => Promise<void>;
  onSkip: () => void;
}

export default function AwaitingSignatureScreen({
  workerDid,
  coordinatorDid,
  phalaEndpoint,
  cvmId,
  nearAccount,
  onSign,
  onSkip,
}: AwaitingSignatureScreenProps) {
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSign() {
    setSigning(true);
    setError(null);
    try {
      await onSign();
    } catch (err: any) {
      setError(err?.message || "Transaction failed");
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 terminal-card">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[#00ff41] text-lg">&#10003;</span>
        <h3 className="text-sm font-semibold text-zinc-100 font-mono">
          Worker deployed!
        </h3>
      </div>

      <p className="text-xs text-zinc-400 font-mono mb-4 leading-relaxed">
        Sign the registration transaction in your NEAR wallet to pay the 0.1 NEAR
        deposit and activate your worker on-chain.
      </p>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded p-3 mb-4 space-y-1.5">
        <div className="text-[10px] text-zinc-500 font-mono">
          <span className="text-zinc-600">Worker DID:</span>{" "}
          <span className="text-zinc-400 break-all">{workerDid}</span>
        </div>
        <div className="text-[10px] text-zinc-500 font-mono">
          <span className="text-zinc-600">Endpoint:</span>{" "}
          <span className="text-zinc-400 break-all">{phalaEndpoint}</span>
        </div>
        <div className="text-[10px] text-zinc-500 font-mono">
          <span className="text-zinc-600">Signing as:</span>{" "}
          <span className="text-zinc-400">{nearAccount}</span>
        </div>
        <div className="text-[10px] text-zinc-500 font-mono">
          <span className="text-zinc-600">Deposit:</span>{" "}
          <span className="text-zinc-300">0.1 NEAR</span>
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
          disabled={signing}
          className="flex-1 px-4 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-sm font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-40"
        >
          {signing ? "signing..." : "Sign with NEAR Wallet"}
        </button>
        <button
          onClick={onSkip}
          className="px-4 py-3 rounded border border-zinc-700 bg-zinc-800 text-xs text-zinc-400 font-mono hover:border-zinc-600 transition-colors"
        >
          Skip
        </button>
      </div>

      <p className="text-[9px] text-zinc-600 font-mono mt-3">
        Skip if you want to register manually later via CLI.
      </p>
    </div>
  );
}
