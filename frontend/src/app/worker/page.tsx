"use client";

import { useCallback } from "react";
import Link from "next/link";
import WorkerCard from "../components/WorkerCard";
import StatusDot from "../components/StatusDot";
import { usePolling } from "@/lib/use-polling";
import { useAuth } from "@/lib/auth";
import {
  getCoordinatorStatus,
  getWorkerStatuses,
  getOnChainState,
  type CoordinatorStatus,
  type WorkerStatuses,
  type OnChainState,
  type OnChainProposal,
  type ProposalState,
} from "@/lib/api";

const STATE_COLORS: Record<ProposalState, string> = {
  Created: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  WorkersCompleted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Finalized: "bg-green-500/20 text-green-400 border-green-500/30",
  TimedOut: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default function WorkerDashboard() {
  const { accountId, role, workerId, connect, disconnect, connecting } = useAuth();

  const coordFetcher = useCallback(getCoordinatorStatus, []);
  const workerFetcher = useCallback(getWorkerStatuses, []);
  const chainFetcher = useCallback(getOnChainState, []);

  const { data: coordStatus } = usePolling<CoordinatorStatus>(coordFetcher, 2000);
  const { data: workerStatuses, error: workerError } =
    usePolling<WorkerStatuses>(workerFetcher, 2000);
  const { data: chainState } = usePolling<OnChainState>(chainFetcher, 5000);

  // Not connected — show connect prompt
  if (!accountId) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-sm text-zinc-500 font-mono mb-6">
            Connect your NEAR wallet to view your worker dashboard
          </p>
          <button
            onClick={connect}
            disabled={connecting}
            className="px-6 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30
                       text-sm font-semibold text-[#00ff41] font-mono
                       hover:bg-[#00ff41]/15 transition-all disabled:opacity-40"
          >
            {connecting ? "connecting..." : "connect wallet"}
          </button>
        </div>
      </PageShell>
    );
  }

  // Connected but not a registered worker
  if (role !== "worker" || !workerId) {
    return (
      <PageShell accountId={accountId} onDisconnect={disconnect}>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-sm text-zinc-500 font-mono mb-2">
            Account <span className="text-zinc-300">{accountId}</span> is not a registered worker.
          </p>
          <p className="text-xs text-zinc-600 font-mono mb-6">
            Ask the coordinator to register your account.
          </p>
          <Link
            href="/dashboard"
            className="text-xs px-4 py-2 rounded border border-zinc-700 text-zinc-400 font-mono
                       hover:border-zinc-600 hover:text-zinc-300 transition-all"
          >
            go to coordinator dashboard
          </Link>
        </div>
      </PageShell>
    );
  }

  // Authenticated worker view
  const myStatus = workerStatuses?.workers[workerId] || "unknown";

  // Find finalized proposals to show aggregate decisions (no other workers' details)
  const proposals = chainState?.proposals ?? [];
  const finalizedProposals = proposals
    .filter((p) => p.proposal.state === "Finalized")
    .slice(-10)
    .reverse();

  return (
    <PageShell accountId={accountId} onDisconnect={disconnect}>
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Own Identity (full WorkerCard with identity expansion) */}
        <WorkerCard
          workerId={workerId}
          label={workerId}
          port={0}
          status={workerError ? "offline" : myStatus}
        />

        {/* Current proposal status */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="text-sm font-semibold text-zinc-100 mb-3 font-mono">
            // Current Proposal
          </h3>
          {coordStatus?.status === "idle" || !coordStatus ? (
            <p className="text-xs text-zinc-600 font-mono">No active proposal</p>
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

      {/* Finalized Proposals (aggregate only — no individual worker data) */}
      <div className="rounded-xl border border-zinc-800 bg-[#0a0f0a]/80 p-5">
        <h3 className="text-sm font-semibold text-zinc-100 mb-4 font-mono">
          // Past Decisions (On-Chain)
        </h3>
        {finalizedProposals.length === 0 ? (
          <p className="text-xs text-zinc-600 font-mono">No finalized proposals yet</p>
        ) : (
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {finalizedProposals.map(({ proposalId, proposal }) => (
              <FinalizedProposalRow
                key={proposalId}
                proposalId={proposalId}
                proposal={proposal}
              />
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
              <div
                className="h-8 w-8 rounded border border-[#00ff41]/30 bg-[#00ff41]/10
                            flex items-center justify-center text-xs font-bold font-mono
                            text-[#00ff41] text-glow-green"
              >
                S
              </div>
              <h1 className="text-xl font-bold text-zinc-100 font-mono">ShadeBoard</h1>
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
          NEAR Protocol &middot; NEAR AI &middot; Shade Agents &middot; Ensue Network &middot; Nova SDK
        </footer>
      </div>
    </div>
  );
}

/* ─── Finalized Proposal Row (aggregate only) ────────────────────────────── */

function FinalizedProposalRow({
  proposalId,
  proposal,
}: {
  proposalId: number;
  proposal: OnChainProposal;
}) {
  const parsed = proposal.finalized_result
    ? (() => {
        try {
          return JSON.parse(proposal.finalized_result);
        } catch {
          return null;
        }
      })()
    : null;

  const isVote = parsed && typeof parsed.approved === "number";

  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-800/60 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-mono text-zinc-400 font-bold">#{proposalId}</span>
        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${STATE_COLORS[proposal.state]}`}
        >
          {proposal.state}
        </span>
        {isVote && (
          <span
            className={`font-semibold ${
              parsed.decision === "Approved" ? "text-green-400" : "text-red-400"
            }`}
          >
            {parsed.decision}
          </span>
        )}
      </div>
      {isVote && (
        <span className="text-zinc-500">
          {parsed.approved}Y / {parsed.rejected}N
        </span>
      )}
    </div>
  );
}
