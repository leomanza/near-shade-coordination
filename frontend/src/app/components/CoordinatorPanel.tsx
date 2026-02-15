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
  const tally = status?.tally;
  const isVote = tally && typeof tally.approved === "number" && tally.approved + tally.rejected > 0;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <StatusDot status={currentStatus} />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">Coordinator</h3>
            <p className="text-xs text-zinc-500 font-mono">:3000</p>
          </div>
        </div>
        <span className="text-xs font-mono px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">
          {currentStatus}
        </span>
      </div>

      <div className="text-xs text-zinc-500 mb-3 font-mono truncate" title={CONTRACT_ID}>
        {CONTRACT_ID}
      </div>

      {status?.proposalId != null && (
        <div className="text-xs text-zinc-400 mb-2">
          <span className="text-zinc-500">Proposal:</span>{" "}
          <span className="font-mono text-zinc-300">#{status.proposalId}</span>
        </div>
      )}

      {tally && (
        <div className="mt-3 space-y-2">
          {/* On-chain result */}
          <div className="rounded-lg bg-green-950/30 border border-green-900/40 p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-900/60 text-green-400">
                ON-CHAIN
              </span>
            </div>
            {isVote ? (
              <>
                <p className={`text-xl font-bold ${tally.decision === "Approved" ? "text-green-400" : "text-red-400"}`}>
                  {tally.decision}
                </p>
                <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-700 mt-2">
                  {tally.approved > 0 && (
                    <div className="bg-green-500" style={{ width: `${(tally.approved / tally.workerCount) * 100}%` }} />
                  )}
                  {tally.rejected > 0 && (
                    <div className="bg-red-500" style={{ width: `${(tally.rejected / tally.workerCount) * 100}%` }} />
                  )}
                </div>
                <div className="flex justify-between mt-1 text-[10px] text-zinc-500">
                  <span className="text-green-400">{tally.approved}Y</span>
                  <span className="text-red-400">{tally.rejected}N</span>
                </div>
              </>
            ) : (
              <p className="text-2xl font-bold text-green-400 font-mono">
                {tally.aggregatedValue}
              </p>
            )}
            <div className="flex gap-4 mt-1 text-xs text-zinc-500">
              <span>{tally.workerCount} agents</span>
              <span className="font-mono">
                {new Date(tally.timestamp).toLocaleTimeString()}
              </span>
            </div>
          </div>

          {/* Off-chain note */}
          <div className="rounded-lg bg-zinc-800/40 border border-zinc-700/40 p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-700/60 text-zinc-400">
                PRIVACY
              </span>
            </div>
            <p className="text-[10px] text-zinc-600">
              Individual votes &amp; reasoning are private (Ensue/Nova). Only the aggregate tally is shown.
              {tally.workerCount > 0 && ` ${tally.workerCount} agents participated.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
