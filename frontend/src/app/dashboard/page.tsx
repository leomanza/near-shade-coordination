"use client";

import { useCallback, useState } from "react";
import StatusDot from "../components/StatusDot";
import { usePolling } from "@/lib/use-polling";
import {
  getOnChainState,
  getCoordinatorStatus,
  getWorkerStatuses,
  getCoordinatorHealth,
  type OnChainState,
  type OnChainProposal,
  type ProposalState,
  type CoordinatorStatus,
  type WorkerStatuses,
} from "@/lib/api";
import Link from "next/link";

const CONTRACT_ID =
  process.env.NEXT_PUBLIC_contractId || "ac-proxy.agents-coordinator.testnet";
const EXPLORER_URL = `https://testnet.nearblocks.io/address/${CONTRACT_ID}`;

const STATE_COLORS: Record<ProposalState, string> = {
  Created: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  WorkersCompleted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Finalized: "bg-green-500/20 text-green-400 border-green-500/30",
  TimedOut: "bg-red-500/20 text-red-400 border-red-500/30",
};

const ALL_STATES: Array<ProposalState | "All"> = [
  "All",
  "Created",
  "WorkersCompleted",
  "Finalized",
  "TimedOut",
];

export default function PublicDashboard() {
  const chainFetcher = useCallback(getOnChainState, []);
  const coordFetcher = useCallback(getCoordinatorStatus, []);
  const workerFetcher = useCallback(getWorkerStatuses, []);
  const healthFetcher = useCallback(getCoordinatorHealth, []);

  const { data: chainState, error: chainError } = usePolling<OnChainState>(chainFetcher, 5000);
  const { data: coordStatus, error: coordError } = usePolling<CoordinatorStatus>(coordFetcher, 3000);
  const { data: workerStatuses, error: workerError } = usePolling<WorkerStatuses>(workerFetcher, 3000);
  const { error: healthError } = usePolling(healthFetcher, 5000);

  const coordinatorOnline = !healthError && !coordError;
  const proposals = chainState?.proposals ?? [];
  const workers = chainState?.registeredWorkers?.filter((w) => w.active) ?? [];

  return (
    <div className="min-h-screen bg-[#050505] p-6 md:p-10 max-w-6xl mx-auto">
      <div className="fixed inset-0 cyber-grid pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none opacity-30" />

      <div className="relative z-10">
        {/* Header */}
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
            <div className="flex items-center gap-2">
              <Link
                href="/coordinator"
                className="text-xs px-4 py-2 rounded border border-[#00ff41]/20 text-[#00ff41]/80
                           hover:border-[#00ff41]/50 hover:text-[#00ff41] transition-all font-mono
                           hover:shadow-[0_0_12px_rgba(0,255,65,0.1)]"
              >
                coordinator &gt;
              </Link>
              <Link
                href="/worker"
                className="text-xs px-4 py-2 rounded border border-zinc-800 text-zinc-500
                           hover:border-zinc-600 hover:text-zinc-300 transition-all font-mono"
              >
                worker
              </Link>
            </div>
          </div>
          <p className="text-sm text-zinc-500 font-mono">
            Public Dashboard &middot; on-chain governance state
          </p>
        </header>

        {/* System Status Bar */}
        <div className="flex items-center gap-4 mb-6 p-3 rounded border border-zinc-800 bg-[#0a0f0a]/80 flex-wrap">
          <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
            <StatusDot status={coordinatorOnline ? "completed" : "offline"} />
            <span>Coordinator</span>
          </div>
          {workers.map((w) => {
            const status = workerStatuses?.workers[w.worker_id] || "unknown";
            return (
              <div key={w.worker_id} className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
                <StatusDot status={workerError ? "offline" : status} />
                <span>{w.worker_id}</span>
              </div>
            );
          })}
          {workers.length === 0 && (
            <span className="text-xs text-zinc-600 font-mono">No registered workers</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <a
              href={EXPLORER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono px-2 py-1 rounded-md bg-zinc-800 text-blue-400 hover:text-blue-300 hover:bg-zinc-700 transition-colors"
            >
              Explorer &rarr;
            </a>
          </div>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {/* Contract Info */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-3">Contract</h3>
            <div className="space-y-2 text-xs">
              <div className="font-mono text-zinc-500 truncate" title={CONTRACT_ID}>
                {CONTRACT_ID}
              </div>
              {chainState && (
                <>
                  <div className="text-zinc-500">
                    <span className="text-zinc-600">Owner:</span>{" "}
                    <span className="font-mono">{chainState.owner}</span>
                  </div>
                  <div className="text-zinc-500">
                    <span className="text-zinc-600">Workers:</span>{" "}
                    <span className="font-mono">{workers.length} active</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Manifesto */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-3">Manifesto</h3>
            {chainState?.manifesto ? (
              <div className="space-y-2">
                <p className="text-[10px] text-zinc-400 leading-relaxed line-clamp-4">
                  {chainState.manifesto.text}
                </p>
                <p className="text-[9px] font-mono text-zinc-600">
                  hash: {chainState.manifesto.hash.slice(0, 16)}...
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-600">No manifesto set</p>
            )}
          </div>

          {/* Current Status */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-3">Current Status</h3>
            {coordStatus ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <StatusDot status={coordStatus.status} />
                  <span className="text-xs font-mono text-zinc-400">{coordStatus.status}</span>
                </div>
                {coordStatus.proposalId != null && (
                  <p className="text-xs text-zinc-500">
                    Proposal <span className="font-mono text-zinc-300">#{coordStatus.proposalId}</span>
                  </p>
                )}
                {coordStatus.tally && (
                  <div className="p-2 rounded-lg bg-green-950/30 border border-green-900/40">
                    <p className={`text-sm font-bold ${coordStatus.tally.decision === "Approved" ? "text-green-400" : "text-red-400"}`}>
                      {coordStatus.tally.decision}
                    </p>
                    <div className="flex gap-2 mt-1 text-[10px] text-zinc-500">
                      <span className="text-green-400">{coordStatus.tally.approved}Y</span>
                      <span className="text-red-400">{coordStatus.tally.rejected}N</span>
                      <span>{coordStatus.tally.workerCount} agents</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-zinc-600">Loading...</p>
            )}
          </div>
        </div>

        {/* Registered Workers */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 mb-6">
          <h3 className="text-sm font-semibold text-zinc-100 mb-4">Registered Workers</h3>
          {workers.length === 0 ? (
            <p className="text-xs text-zinc-600">No registered workers</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {workers.map((w) => {
                const status = workerStatuses?.workers[w.worker_id] || "unknown";
                return (
                  <div key={w.worker_id} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/40">
                    <StatusDot status={workerError ? "offline" : status} />
                    <div>
                      <p className="text-xs font-mono text-zinc-300 font-semibold">{w.worker_id}</p>
                      {w.account_id && (
                        <p className="text-[10px] font-mono text-zinc-600 truncate max-w-[200px]">
                          {w.account_id}
                        </p>
                      )}
                    </div>
                    <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                      {workerError ? "offline" : status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* On-Chain Proposals */}
        <ProposalList
          proposals={proposals}
          currentProposalId={chainState?.currentProposalId ?? 0}
          loading={!chainState && !chainError}
          error={!!chainError}
        />

        {/* Footer */}
        <footer className="mt-8 text-center text-[10px] text-zinc-700 font-mono">
          NEAR Protocol &middot; NEAR AI &middot; Shade Agents &middot; Ensue Network &middot; Nova SDK
        </footer>
      </div>
    </div>
  );
}

/* ─── Proposal List ──────────────────────────────────────────────────── */

function ProposalList({
  proposals,
  currentProposalId,
  loading,
  error,
}: {
  proposals: Array<{ proposalId: number; proposal: OnChainProposal }>;
  currentProposalId: number;
  loading: boolean;
  error: boolean;
}) {
  const [filter, setFilter] = useState<ProposalState | "All">("All");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const filtered =
    filter === "All"
      ? proposals
      : proposals.filter((p) => p.proposal.state === filter);

  const countByState = (s: ProposalState) =>
    proposals.filter((p) => p.proposal.state === s).length;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-zinc-100">On-Chain Proposals</h3>
        <span className="text-[10px] font-mono text-zinc-600">
          next ID: {currentProposalId}
        </span>
      </div>

      {error ? (
        <p className="text-xs text-zinc-500">Unable to read contract state</p>
      ) : loading ? (
        <p className="text-xs text-zinc-600 font-mono">Loading...</p>
      ) : (
        <div className="space-y-3">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Total" value={String(proposals.length)} />
            <Stat label="Created" value={String(countByState("Created"))} color="text-yellow-400" />
            <Stat label="Finalized" value={String(countByState("Finalized"))} color="text-green-400" />
            <Stat label="Timed Out" value={String(countByState("TimedOut"))} color="text-red-400" />
          </div>

          {/* Filter pills */}
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATES.map((s) => {
              const count = s === "All" ? proposals.length : countByState(s as ProposalState);
              const isActive = filter === s;
              return (
                <button
                  key={s}
                  onClick={() => setFilter(s)}
                  className={`text-[10px] px-2 py-1 rounded-md border transition-colors ${
                    isActive
                      ? "bg-zinc-700 border-zinc-600 text-zinc-200"
                      : "bg-zinc-800/40 border-zinc-800 text-zinc-500 hover:text-zinc-400 hover:border-zinc-700"
                  }`}
                >
                  {s} ({count})
                </button>
              );
            })}
          </div>

          {/* Proposal list */}
          {filtered.length === 0 ? (
            <p className="text-xs text-zinc-600 text-center py-3">
              No proposals {filter !== "All" ? `in ${filter} state` : ""}
            </p>
          ) : (
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {filtered
                .slice()
                .reverse()
                .map(({ proposalId, proposal }) => (
                  <ProposalRow
                    key={proposalId}
                    proposalId={proposalId}
                    proposal={proposal}
                    expanded={expandedId === proposalId}
                    onToggle={() => setExpandedId(expandedId === proposalId ? null : proposalId)}
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Proposal Row ───────────────────────────────────────────────────── */

function ProposalRow({
  proposalId,
  proposal,
  expanded,
  onToggle,
}: {
  proposalId: number;
  proposal: OnChainProposal;
  expanded: boolean;
  onToggle: () => void;
}) {
  const parsed = proposal.finalized_result
    ? (() => {
        try { return JSON.parse(proposal.finalized_result); }
        catch { return null; }
      })()
    : null;

  const isVote = parsed && typeof parsed.approved === "number";
  const timeAgo = formatTimeAgo(proposal.timestamp);

  return (
    <div className="rounded-lg bg-zinc-800/60 text-xs overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-2.5 hover:bg-zinc-800/80 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-zinc-400 font-bold">#{proposalId}</span>
          <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${STATE_COLORS[proposal.state]}`}>
            {proposal.state}
          </span>
          {isVote && (
            <span className={`font-semibold ${parsed.decision === "Approved" ? "text-green-400" : "text-red-400"}`}>
              {parsed.decision}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isVote && (
            <span className="text-zinc-500">{parsed.approved}Y / {parsed.rejected}N</span>
          )}
          {proposal.worker_submissions.length > 0 && (
            <span className="text-zinc-600">{proposal.worker_submissions.length} workers</span>
          )}
          <span className="text-zinc-600">{timeAgo}</span>
          <span className="text-zinc-600">{expanded ? "\u25B2" : "\u25BC"}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-zinc-700/50">
          <div className="pt-2 space-y-1 text-[10px]">
            <div className="flex gap-2">
              <span className="text-zinc-600 shrink-0">Requester:</span>
              <span className="text-zinc-400 font-mono truncate">{proposal.requester}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-zinc-600 shrink-0">Config Hash:</span>
              <span className="text-zinc-400 font-mono">{proposal.config_hash.slice(0, 16)}...</span>
            </div>
          </div>

          {/* Worker submissions (hashes only — no private data) */}
          {proposal.worker_submissions.length > 0 && (
            <div>
              <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                Submissions (nullifier hashes)
              </p>
              <div className="space-y-1">
                {proposal.worker_submissions.map((ws) => (
                  <div key={ws.worker_id} className="flex items-center justify-between p-1.5 rounded bg-zinc-900/60">
                    <span className="font-mono text-zinc-400 text-[10px]">{ws.worker_id}</span>
                    <span className="font-mono text-zinc-600 text-[9px]">{ws.result_hash.slice(0, 16)}...</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vote result */}
          {isVote && (
            <div className="p-2 rounded bg-zinc-900/60 space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className={`font-bold ${parsed.decision === "Approved" ? "text-green-400" : "text-red-400"}`}>
                  {parsed.decision}
                </span>
                <span className="text-zinc-500">{parsed.workerCount} agents voted</span>
              </div>
              <div className="flex h-1.5 rounded-full overflow-hidden bg-zinc-700">
                {parsed.approved > 0 && (
                  <div className="bg-green-500" style={{ width: `${(parsed.approved / parsed.workerCount) * 100}%` }} />
                )}
                {parsed.rejected > 0 && (
                  <div className="bg-red-500" style={{ width: `${(parsed.rejected / parsed.workerCount) * 100}%` }} />
                )}
              </div>
              <div className="flex justify-between text-[9px]">
                <span className="text-green-400">{parsed.approved} Approved</span>
                <span className="text-red-400">{parsed.rejected} Rejected</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="p-2 rounded-lg bg-zinc-800/40 text-center">
      <p className={`text-lg font-bold font-mono ${color || "text-zinc-200"}`}>{value}</p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function formatTimeAgo(nanoseconds: number): string {
  const ms = nanoseconds / 1_000_000;
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
