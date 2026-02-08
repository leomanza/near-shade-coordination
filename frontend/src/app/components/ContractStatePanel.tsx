"use client";

import { useCallback } from "react";
import { usePolling } from "@/lib/use-polling";
import { getOnChainState, type OnChainState } from "@/lib/api";

const CONTRACT_ID = process.env.NEXT_PUBLIC_contractId || "ac-proxy.agents-coordinator.testnet";
const EXPLORER_URL = `https://testnet.nearblocks.io/address/${CONTRACT_ID}`;

export default function ContractStatePanel() {
  const fetcher = useCallback(getOnChainState, []);
  const { data: state, error } = usePolling<OnChainState>(fetcher, 5000);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-zinc-100">On-Chain State</h3>
        <a
          href={EXPLORER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono px-2 py-1 rounded-md bg-zinc-800 text-blue-400 hover:text-blue-300 hover:bg-zinc-700 transition-colors"
        >
          View on Explorer &rarr;
        </a>
      </div>

      {error || !state ? (
        <p className="text-xs text-zinc-500">Unable to read contract state</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Stat label="Proposals" value={String(state.currentProposalId)} />
            <Stat label="Pending" value={String(state.pendingCount)} />
            <Stat label="Finalized" value={String(state.finalizedResults.length)} />
          </div>

          <div className="text-xs text-zinc-500">
            <span className="text-zinc-600">Owner:</span>{" "}
            <span className="font-mono">{state.owner}</span>
          </div>

          {state.finalizedResults.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                Finalized Results (on-chain)
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {state.finalizedResults
                  .slice()
                  .reverse()
                  .map((f) => {
                    const parsed = (() => {
                      try { return JSON.parse(f.result); } catch { return null; }
                    })();
                    return (
                      <div
                        key={f.proposalId}
                        className="flex items-center justify-between p-2 rounded-lg bg-zinc-800/60 text-xs"
                      >
                        <span className="font-mono text-zinc-400">
                          #{f.proposalId}
                        </span>
                        {parsed ? (
                          <div className="flex items-center gap-3">
                            <span className="text-green-400 font-mono font-bold">
                              {parsed.aggregatedValue}
                            </span>
                            <span className="text-zinc-600">
                              {parsed.workerCount} workers
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-500 font-mono truncate max-w-[200px]">
                            {f.result}
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2 rounded-lg bg-zinc-800/40 text-center">
      <p className="text-lg font-bold font-mono text-zinc-200">{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
    </div>
  );
}
