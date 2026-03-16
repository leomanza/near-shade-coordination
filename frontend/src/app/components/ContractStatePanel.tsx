"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/use-polling";
import {
  getOnChainState,
  triggerVote,
  getActiveContractId,
  type OnChainState,
  type ProposalState,
  type OnChainProposal,
} from "@/lib/api";

const NEAR_NETWORK = process.env.NEXT_PUBLIC_NEAR_NETWORK || "testnet";
const EXPLORER_BASE = NEAR_NETWORK === "mainnet"
  ? "https://nearblocks.io/address/"
  : "https://testnet.nearblocks.io/address/";

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

interface ContractStatePanelProps {
  /** Connected account ID — enables owner actions when it matches contract owner */
  accountId?: string | null;
  /** Sign and send a transaction via the connected wallet */
  signAndSendTransaction?: (params: {
    receiverId: string;
    actions: Array<{
      type: string;
      params: {
        methodName: string;
        args: Record<string, unknown>;
        gas: string;
        deposit: string;
      };
    }>;
  }) => Promise<unknown>;
}

export default function ContractStatePanel({ accountId, signAndSendTransaction }: ContractStatePanelProps = {}) {
  const fetcher = useCallback(getOnChainState, []);
  const { data: state, error, refresh } = usePolling<OnChainState>(fetcher, 5000);
  const [filter, setFilter] = useState<ProposalState | "All">("All");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [proposalText, setProposalText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [manifestoText, setManifestoText] = useState("");
  const [editingManifesto, setEditingManifesto] = useState(false);
  const [savingManifesto, setSavingManifesto] = useState(false);
  const [manifestoError, setManifestoError] = useState<string | null>(null);
  const [manifestoExpanded, setManifestoExpanded] = useState(false);

  const isOwner = !!(accountId && state && accountId === state.owner);

  async function handleSetManifesto() {
    if (!manifestoText.trim() || savingManifesto || !signAndSendTransaction) return;
    setSavingManifesto(true);
    setManifestoError(null);
    try {
      await signAndSendTransaction({
        receiverId: getActiveContractId(),
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "set_manifesto",
              args: { manifesto_text: manifestoText.trim() },
              gas: "30000000000000",
              deposit: "0",
            },
          },
        ],
      });
      setEditingManifesto(false);
      setManifestoText("");
      // Refresh on-chain state to pick up the new manifesto
      setTimeout(() => refresh(), 2000);
    } catch (err) {
      setManifestoError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setSavingManifesto(false);
    }
  }

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
          Delibera
        </h3>
        <a
          href={`${EXPLORER_BASE}${getActiveContractId()}`}
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
          {state.manifesto && !editingManifesto && (
            <div className="p-2.5 rounded-lg bg-zinc-800/40 border border-zinc-700/50">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
                  Manifesto
                </p>
                {isOwner && (
                  <button
                    onClick={() => { setManifestoText(state.manifesto?.text || ""); setEditingManifesto(true); }}
                    className="text-[9px] px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-300 hover:border-zinc-600 transition-colors font-mono"
                  >
                    edit
                  </button>
                )}
              </div>
              <p className={`text-[10px] text-zinc-400 leading-relaxed whitespace-pre-wrap ${!manifestoExpanded ? "line-clamp-5" : ""}`}>
                {state.manifesto.text}
              </p>
              {state.manifesto.text.length > 200 && (
                <button
                  onClick={() => setManifestoExpanded(!manifestoExpanded)}
                  className="text-[9px] text-zinc-500 hover:text-zinc-300 font-mono mt-1 transition-colors"
                >
                  {manifestoExpanded ? "show less" : "show more"}
                </button>
              )}
              <p className="text-[9px] font-mono text-zinc-600 mt-1">
                hash: {state.manifesto.hash.slice(0, 16)}...
              </p>
            </div>
          )}

          {/* Manifesto Editor — shown when no manifesto exists (owner) or editing */}
          {isOwner && (!state.manifesto || editingManifesto) && (
            <div className="p-2.5 rounded-lg bg-zinc-800/40 border border-[#00ff41]/20">
              <p className="text-[9px] font-bold text-[#00ff41]/70 uppercase tracking-wider mb-1.5">
                {state.manifesto ? "Update Manifesto" : "Set DAO Manifesto"}
              </p>
              {!state.manifesto && (
                <p className="text-[10px] text-zinc-500 mb-2">
                  Define the manifesto that guides your AI agents&apos; deliberation. Required before voting can begin.
                </p>
              )}
              <textarea
                value={manifestoText}
                onChange={(e) => setManifestoText(e.target.value)}
                placeholder="Enter the DAO manifesto — the principles and values that guide agent voting decisions..."
                className="w-full text-xs bg-zinc-900/80 border border-zinc-700/50 rounded-lg p-2 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-[#00ff41]/30 resize-none"
                rows={4}
              />
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  onClick={handleSetManifesto}
                  disabled={!manifestoText.trim() || savingManifesto}
                  className="text-[10px] px-3 py-1.5 rounded-md bg-[#00ff41]/10 border border-[#00ff41]/30 text-[#00ff41] font-semibold hover:bg-[#00ff41]/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-mono"
                >
                  {savingManifesto ? "signing..." : state.manifesto ? "update manifesto" : "set manifesto"}
                </button>
                {editingManifesto && (
                  <button
                    onClick={() => { setEditingManifesto(false); setManifestoText(""); setManifestoError(null); }}
                    className="text-[10px] px-3 py-1.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-300 transition-colors font-mono"
                  >
                    cancel
                  </button>
                )}
              </div>
              {manifestoError && (
                <p className="text-[10px] text-red-400 mt-1">{manifestoError}</p>
              )}
              <p className="text-[9px] text-zinc-600 mt-1.5">
                Stored on-chain via <span className="font-mono">{getActiveContractId()}</span>
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
