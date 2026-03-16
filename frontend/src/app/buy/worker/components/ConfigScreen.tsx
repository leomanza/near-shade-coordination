"use client";

import { useState, useEffect } from "react";
import { getActiveCoordinators, type RegistryCoordinator } from "@/lib/api";

interface ConfigScreenProps {
  accountId: string;
  loading: boolean;
  onDeploy: (params: {
    coordinatorDid: string;
    displayName: string;
  }) => void;
}

export default function ConfigScreen({ accountId, loading, onDeploy }: ConfigScreenProps) {
  const [name, setName] = useState("");
  const [coordinatorDid, setCoordinatorDid] = useState("");
  const [coordinators, setCoordinators] = useState<RegistryCoordinator[]>([]);
  const [loadingCoords, setLoadingCoords] = useState(true);

  useEffect(() => {
    getActiveCoordinators()
      .then((c) => {
        const list = c ?? [];
        setCoordinators(list);
        // Auto-select first coordinator
        if (list.length > 0 && !coordinatorDid) {
          setCoordinatorDid(list[0].coordinator_did);
        }
      })
      .finally(() => setLoadingCoords(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canDeploy = name.length >= 2 && coordinatorDid;

  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 terminal-card">
      <h3 className="text-sm font-semibold text-zinc-100 mb-1 font-mono">
        Configure Your Worker
      </h3>
      <p className="text-[10px] text-zinc-600 mb-6 font-mono">
        Choose a name and coordinator to join. Identity keys are generated automatically.
      </p>

      <div className="space-y-4">
        {/* Worker name */}
        <div>
          <label className="block text-[10px] text-zinc-500 font-mono mb-1">
            Worker name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alice's Voter"
            className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-mono placeholder:text-zinc-700 focus:border-[#00ff41]/30 focus:outline-none"
          />
        </div>

        {/* Coordinator selection */}
        <div>
          <label className="block text-[10px] text-zinc-500 font-mono mb-1">
            Join coordinator
          </label>
          {loadingCoords ? (
            <div className="text-[10px] text-zinc-600 font-mono py-2">
              Loading coordinators...
            </div>
          ) : coordinators.length === 0 ? (
            <div className="text-[10px] text-yellow-600 font-mono py-2">
              No active coordinators found
            </div>
          ) : (
            <select
              value={coordinatorDid}
              onChange={(e) => setCoordinatorDid(e.target.value)}
              className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-mono focus:border-[#00ff41]/30 focus:outline-none"
            >
              {coordinators.map((c) => (
                <option key={c.coordinator_did} value={c.coordinator_did}>
                  {c.coordinator_did.length > 40
                    ? `${c.coordinator_did.substring(0, 20)}...`
                    : c.coordinator_did}
                </option>
              ))}
            </select>
          )}
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
          onClick={() => onDeploy({ coordinatorDid, displayName: name })}
          disabled={!canDeploy || loading}
          className="w-full mt-2 px-4 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-sm font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {loading ? "starting..." : "Deploy Worker"}
        </button>
      </div>
    </div>
  );
}
