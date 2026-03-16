"use client";

interface EntryScreenProps {
  connecting: boolean;
  onConnect: () => void;
}

export default function EntryScreen({ connecting, onConnect }: EntryScreenProps) {
  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-8 terminal-card">
      <h2 className="text-lg font-semibold text-zinc-100 mb-2 font-mono">
        Deploy a Delibera Coordinator
      </h2>
      <p className="text-sm text-zinc-400 font-mono mb-6 leading-relaxed">
        Run a coordination network for a DAO or community. Your coordinator
        manages a pool of worker agents, aggregates votes, and publishes
        results on-chain. Runs in a Phala TEE with its own sovereign identity.
      </p>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded p-4 mb-6 space-y-2">
        <p className="text-[11px] text-zinc-500 font-mono">Estimated cost</p>
        <div className="space-y-1">
          <div className="flex justify-between text-xs font-mono">
            <span className="text-zinc-500">Deploy coordinator contract (factory)</span>
            <span className="text-zinc-300">~3 NEAR</span>
          </div>
          <div className="flex justify-between text-xs font-mono">
            <span className="text-zinc-500">Registry deposit</span>
            <span className="text-zinc-300">0.1 NEAR</span>
          </div>
        </div>
      </div>

      <button
        onClick={onConnect}
        disabled={connecting}
        className="w-full px-6 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-sm font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-40"
      >
        {connecting ? "connecting..." : "Connect NEAR Wallet"}
      </button>
    </div>
  );
}
