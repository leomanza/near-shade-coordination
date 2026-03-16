"use client";

import { useCallback } from "react";
import Link from "next/link";
import WorkerCard from "./WorkerCard";
import StatusDot from "./StatusDot";
import AgentEndpointConfig from "./AgentEndpointConfig";
import { usePolling } from "@/lib/use-polling";
import { useAuth } from "@/lib/auth";
import {
  getCoordinatorStatus,
  getWorkerStatuses,
  getProposalHistory,
  type CoordinatorStatus,
  type WorkerStatuses,
  type ProposalSummary,
} from "@/lib/api";

export default function WorkerDashboardContent({
  workerId,
  accountId,
  onDisconnect,
}: {
  workerId: string;
  accountId: string;
  onDisconnect: () => void;
}) {
  const coordFetcher = useCallback(getCoordinatorStatus, []);
  const workerFetcher = useCallback(getWorkerStatuses, []);
  // Fetch only proposals this worker participated in
  const proposalFetcher = useCallback(
    () => getProposalHistory(workerId),
    [workerId]
  );

  const { data: coordStatus } = usePolling<CoordinatorStatus>(coordFetcher, 2000);
  const { data: workerStatuses, error: workerError } =
    usePolling<WorkerStatuses>(workerFetcher, 2000);
  const { data: proposalData } = usePolling<{ proposals: ProposalSummary[]; total: number }>(
    proposalFetcher, 10000
  );

  // Authenticated worker view
  const myStatus = workerStatuses?.workers[workerId] || "unknown";

  // Only proposals this worker participated in (already filtered by backend)
  const myProposals = (proposalData?.proposals ?? []).slice(-10).reverse();

  return (
    <PageShell accountId={accountId} onDisconnect={onDisconnect}>
      {/* Worker identity banner */}
      <div className="flex items-center gap-3 mb-6 p-3 rounded border border-zinc-800 bg-[#0a0f0a]/80">
        <StatusDot status={workerError ? "offline" : myStatus} />
        <div>
          <span className="text-sm font-semibold text-zinc-100 font-mono">{workerId}</span>
          <span className="text-xs text-zinc-600 ml-2 font-mono">{accountId}</span>
        </div>
        <span className="ml-auto text-xs font-mono px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">
          {myStatus}
        </span>
      </div>

      {/* Agent Endpoint Config */}
      <AgentEndpointConfig agentId={workerId} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Own Identity (full WorkerCard with identity expansion) */}
        <WorkerCard
          workerId={workerId}
          label={workerId}
          port={0}
          status={workerError ? "offline" : myStatus}
        />

        {/* Current proposal status — only show if this worker is participating */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="text-sm font-semibold text-zinc-100 mb-3 font-mono">
            // Current Proposal
          </h3>
          {coordStatus?.status === "idle" || !coordStatus ? (
            <p className="text-xs text-zinc-600 font-mono">No active proposal</p>
          ) : myStatus === "idle" || myStatus === "unknown" ? (
            <p className="text-xs text-zinc-600 font-mono">
              Active proposal #{coordStatus.proposalId} — your worker is not participating
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <StatusDot status={coordStatus.status} />
                <span className="text-zinc-400 font-mono">{coordStatus.status}</span>
                {coordStatus.proposalId != null && (
                  <span className="text-zinc-600 font-mono">
                    Proposal #{coordStatus.proposalId}
                  </span>
                )}
              </div>
              <div className="text-[10px] text-zinc-500">
                Your status: <span className="text-zinc-300 font-mono">{myStatus}</span>
              </div>
              {/* Show aggregate tally only (not individual worker votes) */}
              {coordStatus.tally && (
                <div className="p-2.5 rounded-lg bg-green-950/30 border border-green-900/40">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-900/60 text-green-400">
                    AGGREGATE RESULT
                  </span>
                  <p
                    className={`text-lg font-bold mt-1 ${
                      coordStatus.tally.decision === "Approved"
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {coordStatus.tally.decision}
                  </p>
                  <div className="flex gap-3 mt-1 text-[10px] text-zinc-500">
                    <span className="text-green-400">{coordStatus.tally.approved}Y</span>
                    <span className="text-red-400">{coordStatus.tally.rejected}N</span>
                    <span>{coordStatus.tally.workerCount} agents</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Past decisions — only proposals this worker participated in */}
      <div className="rounded-xl border border-zinc-800 bg-[#0a0f0a]/80 p-5">
        <h3 className="text-sm font-semibold text-zinc-100 mb-4 font-mono">
          // My Past Decisions
        </h3>
        {myProposals.length === 0 ? (
          <p className="text-xs text-zinc-600 font-mono">No proposals voted on yet</p>
        ) : (
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {myProposals.map((p) => (
              <div
                key={p.proposalId}
                className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-800/60 text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-zinc-400 font-bold">#{p.proposalId}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                      p.status === "completed"
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : "bg-zinc-500/20 text-zinc-400 border-zinc-500/30"
                    }`}
                  >
                    {p.status}
                  </span>
                  {p.decision && (
                    <span
                      className={`font-semibold ${
                        p.decision === "Approved" ? "text-green-400" : "text-red-400"
                      }`}
                    >
                      {p.decision}
                    </span>
                  )}
                </div>
                {p.approved != null && (
                  <span className="text-zinc-500">
                    {p.approved}Y / {p.rejected}N
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

/* ─── Page Shell ─────────────────────────────────────────────────────────── */

function PageShell({
  children,
  accountId,
  onDisconnect,
}: {
  children: React.ReactNode;
  accountId?: string | null;
  onDisconnect?: () => void;
}) {
  return (
    <div className="min-h-screen bg-[#050505] p-6 md:p-10 max-w-4xl mx-auto">
      <div className="fixed inset-0 cyber-grid pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none opacity-30" />

      <div className="relative z-10">
        <header className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src="/logo-iso.svg" alt="Delibera" className="h-8 w-8" />
              <h1 className="text-xl font-bold text-zinc-100 font-mono">Delibera</h1>
            </Link>
            {accountId && onDisconnect && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 font-mono truncate max-w-[180px]">
                  {accountId}
                </span>
                <button
                  onClick={onDisconnect}
                  className="text-[10px] px-3 py-1.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-400
                             hover:border-zinc-600 hover:text-zinc-300 transition-colors font-mono"
                >
                  disconnect
                </button>
              </div>
            )}
          </div>
          <p className="text-sm text-zinc-500 font-mono">
            Worker Dashboard &middot; your agent identity &amp; decisions
          </p>
        </header>

        {children}

        <footer className="mt-8 text-center text-[10px] text-zinc-700 font-mono">
          NEAR Protocol &middot; NEAR AI &middot; Shade Agents &middot; Ensue Network &middot; Storacha
        </footer>
      </div>
    </div>
  );
}

