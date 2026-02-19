"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import CoordinatorPanel from "../components/CoordinatorPanel";
import ContractStatePanel from "../components/ContractStatePanel";
import EventLog, { type LogEntry } from "../components/EventLog";
import StatusDot from "../components/StatusDot";
import ProposalHistoryPanel from "../components/ProposalHistoryPanel";
import WorkerManagementPanel from "../components/WorkerManagementPanel";
import AgentEndpointConfig from "../components/AgentEndpointConfig";
import { usePolling } from "@/lib/use-polling";
import { useAuth } from "@/lib/auth";
import {
  getCoordinatorStatus,
  getWorkerStatuses,
  getCoordinatorHealth,
  getRegisteredWorkers,
  resetMemory,
  type CoordinatorStatus,
  type WorkerStatuses,
  type RegisteredWorker,
} from "@/lib/api";
import Link from "next/link";

export default function CoordinatorDashboard() {
  const { accountId, role, connect, forceConnect, disconnect, connecting } = useAuth();

  // Not connected — show connect prompt
  if (!accountId) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-sm text-zinc-500 font-mono mb-6">
            Connect your NEAR wallet to access the coordinator dashboard
          </p>
          <button
            onClick={() => forceConnect("agents-coordinator.testnet")}
            disabled={connecting}
            className="px-6 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30
                       text-sm font-semibold text-[#00ff41] font-mono
                       hover:bg-[#00ff41]/15 transition-all disabled:opacity-40"
          >
            {connecting ? "connecting..." : "connect as coordinator"}
          </button>
        </div>
      </PageShell>
    );
  }

  // Connected but not coordinator
  if (role !== "coordinator") {
    return (
      <PageShell accountId={accountId} onDisconnect={disconnect}>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-sm text-zinc-500 font-mono mb-2">
            Account <span className="text-zinc-300">{accountId}</span> is not the coordinator.
          </p>
          <p className="text-xs text-zinc-600 font-mono mb-6">
            Only the contract owner can access this dashboard.
          </p>
          <div className="flex gap-3">
            <Link
              href="/dashboard"
              className="text-xs px-4 py-2 rounded border border-zinc-700 text-zinc-400 font-mono
                         hover:border-zinc-600 hover:text-zinc-300 transition-all"
            >
              public dashboard
            </Link>
            <Link
              href="/worker"
              className="text-xs px-4 py-2 rounded border border-zinc-700 text-zinc-400 font-mono
                         hover:border-zinc-600 hover:text-zinc-300 transition-all"
            >
              worker dashboard
            </Link>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell accountId={accountId} onDisconnect={disconnect}>
      <CoordinatorContent />
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
    <div className="min-h-screen bg-[#050505] p-6 md:p-10 max-w-6xl mx-auto">
      <div className="fixed inset-0 cyber-grid pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none opacity-30" />

      <div className="relative z-10">
        <header className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src="/logo-iso.svg" alt="Delibera" className="h-8 w-8" />
              <h1 className="text-xl font-bold text-zinc-100 font-mono">Delibera</h1>
            </Link>
            {accountId && onDisconnect ? (
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
            ) : null}
          </div>
          <p className="text-sm text-zinc-500 font-mono">
            Coordinator Panel &middot; authenticated actions &amp; private data
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

/* ─── Coordinator Content (authenticated) ─────────────────────────────── */

function CoordinatorContent() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [resetting, setResetting] = useState(false);
  const prevStatusRef = useRef<Record<string, string>>({});

  const addLog = useCallback((message: string, type: LogEntry["type"] = "info") => {
    setLogs((prev) => [
      ...prev.slice(-99),
      { time: new Date().toLocaleTimeString(), message, type },
    ]);
  }, []);

  const coordStatusFetcher = useCallback(getCoordinatorStatus, []);
  const workerStatusFetcher = useCallback(getWorkerStatuses, []);
  const coordHealthFetcher = useCallback(getCoordinatorHealth, []);
  const registeredWorkersFetcher = useCallback(async () => {
    const data = await getRegisteredWorkers();
    return data?.workers ?? null;
  }, []);

  const { data: coordStatus, error: coordError } =
    usePolling<CoordinatorStatus>(coordStatusFetcher, 2000);
  const { data: workerStatuses, error: workerError } =
    usePolling<WorkerStatuses>(workerStatusFetcher, 2000);
  const { error: coordHealthError } = usePolling(coordHealthFetcher, 5000);
  const { data: registeredWorkers, refresh: refreshRegistered } =
    usePolling<RegisteredWorker[]>(registeredWorkersFetcher, 10000);

  const coordinatorOnline = !coordHealthError && !coordError;
  const workers = (registeredWorkers ?? []).filter((w) => w.active);

  // Log status changes
  useEffect(() => {
    if (!workerStatuses) return;
    const wStatus = workerStatuses.workers;
    for (const [id, status] of Object.entries(wStatus)) {
      const prev = prevStatusRef.current[id];
      if (prev && prev !== status) {
        const type = status === "completed" ? "success" : status === "failed" ? "error" : "info";
        addLog(`${id}: ${prev} -> ${status}`, type);
        if (status === "processing") {
          addLog(`[nova] ${id}: loading persistent identity from Nova...`, "info");
        }
        if (status === "completed" && prev === "processing") {
          addLog(`[nova] ${id}: decision recorded to Nova persistent memory`, "success");
        }
      }
    }
    if (coordStatus?.status) {
      const prev = prevStatusRef.current["coordinator"];
      if (prev && prev !== coordStatus.status) {
        const type =
          coordStatus.status === "completed"
            ? "success"
            : coordStatus.status === "failed"
              ? "error"
              : "info";
        addLog(`coordinator: ${prev} -> ${coordStatus.status}`, type);
      }
      prevStatusRef.current["coordinator"] = coordStatus.status;
    }
    prevStatusRef.current = {
      ...prevStatusRef.current,
      ...wStatus,
    };
  }, [workerStatuses, coordStatus, addLog]);

  async function handleReset() {
    setResetting(true);
    addLog("Resetting all Ensue memory...", "info");
    const result = await resetMemory();
    if (result) {
      addLog("Ensue memory reset (Nova persistent memory preserved)", "success");
    } else {
      addLog("Failed to reset memory", "error");
    }
    setResetting(false);
  }

  return (
    <>
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
        <div className="ml-auto">
          <button
            onClick={handleReset}
            disabled={resetting || !coordinatorOnline}
            className="text-xs px-4 py-1.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-300
                       hover:border-zinc-600 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors font-mono"
          >
            {resetting ? "resetting..." : "reset memory"}
          </button>
        </div>
      </div>

      {/* Coordinator Endpoint Config */}
      <AgentEndpointConfig agentId="coordinator" />

      {/* Coordinator Panel + Worker Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <CoordinatorPanel status={coordStatus} online={coordinatorOnline} />

        {workers.map((w) => {
          const status = workerStatuses?.workers[w.worker_id] || "unknown";
          return (
            <WorkerStatusCard
              key={w.worker_id}
              worker={w}
              status={workerError ? "offline" : status}
            />
          );
        })}
      </div>

      {/* Contract State (on-chain reads) */}
      <div className="mb-6">
        <ContractStatePanel />
      </div>

      {/* Proposal History + Worker Management */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ProposalHistoryPanel />
        <WorkerManagementPanel onWorkerChanged={refreshRegistered} />
      </div>

      {/* Voting Flow + Event Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <VotingFlowDiagram coordStatus={coordStatus} workerStatuses={workerStatuses} workers={workers} />
        <EventLog entries={logs} />
      </div>
    </>
  );
}

/* ─── Minimal Worker Status Card ─────────────────────────────────────── */

function WorkerStatusCard({
  worker,
  status,
}: {
  worker: RegisteredWorker;
  status: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <StatusDot status={status} />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 font-mono">
              {worker.worker_id}
            </h3>
            {worker.account_id && (
              <p className="text-[10px] text-zinc-600 font-mono truncate max-w-[150px]">
                {worker.account_id}
              </p>
            )}
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

/* ─── Voting Flow Diagram ─────────────────────────────────────────────── */

function VotingFlowDiagram({
  coordStatus,
  workerStatuses,
  workers,
}: {
  coordStatus: CoordinatorStatus | null;
  workerStatuses: WorkerStatuses | null;
  workers: RegisteredWorker[];
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
        <FlowStep n={3} label="Agents load identity from Nova" active={hasStatus("processing")} nova />
        <FlowStep n={4} label="AI deliberation (manifesto + identity)" active={hasStatus("processing")} />
        <FlowStep n={5} label="Record decision to Nova memory" active={hasStatus("completed")} nova />
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
          Nova (persistent)
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-zinc-600 font-mono">
          <span className="h-2 w-2 rounded-full bg-zinc-500" />
          Ensue (ephemeral)
        </div>
      </div>
    </div>
  );
}

/* ─── Flow Step ──────────────────────────────────────────────────────────── */

function FlowStep({ n, label, active, nova }: { n: number; label: string; active?: boolean; nova?: boolean }) {
  return (
    <div className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${active ? "bg-zinc-800/80 text-zinc-200" : ""}`}>
      <span
        className={`flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold shrink-0 ${
          active
            ? nova ? "bg-[#00ff41]/20 text-[#00ff41] border border-[#00ff41]/30" : "bg-blue-600 text-white"
            : nova ? "bg-[#00ff41]/5 text-[#00ff41]/40 border border-[#00ff41]/10" : "bg-zinc-800 text-zinc-500"
        }`}
      >
        {n}
      </span>
      <span className={nova && !active ? "text-zinc-600" : ""}>{label}</span>
      {nova && (
        <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#00ff41]/10 text-[#00ff41]/40 border border-[#00ff41]/10 font-mono">
          NOVA
        </span>
      )}
      {active && (
        <span className={`ml-auto text-[10px] animate-pulse-dot ${nova ? "text-[#00ff41]" : "text-blue-400"}`}>
          ACTIVE
        </span>
      )}
    </div>
  );
}
