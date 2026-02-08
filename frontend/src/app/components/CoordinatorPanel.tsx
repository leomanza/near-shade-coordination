"use client";

import StatusDot from "./StatusDot";
import type { CoordinatorStatus } from "@/lib/api";

interface CoordinatorPanelProps {
  status: CoordinatorStatus | null;
  online: boolean;
}

const CONTRACT_ID = process.env.NEXT_PUBLIC_contractId || "ac-proxy.agents-coordinator.testnet";

export default function CoordinatorPanel({ status, online }: CoordinatorPanelProps) {
  const currentStatus = online ? (status?.status || "idle") : "offline";

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <StatusDot status={currentStatus} />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Coordinator Agent</h3>
            <p className="text-xs text-zinc-500 font-mono">:3000</p>
          </div>
        </div>
        <span className="text-xs font-mono px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">
          {currentStatus}
        </span>
      </div>

      {/* Contract info */}
      <div className="text-xs text-zinc-500 mb-3 font-mono truncate" title={CONTRACT_ID}>
        Contract: {CONTRACT_ID}
      </div>

      {status?.proposalId != null && (
        <div className="text-xs text-zinc-400 mb-2">
          <span className="text-zinc-500">Proposal ID:</span>{" "}
          <span className="font-mono text-zinc-300">#{status.proposalId}</span>
        </div>
      )}

      {status?.tally && (
        <div className="mt-3 space-y-2">
          {/* On-chain result (public) */}
          <div className="rounded-lg bg-green-950/30 border border-green-900/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-900/60 text-green-400">
                ON-CHAIN
              </span>
              <span className="text-[10px] text-zinc-500">Public / Settled on NEAR</span>
            </div>
            <p className="text-2xl font-bold text-green-400 font-mono">
              {status.tally.aggregatedValue}
            </p>
            <div className="flex gap-4 mt-1 text-xs text-zinc-500">
              <span>{status.tally.workerCount || status.tally.workers.length} workers</span>
              <span className="font-mono">
                {new Date(status.tally.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>

          {/* Off-chain details (private / Ensue only) */}
          <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400">
                ENSUE ONLY
              </span>
              <span className="text-[10px] text-zinc-600">Private / Off-chain</span>
            </div>
            <div className="space-y-1">
              {status.tally.workers.map((w) => (
                <div key={w.workerId} className="flex justify-between text-xs text-zinc-500">
                  <span>{w.workerId}</span>
                  <div className="flex gap-3">
                    <span className="font-mono text-zinc-400">{w.output.value}</span>
                    {w.processingTime && (
                      <span className="text-zinc-600">{w.processingTime}ms</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
