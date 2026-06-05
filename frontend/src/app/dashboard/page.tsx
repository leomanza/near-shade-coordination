"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import StatusDot from "../components/StatusDot";
import CoordinatorPanel from "../components/CoordinatorPanel";
import EventLog, { type LogEntry } from "../components/EventLog";
import WorkerCard from "../components/WorkerCard";
import { usePolling } from "@/lib/use-polling";
import {
  getOnChainState,
  getCoordinatorStatus,
  getWorkerStatuses,
  getCoordinatorHealth,
  getActiveContractId,
  getProposalHistory,
  ensureAgentEndpoints,
  type OnChainState,
  type OnChainProposal,
  type ProposalState,
  type CoordinatorStatus,
  type WorkerStatuses,
  type ProposalSummary,
} from "@/lib/api";
import Link from "next/link";

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

type Tab = "overview" | "coordinator" | "workers";

export default function PublicDashboard() {
  const [tab, setTab] = useState<Tab>("overview");

  // Load agent endpoints on mount so DID-based worker URLs resolve correctly
  useEffect(() => { ensureAgentEndpoints(); }, []);

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

  const apiWorkers = workerStatuses?.workers
    ? Object.keys(workerStatuses.workers).map(id => ({ worker_id: id, active: true, account_id: null as string | null, display_name: null as string | null, registered_at: 0, registered_by: '' }))
    : [];
  const onChainWorkers = chainState?.registeredWorkers?.filter((w) => w.active) ?? [];
  const workers = apiWorkers.length > 0 ? apiWorkers : onChainWorkers;

  return (
    <div className="min-h-screen bg-[#050505] p-6 md:p-10 max-w-6xl mx-auto">
      <div className="fixed inset-0 cyber-grid pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none opacity-30" />

      <div className="relative z-10">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src="/logo-iso.svg" alt="Delibera" className="h-8 w-8" />
              <h1 className="text-xl font-bold text-zinc-100 font-mono">Delibera</h1>
            </Link>
            <div className="flex items-center gap-2">
              <a
                href="https://docs.delibera.xyz"
                className="text-xs px-4 py-2 rounded border border-zinc-800 text-zinc-500
                           hover:border-zinc-600 hover:text-zinc-300 transition-all font-mono"
              >
                docs
              </a>
              <Link
                href="/buy"
                className="text-xs px-4 py-2 rounded border border-[#00ff41]/20 text-[#00ff41]/80
                           hover:border-[#00ff41]/50 hover:text-[#00ff41] transition-all font-mono
                           hover:shadow-[0_0_12px_rgba(0,255,65,0.1)]"
              >
                deploy &gt;
              </Link>
            </div>
          </div>
          <p className="text-sm text-zinc-500 font-mono">
            Public Dashboard &middot; demo view
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
            const displayName = workerStatuses?.workerNames?.[w.worker_id];
            const label = displayName || w.account_id || (w.worker_id.startsWith("did:") ? w.worker_id.substring(0, 16) + "..." : w.worker_id);
            return (
              <div key={w.worker_id} className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
                <StatusDot status={workerError ? "offline" : status} />
                <span>{label}</span>
              </div>
            );
          })}
          {workers.length === 0 && (
            <span className="text-xs text-zinc-600 font-mono">No registered workers</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <a
              href={`${EXPLORER_BASE}${getActiveContractId()}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono px-2 py-1 rounded-md bg-zinc-800 text-blue-400 hover:text-blue-300 hover:bg-zinc-700 transition-colors"
            >
              Explorer &rarr;
            </a>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded bg-zinc-900 border border-zinc-800 mb-6">
          {([
            { id: "overview" as Tab, label: "Overview" },
            { id: "coordinator" as Tab, label: "Coordinator View" },
            { id: "workers" as Tab, label: "Workers View" },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 px-3 py-2 rounded text-xs font-mono transition-colors ${
                tab === t.id
                  ? "bg-zinc-800 text-zinc-200"
                  : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {tab === "overview" && (
          <OverviewTab
            chainState={chainState}
            chainError={!!chainError}
            coordStatus={coordStatus}
            coordinatorOnline={coordinatorOnline}
            workers={workers}
            workerStatuses={workerStatuses}
            workerError={!!workerError}
            proposals={proposals}
          />
        )}

        {tab === "coordinator" && (
          <CoordinatorTab
            coordStatus={coordStatus}
            coordinatorOnline={coordinatorOnline}
            workers={workers}
            workerStatuses={workerStatuses}
            workerError={!!workerError}
            proposals={proposals}
            chainState={chainState}
            chainError={!!chainError}
          />
        )}

        {tab === "workers" && (
          <WorkersTab
            workers={workers}
            workerStatuses={workerStatuses}
            workerError={!!workerError}
            coordStatus={coordStatus}
          />
        )}

        {/* Footer */}
        <footer className="mt-8 text-center text-[10px] text-zinc-700 font-mono">
          NEAR Protocol &middot; NEAR AI &middot; Shade Agents &middot; Ensue Network &middot; Storacha
        </footer>
      </div>
    </div>
  );
}

/* ─── Overview Tab ──────────────────────────────────────────────────── */

interface WorkerEntry {
  worker_id: string;
  active: boolean;
  account_id: string | null;
  display_name: string | null;
  registered_at: number;
  registered_by: string;
}

function OverviewTab({
  chainState,
  chainError,
  coordStatus,
  coordinatorOnline,
  workers,
  workerStatuses,
  workerError,
  proposals,
}: {
  chainState: OnChainState | null;
  chainError: boolean;
  coordStatus: CoordinatorStatus | null;
  coordinatorOnline: boolean;
  workers: WorkerEntry[];
  workerStatuses: WorkerStatuses | null;
  workerError: boolean;
  proposals: Array<{ proposalId: number; proposal: OnChainProposal }>;
}) {
  return (
    <>
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="text-sm font-semibold text-zinc-100 mb-3">Contract</h3>
          <div className="space-y-2 text-xs">
            <div className="font-mono text-zinc-500 truncate" title={getActiveContractId()}>
              {getActiveContractId()}
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
              const displayName = workerStatuses?.workerNames?.[w.worker_id];
              const truncatedDid = w.worker_id.startsWith("did:") ? w.worker_id.substring(0, 20) + "..." : null;
              // DID-based worker rows link to the Phase 1.5 detail page;
              // legacy non-DID rows stay as static cards.
              const detailHref = w.worker_id.startsWith("did:")
                ? `/dashboard/worker/${encodeURIComponent(w.worker_id)}`
                : null;
              const rowClass =
                "flex items-center gap-3 p-3 rounded-lg bg-zinc-800/40" +
                (detailHref ? " hover:bg-zinc-800/70 transition-colors" : "");
              const inner = (
                <>
                  <StatusDot status={workerError ? "offline" : status} />
                  <div>
                    <p className="text-xs font-mono text-zinc-300 font-semibold">
                      {displayName || w.account_id || w.worker_id}
                    </p>
                    {(displayName || w.account_id) && truncatedDid && (
                      <p className="text-[10px] font-mono text-zinc-600 truncate max-w-[200px]">
                        {truncatedDid}
                      </p>
                    )}
                  </div>
                  <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">
                    {workerError ? "offline" : status}
                  </span>
                  {detailHref && (
                    <span className="text-zinc-600 text-xs">→</span>
                  )}
                </>
              );
              return detailHref ? (
                <Link key={w.worker_id} href={detailHref} className={rowClass}>
                  {inner}
                </Link>
              ) : (
                <div key={w.worker_id} className={rowClass}>
                  {inner}
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
        error={chainError}
      />
    </>
  );
}

/* ─── Coordinator Tab ─────────────────────────────────────────────── */

function CoordinatorTab({
  coordStatus,
  coordinatorOnline,
  workers,
  workerStatuses,
  workerError,
  proposals,
  chainState,
  chainError,
}: {
  coordStatus: CoordinatorStatus | null;
  coordinatorOnline: boolean;
  workers: WorkerEntry[];
  workerStatuses: WorkerStatuses | null;
  workerError: boolean;
  proposals: Array<{ proposalId: number; proposal: OnChainProposal }>;
  chainState: OnChainState | null;
  chainError: boolean;
}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const prevStatusRef = useRef<Record<string, string>>({});

  const addLog = useCallback((message: string, type: LogEntry["type"] = "info") => {
    setLogs((prev) => [
      ...prev.slice(-99),
      { time: new Date().toLocaleTimeString(), message, type },
    ]);
  }, []);

  useEffect(() => {
    if (!workerStatuses) return;
    const wStatus = workerStatuses.workers;
    for (const [id, status] of Object.entries(wStatus)) {
      const prev = prevStatusRef.current[id];
      if (prev && prev !== status) {
        const type = status === "completed" ? "success" : status === "failed" ? "error" : "info";
        const name = workerStatuses.workerNames?.[id] || truncateDid(id);
        addLog(`${name}: ${prev} -> ${status}`, type);
        if (status === "processing") {
          addLog(`[storacha] ${name}: loading persistent identity...`, "info");
        }
        if (status === "completed" && prev === "processing") {
          addLog(`[storacha] ${name}: decision recorded to persistent memory`, "success");
        }
      }
    }
    if (coordStatus?.status) {
      const prev = prevStatusRef.current["coordinator"];
      if (prev && prev !== coordStatus.status) {
        const type =
          coordStatus.status === "completed" ? "success" :
          coordStatus.status === "failed" ? "error" : "info";
        addLog(`coordinator: ${prev} -> ${coordStatus.status}`, type);
      }
      prevStatusRef.current["coordinator"] = coordStatus.status;
    }
    prevStatusRef.current = { ...prevStatusRef.current, ...wStatus };
  }, [workerStatuses, coordStatus, addLog]);

  return (
    <>
      <div className="p-3 rounded bg-[#00ff41]/5 border border-[#00ff41]/10 mb-6">
        <p className="text-[10px] text-[#00ff41]/60 font-mono">
          Read-only coordinator view &mdash; this is what a coordinator owner sees when managing proposals and workers.
          No wallet required for this demo.
        </p>
      </div>

      {/* Coordinator + Worker Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <CoordinatorPanel status={coordStatus} online={coordinatorOnline} />
        {workers.map((w) => {
          const status = workerStatuses?.workers[w.worker_id] || "unknown";
          const name = workerStatuses?.workerNames?.[w.worker_id] || w.display_name;
          return (
            <WorkerStatusCard
              key={w.worker_id}
              worker={w}
              status={workerError ? "offline" : status}
              displayName={name ?? undefined}
            />
          );
        })}
      </div>

      {/* Voting Flow + Event Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <VotingFlowDiagram coordStatus={coordStatus} workerStatuses={workerStatuses} workers={workers} />
        <EventLog entries={logs} />
      </div>

      {/* Proposals */}
      <ProposalList
        proposals={proposals}
        currentProposalId={chainState?.currentProposalId ?? 0}
        loading={!chainState && !chainError}
        error={chainError}
      />
    </>
  );
}

/* ─── Workers Tab ─────────────────────────────────────────────────── */

function WorkersTab({
  workers,
  workerStatuses,
  workerError,
  coordStatus,
}: {
  workers: WorkerEntry[];
  workerStatuses: WorkerStatuses | null;
  workerError: boolean;
  coordStatus: CoordinatorStatus | null;
}) {
  const [selectedWorker, setSelectedWorker] = useState<string | null>(null);

  // Auto-select first worker
  useEffect(() => {
    if (!selectedWorker && workers.length > 0) {
      setSelectedWorker(workers[0].worker_id);
    }
  }, [workers, selectedWorker]);

  return (
    <>
      <div className="p-3 rounded bg-[#00ff41]/5 border border-[#00ff41]/10 mb-6">
        <p className="text-[10px] text-[#00ff41]/60 font-mono">
          Read-only worker view &mdash; this is what a worker agent owner sees: identity, status, and participation history.
          Select a worker to inspect.
        </p>
      </div>

      {/* Worker selector */}
      {workers.length > 1 && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {workers.map((w) => {
            const status = workerStatuses?.workers[w.worker_id] || "unknown";
            const name = workerStatuses?.workerNames?.[w.worker_id] || w.display_name || w.account_id || truncateDid(w.worker_id);
            const isSelected = selectedWorker === w.worker_id;
            return (
              <button
                key={w.worker_id}
                onClick={() => setSelectedWorker(w.worker_id)}
                className={`flex items-center gap-2 px-3 py-2 rounded border text-xs font-mono transition-colors ${
                  isSelected
                    ? "border-[#00ff41]/30 bg-[#00ff41]/5 text-zinc-200"
                    : "border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400"
                }`}
              >
                <StatusDot status={workerError ? "offline" : status} />
                {name}
              </button>
            );
          })}
        </div>
      )}

      {selectedWorker && (
        <WorkerDetailView
          workerId={selectedWorker}
          workerStatuses={workerStatuses}
          workerError={workerError}
          coordStatus={coordStatus}
          workers={workers}
        />
      )}

      {workers.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-zinc-600 font-mono">No registered workers</p>
        </div>
      )}
    </>
  );
}

/* ─── Worker Detail View ──────────────────────────────────────────── */

function WorkerDetailView({
  workerId,
  workerStatuses,
  workerError,
  coordStatus,
  workers,
}: {
  workerId: string;
  workerStatuses: WorkerStatuses | null;
  workerError: boolean;
  coordStatus: CoordinatorStatus | null;
  workers: WorkerEntry[];
}) {
  const proposalFetcher = useCallback(() => getProposalHistory(workerId), [workerId]);
  const { data: proposalData } = usePolling<{ proposals: ProposalSummary[]; total: number }>(proposalFetcher, 10000);

  const myStatus = workerStatuses?.workers[workerId] || "unknown";
  const worker = workers.find(w => w.worker_id === workerId);
  const displayName = workerStatuses?.workerNames?.[workerId] || worker?.display_name;
  const myProposals = (proposalData?.proposals ?? []).slice(-10).reverse();

  return (
    <>
      {/* Worker identity banner */}
      <div className="flex items-center gap-3 mb-6 p-3 rounded border border-zinc-800 bg-[#0a0f0a]/80">
        <StatusDot status={workerError ? "offline" : myStatus} />
        <div className="min-w-0">
          <span className="text-sm font-semibold text-zinc-100 font-mono">
            {displayName || truncateDid(workerId)}
          </span>
          {displayName && (
            <p className="text-[10px] text-zinc-600 font-mono truncate">{truncateDid(workerId)}</p>
          )}
          {worker?.account_id && (
            <p className="text-[10px] text-zinc-600 font-mono">{worker.account_id}</p>
          )}
        </div>
        <span className="ml-auto text-xs font-mono px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">
          {myStatus}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Worker Card (identity, knowledge) */}
        <WorkerCard
          key={workerId}
          workerId={workerId}
          label={displayName || truncateDid(workerId)}
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
          ) : myStatus === "idle" || myStatus === "unknown" ? (
            <p className="text-xs text-zinc-600 font-mono">
              Active proposal #{coordStatus.proposalId} &mdash; worker not participating
            </p>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs">
                <StatusDot status={coordStatus.status} />
                <span className="text-zinc-400 font-mono">{coordStatus.status}</span>
                {coordStatus.proposalId != null && (
                  <span className="text-zinc-600 font-mono">Proposal #{coordStatus.proposalId}</span>
                )}
              </div>
              <div className="text-[10px] text-zinc-500">
                Worker status: <span className="text-zinc-300 font-mono">{myStatus}</span>
              </div>
              {coordStatus.tally && (
                <div className="p-2.5 rounded-lg bg-green-950/30 border border-green-900/40">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-green-900/60 text-green-400">
                    AGGREGATE RESULT
                  </span>
                  <p className={`text-lg font-bold mt-1 ${coordStatus.tally.decision === "Approved" ? "text-green-400" : "text-red-400"}`}>
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

      {/* Past decisions */}
      <div className="rounded-xl border border-zinc-800 bg-[#0a0f0a]/80 p-5">
        <h3 className="text-sm font-semibold text-zinc-100 mb-4 font-mono">
          // Past Decisions
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
                    <span className={`font-semibold ${p.decision === "Approved" ? "text-green-400" : "text-red-400"}`}>
                      {p.decision}
                    </span>
                  )}
                </div>
                {p.approved != null && (
                  <span className="text-zinc-500">{p.approved}Y / {p.rejected}N</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ─── Worker Status Card ──────────────────────────────────────────── */

function WorkerStatusCard({
  worker,
  status,
  displayName,
}: {
  worker: WorkerEntry;
  status: string;
  displayName?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 font-mono" title={worker.worker_id}>
              {displayName || worker.account_id || truncateDid(worker.worker_id)}
            </h3>
            <p className="text-[10px] text-zinc-600 font-mono truncate max-w-[150px]" title={worker.worker_id}>
              {(displayName || worker.account_id) ? truncateDid(worker.worker_id) : ""}
            </p>
          </div>
        </div>
        <span className="text-xs font-mono px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">
          {status}
        </span>
      </div>
      <p className="text-[10px] text-zinc-600">
        {status === "processing"
          ? "Deliberating..."
          : status === "completed"
            ? "Vote submitted"
            : "Awaiting proposal"}
      </p>
    </div>
  );
}

/* ─── Voting Flow Diagram ─────────────────────────────────────────── */

function VotingFlowDiagram({
  coordStatus,
  workerStatuses,
  workers,
}: {
  coordStatus: CoordinatorStatus | null;
  workerStatuses: WorkerStatuses | null;
  workers: WorkerEntry[];
}) {
  const hasStatus = (target: string) =>
    workerStatuses ? workers.some((w) => workerStatuses.workers[w.worker_id] === target) : false;

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#0a0f0a]/80 p-5">
      <h3 className="text-sm font-semibold text-zinc-100 mb-4 font-mono">
        // Voting Flow
      </h3>
      <div className="font-mono text-xs space-y-2 text-zinc-500">
        <FlowStep n={1} label="Proposal submitted to contract" active={coordStatus?.status === "idle"} />
        <FlowStep n={2} label="Coordinator dispatches to voters" active={coordStatus?.status === "monitoring"} />
        <FlowStep n={3} label="Agents load identity from Storacha" active={hasStatus("processing")} persistent />
        <FlowStep n={4} label="AI deliberation (manifesto + identity)" active={hasStatus("processing")} />
        <FlowStep n={5} label="Record decision to Storacha memory" active={hasStatus("completed")} persistent />
        <FlowStep n={6} label="Record votes on-chain (nullifier)" active={coordStatus?.status === "recording_submissions"} />
        <FlowStep n={7} label="Coordinator tallies votes" active={coordStatus?.status === "aggregating"} />
        <FlowStep n={8} label="Result finalized on-chain" active={coordStatus?.status === "completed" || coordStatus?.status === "resuming"} />
      </div>

      <div className="mt-4 pt-3 border-t border-zinc-800 flex gap-4">
        <div className="flex items-center gap-1.5 text-[9px] text-zinc-600 font-mono">
          <span className="h-2 w-2 rounded-full bg-zinc-700" />
          on-chain
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-zinc-600 font-mono">
          <span className="h-2 w-2 rounded-full bg-[#00ff41]/30" />
          Storacha (persistent)
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-zinc-600 font-mono">
          <span className="h-2 w-2 rounded-full bg-zinc-500" />
          Ensue (ephemeral)
        </div>
      </div>
    </div>
  );
}

/* ─── Proposal List ──────────────────────────────────────────────── */

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
          <div className="grid grid-cols-4 gap-2">
            <Stat label="Total" value={String(proposals.length)} />
            <Stat label="Created" value={String(countByState("Created"))} color="text-yellow-400" />
            <Stat label="Finalized" value={String(countByState("Finalized"))} color="text-green-400" />
            <Stat label="Timed Out" value={String(countByState("TimedOut"))} color="text-red-400" />
          </div>

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

/* ─── Proposal Row ───────────────────────────────────────────────── */

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

/* ─── Shared Helpers ────────────────────────────────────────────── */

function FlowStep({ n, label, active, persistent }: { n: number; label: string; active?: boolean; persistent?: boolean }) {
  return (
    <div className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${active ? "bg-zinc-800/80 text-zinc-200" : ""}`}>
      <span
        className={`flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold shrink-0 ${
          active
            ? persistent ? "bg-[#00ff41]/20 text-[#00ff41] border border-[#00ff41]/30" : "bg-blue-600 text-white"
            : persistent ? "bg-[#00ff41]/5 text-[#00ff41]/40 border border-[#00ff41]/10" : "bg-zinc-800 text-zinc-500"
        }`}
      >
        {n}
      </span>
      <span className={persistent && !active ? "text-zinc-600" : ""}>{label}</span>
      {persistent && (
        <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#00ff41]/10 text-[#00ff41]/40 border border-[#00ff41]/10 font-mono">
          STORACHA
        </span>
      )}
      {active && (
        <span className={`ml-auto text-[10px] animate-pulse-dot ${persistent ? "text-[#00ff41]" : "text-blue-400"}`}>
          ACTIVE
        </span>
      )}
    </div>
  );
}

function truncateDid(id: string): string {
  if (id.startsWith("did:key:")) {
    const key = id.slice("did:key:".length);
    return `${key.slice(0, 8)}…${key.slice(-4)}`;
  }
  return id;
}

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
