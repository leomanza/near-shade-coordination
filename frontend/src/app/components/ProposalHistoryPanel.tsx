"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/use-polling";
import {
  getProposalHistory,
  getProposalDetail,
  type ProposalSummary,
  type ProposalDetail,
} from "@/lib/api";

export default function ProposalHistoryPanel() {
  const fetcher = useCallback(async () => {
    const data = await getProposalHistory();
    return data?.proposals ?? null;
  }, []);
  const { data: proposals, error } = usePolling<ProposalSummary[]>(fetcher, 10000);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProposalDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  async function toggleExpand(proposalId: string) {
    if (expandedId === proposalId) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(proposalId);
    setLoadingDetail(true);
    const d = await getProposalDetail(proposalId);
    setDetail(d);
    setLoadingDetail(false);
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#0a0f0a]/80 p-5">
      <h3 className="text-sm font-semibold text-zinc-100 mb-4 font-mono">
        // Proposal History (Ensue Archive)
      </h3>

      {error || !proposals ? (
        <p className="text-xs text-zinc-600 font-mono">No archived proposals yet</p>
      ) : proposals.length === 0 ? (
        <p className="text-xs text-zinc-600 font-mono">No archived proposals yet</p>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto">
          {proposals
            .slice()
            .reverse()
            .map((p) => (
              <div key={p.proposalId} className="rounded-lg bg-zinc-800/60 text-xs overflow-hidden">
                <button
                  onClick={() => toggleExpand(p.proposalId)}
                  className="w-full flex items-center justify-between p-2.5 hover:bg-zinc-800/80 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-zinc-400 font-bold">#{p.proposalId}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                        p.status === "completed"
                          ? "bg-green-500/20 text-green-400 border-green-500/30"
                          : p.status === "failed"
                            ? "bg-red-500/20 text-red-400 border-red-500/30"
                            : "bg-zinc-700/40 text-zinc-400 border-zinc-600/30"
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
                  <div className="flex items-center gap-2 text-zinc-600">
                    {p.workerCount !== null && <span>{p.workerCount} agents</span>}
                    {p.approved !== null && (
                      <span>
                        {p.approved}Y/{p.rejected}N
                      </span>
                    )}
                    <span>{expandedId === p.proposalId ? "\u25B2" : "\u25BC"}</span>
                  </div>
                </button>

                {expandedId === p.proposalId && (
                  <div className="px-3 pb-3 border-t border-zinc-700/50">
                    {loadingDetail ? (
                      <p className="text-[10px] text-zinc-600 pt-2 font-mono">Loading...</p>
                    ) : detail ? (
                      <div className="pt-2 space-y-2">
                        {/* Config */}
                        {detail.config ? (
                          <div className="text-[10px]">
                            <span className="text-zinc-600">Config:</span>{" "}
                            <span className="text-zinc-400 font-mono">
                              {typeof detail.config === "string"
                                ? detail.config.slice(0, 100)
                                : JSON.stringify(detail.config).slice(0, 100)}
                            </span>
                          </div>
                        ) : null}
                        {/* Tally */}
                        {detail.tally && (
                          <div className="p-2 rounded bg-zinc-900/60 space-y-1">
                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">
                              Aggregate Tally
                            </p>
                            <div className="flex items-center gap-3 text-[10px]">
                              <span
                                className={`font-bold ${
                                  detail.tally.decision === "Approved"
                                    ? "text-green-400"
                                    : "text-red-400"
                                }`}
                              >
                                {detail.tally.decision}
                              </span>
                              <span className="text-zinc-500">
                                {detail.tally.approved}Y / {detail.tally.rejected}N
                              </span>
                              <span className="text-zinc-600">
                                {detail.tally.workerCount} agents
                              </span>
                            </div>
                          </div>
                        )}
                        {/* Per-worker results (coordinator can see archived reasoning) */}
                        {detail.workers && Object.keys(detail.workers).length > 0 && (
                          <div>
                            <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                              Worker Results (Ensue Archive)
                            </p>
                            <div className="space-y-1">
                              {Object.entries(detail.workers).map(([wId, wData]) => {
                                const result = wData.result as Record<string, unknown> | null;
                                const output = result?.output as Record<string, unknown> | undefined;
                                const vote = output?.vote as string | undefined;
                                return (
                                  <div
                                    key={wId}
                                    className="p-1.5 rounded bg-zinc-900/60 text-[10px]"
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-mono text-zinc-400">{wId}</span>
                                      {vote ? (
                                        <span
                                          className={`font-semibold ${
                                            vote === "Approved"
                                              ? "text-green-400"
                                              : "text-red-400"
                                          }`}
                                        >
                                          {vote}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-[10px] text-zinc-600 pt-2 font-mono">
                        Failed to load details
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
