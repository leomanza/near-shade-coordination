"use client";

import { useState } from "react";

interface SignFactoryScreenProps {
  displayName: string;
  contractAddress: string;
  minWorkers: number;
  maxWorkers: number;
  nearAccount: string;
  onSign: () => Promise<void>;
  onBack: () => void;
}

export default function SignFactoryScreen({
  displayName,
  contractAddress,
  minWorkers,
  maxWorkers,
  nearAccount,
  onSign,
  onBack,
}: SignFactoryScreenProps) {
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSign() {
    setSigning(true);
    setError(null);
    try {
      await onSign();
    } catch (err: any) {
      setError(err?.message || "Transaction failed");
      setSigning(false);
    }
  }

  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 terminal-card">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] text-zinc-600 font-mono">Step 1 of 2</span>
      </div>
      <h3 className="text-sm font-semibold text-zinc-100 mb-1 font-mono">
        Deploy your coordinator contract
      </h3>
      <p className="text-[10px] text-zinc-500 font-mono mb-5 leading-relaxed">
        This creates your sovereign coordinator contract on NEAR. You will be the
        owner. DAOs will submit proposals to this address.
      </p>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded p-3 mb-5 space-y-2">
        <div className="text-[10px] font-mono">
          <span className="text-zinc-600">Network name: </span>
          <span className="text-zinc-300">{displayName}</span>
        </div>
        <div className="text-[10px] font-mono">
          <span className="text-zinc-600">Contract address: </span>
          <span className="text-[#00ff41]/80 break-all">{contractAddress}</span>
        </div>
        <div className="text-[10px] font-mono">
          <span className="text-zinc-600">Workers: </span>
          <span className="text-zinc-400">min {minWorkers} / max {maxWorkers}</span>
        </div>
        <div className="text-[10px] font-mono">
          <span className="text-zinc-600">Owner (you): </span>
          <span className="text-zinc-400">{nearAccount}</span>
        </div>
        <div className="text-[10px] font-mono">
          <span className="text-zinc-600">Deposit: </span>
          <span className="text-zinc-400">~3 NEAR (covers account + storage)</span>
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
          {signing ? "waiting for wallet..." : "Sign with NEAR Wallet"}
        </button>
        <button
          onClick={onBack}
          disabled={signing}
          className="px-4 py-3 rounded border border-zinc-700 bg-zinc-800 text-xs text-zinc-400 font-mono hover:border-zinc-600 transition-colors disabled:opacity-40"
        >
          Back
        </button>
      </div>

      <p className="text-[9px] text-zinc-600 font-mono mt-3">
        After signing, Phala deployment will start automatically.
      </p>
    </div>
  );
}
