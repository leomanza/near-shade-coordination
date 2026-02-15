"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/use-polling";
import {
  getOnChainState,
  triggerVote,
  type OnChainState,
  type ProposalState,
  type OnChainProposal,
} from "@/lib/api";

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

export default function ContractStatePanel() {
  const fetcher = useCallback(getOnChainState, []);
  const { data: state, error } = usePolling<OnChainState>(fetcher, 5000);
  const [filter, setFilter] = useState<ProposalState | "All">("All");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [proposalText, setProposalText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const proposals = state?.proposals ?? [];
  const filtered =
    filter === "All"
      ? proposals
      : proposals.filter((p) => p.proposal.state === filter);

  const countByState = (s: ProposalState) =>
    proposals.filter((p) => p.proposal.state === s).length;

  const handleSubmitProposal = async () => {
    if (!proposalText.trim() || submitting) return;
    setSubmitting(true);
    try {
      await triggerVote(proposalText.trim());
      setProposalText("");
    } catch (err) {
      console.error("Failed to submit proposal:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-zinc-100">
          ShadeBoard
        </h3>
        <a
          href={EXPLORER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono px-2 py-1 rounded-md bg-zinc-800 text-blue-400 hover:text-blue-300 hover:bg-zinc-700 transition-colors"
        >
          Explorer &rarr;
        </a>
      </div>

      {error || !state ? (
        <p className="text-xs text-zinc-500">Unable to read contract state</p>
      ) : (
        <div className="space-y-3">
          {/* Manifesto */}
          {state.manifesto && (
            <div className="p-2.5 rounded-lg bg-zinc-800/40 border border-zinc-700/50">
              <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                Manifesto
              </p>
              <p className="text-[10px] text-zinc-400 leading-relaxed line-clamp-3">
                {state.manifesto.text}
              </p>
              <p className="text-[9px] font-mono text-zinc-600 mt-1">
                hash: {state.manifesto.hash.slice(0, 16)}...
              </p>
            </div>
          )}

          {/* Submit Proposal */}
          <div className="space-y-1.5">
            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
              Submit Proposal for AI Vote
            </p>
            <textarea
              value={proposalText}
              onChange={(e) => setProposalText(e.target.value)}
              placeholder="Describe a proposal for the AI agents to vote on..."
              className="w-full text-xs bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-2 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-600 resize-none"
              rows={2}
            />
            <button
              onClick={handleSubmitProposal}
              disabled={!proposalText.trim() || submitting}
              className="text-[10px] px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Submitting..." : "Submit for Vote"}
            </button>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Total" value={String(proposals.length)} />
            <Stat
              label="Created"
              value={String(countByState("Created"))}
              color="text-yellow-400"
            />
            <Stat
              label="Finalized"
              value={String(countByState("Finalized"))}
              color="text-green-400"
            />
            <Stat
              label="Timed Out"
              value={String(countByState("TimedOut"))}
              color="text-red-400"
            />
          </div>

          <div className="text-xs text-zinc-500">
            <span className="text-zinc-600">Owner:</span>{" "}
            <span className="font-mono">{state.owner}</span>
          </div>

          {/* State filter pills */}
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATES.map((s) => {
              const count =
                s === "All" ? proposals.length : countByState(s as ProposalState);
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
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {filtered
                .slice()
                .reverse()
                .map(({ proposalId, proposal }) => (
                  <ProposalCard
                    key={proposalId}
                    proposalId={proposalId}
                    proposal={proposal}
                    expanded={expandedId === proposalId}
                    onToggle={() =>
                      setExpandedId(
                        expandedId === proposalId ? null : proposalId
                      )
                    }
                  />
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProposalCard({
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
        try {
          return JSON.parse(proposal.finalized_result);
        } catch {
          return null;
        }
      })()
    : null;

  const isVote = parsed && typeof parsed.approved === "number";
  const timeAgo = formatTimeAgo(proposal.timestamp);

  return (
    <div className="rounded-lg bg-zinc-800/60 text-xs overflow-hidden">
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-2 hover:bg-zinc-800/80 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-zinc-400 font-bold">
            #{proposalId}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${STATE_COLORS[proposal.state]}`}
          >
            {proposal.state}
          </span>
          {parsed && isVote && (
            <span
              className={`font-semibold ${
                parsed.decision === "Approved"
                  ? "text-green-400"
                  : "text-red-400"
              }`}
            >
              {parsed.decision}
            </span>
          )}
          {parsed && !isVote && (
            <span className="text-green-400 font-mono font-bold">
              {parsed.aggregatedValue}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isVote && parsed && (
            <span className="text-zinc-500">
              {parsed.approved}Y / {parsed.rejected}N
            </span>
          )}
          {proposal.worker_submissions.length > 0 && !isVote && (
            <span className="text-zinc-600">
              {proposal.worker_submissions.length} workers
            </span>
          )}
          <span className="text-zinc-600">{timeAgo}</span>
          <span className="text-zinc-600">{expanded ? "\u25B2" : "\u25BC"}</span>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-zinc-700/50">
          <div className="pt-2 space-y-1">
            <Detail label="Requester" value={truncateAddr(proposal.requester)} mono />
            <Detail
              label="Config Hash"
              value={proposal.config_hash.slice(0, 16) + "..."}
              mono
            />
            <Detail label="Task Config" value={proposal.task_config} />
          </div>

          {/* Worker submissions with vote badges */}
          {proposal.worker_submissions.length > 0 && (
            <div>
              <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                On-chain Submissions (nullifier)
              </p>
              <p className="text-[9px] text-zinc-600 mb-1">
                Individual votes stay private in Ensue. Only hashes recorded on-chain.
              </p>
              <div className="space-y-1">
                {proposal.worker_submissions.map((ws) => (
                  <div
                    key={ws.worker_id}
                    className="flex items-center justify-between p-1.5 rounded bg-zinc-900/60"
                  >
                    <span className="font-mono text-zinc-400">
                      {ws.worker_id}
                    </span>
                    <span className="font-mono text-zinc-600 text-[9px]">
                      {ws.result_hash.slice(0, 16)}...
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vote tally visualization */}
          {parsed && isVote && (
            <div>
              <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                Vote Result
              </p>
              <div className="p-2 rounded bg-zinc-900/60 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span
                    className={`font-bold ${
                      parsed.decision === "Approved"
                        ? "text-green-400"
                        : "text-red-400"
                    }`}
                  >
                    {parsed.decision}
                  </span>
                  <span className="text-zinc-500 text-[10px]">
                    {parsed.workerCount} agents voted
                  </span>
                </div>
                {/* Vote bar */}
                <div className="flex h-2 rounded-full overflow-hidden bg-zinc-700">
                  {parsed.approved > 0 && (
                    <div
                      className="bg-green-500 transition-all"
                      style={{
                        width: `${(parsed.approved / parsed.workerCount) * 100}%`,
                      }}
                    />
                  )}
                  {parsed.rejected > 0 && (
                    <div
                      className="bg-red-500 transition-all"
                      style={{
                        width: `${(parsed.rejected / parsed.workerCount) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="flex justify-between text-[9px]">
                  <span className="text-green-400">
                    {parsed.approved} Approved
                  </span>
                  <span className="text-red-400">
                    {parsed.rejected} Rejected
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Legacy numeric result */}
          {parsed && !isVote && (
            <div>
              <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                Finalized Result
              </p>
              <div className="p-2 rounded bg-zinc-900/60 font-mono">
                <span className="text-green-400 font-bold">
                  Aggregated: {parsed.aggregatedValue}
                </span>
                <span className="text-zinc-600 ml-2">
                  ({parsed.workerCount} workers)
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-2 text-[10px]">
      <span className="text-zinc-600 shrink-0">{label}:</span>
      <span
        className={`text-zinc-400 truncate ${mono ? "font-mono" : ""}`}
      >
        {value}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="p-2 rounded-lg bg-zinc-800/40 text-center">
      <p className={`text-lg font-bold font-mono ${color || "text-zinc-200"}`}>
        {value}
      </p>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">
        {label}
      </p>
    </div>
  );
}

function truncateAddr(addr: string): string {
  if (addr.length <= 24) return addr;
  return addr.slice(0, 12) + "..." + addr.slice(-8);
}

function formatTimeAgo(nanoseconds: number): string {
  const ms = nanoseconds / 1_000_000;
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
