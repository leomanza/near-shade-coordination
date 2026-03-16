"use client";

import { useState } from "react";

interface ConfigScreenProps {
  accountId: string;
  loading: boolean;
  onDeploy: (params: {
    displayName: string;
    minWorkers: number;
    maxWorkers: number;
  }) => void;
}

export default function ConfigScreen({ accountId, loading, onDeploy }: ConfigScreenProps) {
  const [name, setName] = useState("");
  const [minWorkers, setMinWorkers] = useState(1);
  const [maxWorkers, setMaxWorkers] = useState(10);

  const canDeploy = name.length >= 2 && minWorkers >= 1 && maxWorkers >= minWorkers;

  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 terminal-card">
      <h3 className="text-sm font-semibold text-zinc-100 mb-1 font-mono">
        Configure Your Coordinator
      </h3>
      <p className="text-[10px] text-zinc-600 mb-6 font-mono">
        Set a name and worker pool size. Identity keys are generated automatically.
      </p>

      <div className="space-y-4">
        {/* Coordinator name */}
        <div>
          <label className="block text-[10px] text-zinc-500 font-mono mb-1">
            Coordinator name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Governance Network"
            className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-mono placeholder:text-zinc-700 focus:border-[#00ff41]/30 focus:outline-none"
          />
        </div>

        {/* Worker pool size */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] text-zinc-500 font-mono mb-1">
              Min workers
            </label>
            <input
              type="number"
              value={minWorkers}
              min={1}
              max={maxWorkers}
              onChange={(e) => setMinWorkers(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-mono focus:border-[#00ff41]/30 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-zinc-500 font-mono mb-1">
              Max workers
            </label>
            <input
              type="number"
              value={maxWorkers}
              min={minWorkers}
              onChange={(e) => setMaxWorkers(Math.max(minWorkers, parseInt(e.target.value) || minWorkers))}
              className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-mono focus:border-[#00ff41]/30 focus:outline-none"
            />
          </div>
        </div>

        {/* NEAR account */}
        <div>
          <label className="block text-[10px] text-zinc-500 font-mono mb-1">
            Your NEAR account
          </label>
          <div className="px-3 py-2 rounded bg-zinc-900/50 border border-zinc-800 text-xs text-zinc-400 font-mono">
            {accountId}
          </div>
        </div>

        <button
          onClick={() => onDeploy({ displayName: name, minWorkers, maxWorkers })}
          disabled={!canDeploy || loading}
          className="w-full mt-2 px-4 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-sm font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {loading ? "starting..." : "Deploy Coordinator"}
        </button>
      </div>
    </div>
  );
}
