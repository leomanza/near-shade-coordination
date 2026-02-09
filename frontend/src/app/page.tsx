"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import WorkerCard from "./components/WorkerCard";
import CoordinatorPanel from "./components/CoordinatorPanel";
import ContractStatePanel from "./components/ContractStatePanel";
import EventLog, { type LogEntry } from "./components/EventLog";
import StatusDot from "./components/StatusDot";
import { usePolling } from "@/lib/use-polling";
import {
  getCoordinatorStatus,
  getWorkerStatuses,
  getCoordinatorHealth,
  resetMemory,
  type CoordinatorStatus,
  type WorkerStatuses,
} from "@/lib/api";

const AGENTS = [
  { id: "worker1", label: "Voter Agent 1", port: 3001 },
  { id: "worker2", label: "Voter Agent 2", port: 3002 },
  { id: "worker3", label: "Voter Agent 3", port: 3003 },
];

export default function Dashboard() {
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

  const { data: coordStatus, error: coordError } =
    usePolling<CoordinatorStatus>(coordStatusFetcher, 2000);
  const { data: workerStatuses, error: workerError } =
    usePolling<WorkerStatuses>(workerStatusFetcher, 2000);
  const { error: coordHealthError } = usePolling(coordHealthFetcher, 5000);

  const coordinatorOnline = !coordHealthError && !coordError;

  // Log status changes
  useEffect(() => {
    if (!workerStatuses) return;
    const workers = workerStatuses.workers;
    for (const [id, status] of Object.entries(workers)) {
      const prev = prevStatusRef.current[id];
      if (prev && prev !== status) {
        const type = status === "completed" ? "success" : status === "failed" ? "error" : "info";
        addLog(`${id}: ${prev} -> ${status}`, type);
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
      ...workers,
    };
  }, [workerStatuses, coordStatus, addLog]);

  async function handleReset() {
    setResetting(true);
    addLog("Resetting all memory...", "info");
    const result = await resetMemory();
    if (result) {
      addLog("Memory reset complete", "success");
    } else {
      addLog("Failed to reset memory", "error");
    }
    setResetting(false);
  }

  return (
    <div className="min-h-screen p-6 md:p-10 max-w-6xl mx-auto">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-green-500 to-blue-600 flex items-center justify-center text-xs font-bold">
            D
          </div>
          <h1 className="text-xl font-bold text-zinc-100">
            AI Agent DAO
          </h1>
        </div>
        <p className="text-sm text-zinc-500">
          Multi-agent deliberation &amp; voting with privacy-preserving coordination on NEAR
        </p>
      </header>

      {/* System Status Bar */}
      <div className="flex items-center gap-4 mb-6 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <StatusDot status={coordinatorOnline ? "completed" : "offline"} />
          <span>Coordinator</span>
        </div>
        {AGENTS.map((a) => {
          const status =
            workerStatuses?.workers[a.id as keyof typeof workerStatuses.workers] || "unknown";
          return (
            <div key={a.id} className="flex items-center gap-2 text-xs text-zinc-400">
              <StatusDot status={workerError ? "offline" : status} />
              <span>{a.label.replace("Voter Agent ", "V")}</span>
            </div>
          );
        })}
        <div className="ml-auto">
          <button
            onClick={handleReset}
            disabled={resetting || !coordinatorOnline}
            className="text-xs px-4 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {resetting ? "Resetting..." : "Reset Memory"}
          </button>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {/* Coordinator */}
        <CoordinatorPanel status={coordStatus} online={coordinatorOnline} />

        {/* Voter Agents */}
        {AGENTS.map((a) => (
          <WorkerCard
            key={a.id}
            workerId={a.id}
            label={a.label}
            port={a.port}
            status={
              workerStatuses?.workers[a.id as keyof typeof workerStatuses.workers] || "unknown"
            }
          />
        ))}
      </div>

      {/* Contract State (on-chain reads) */}
      <div className="mb-6">
        <ContractStatePanel />
      </div>

      {/* Voting Flow + Event Log */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Flow Diagram */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
          <h3 className="text-sm font-semibold text-zinc-100 mb-4">Voting Flow</h3>
          <div className="font-mono text-xs space-y-2 text-zinc-500">
            <FlowStep
              n={1}
              label="Proposal submitted to contract"
              active={coordStatus?.status === "idle"}
            />
            <FlowStep
              n={2}
              label="Coordinator dispatches to voters"
              active={coordStatus?.status === "monitoring"}
            />
            <FlowStep
              n={3}
              label="AI agents deliberate & vote"
              active={
                workerStatuses?.workers.worker1 === "processing" ||
                workerStatuses?.workers.worker2 === "processing" ||
                workerStatuses?.workers.worker3 === "processing"
              }
            />
            <FlowStep
              n={4}
              label="Record votes on-chain (nullifier)"
              active={coordStatus?.status === "recording_submissions"}
            />
            <FlowStep
              n={5}
              label="Coordinator tallies votes"
              active={coordStatus?.status === "aggregating"}
            />
            <FlowStep
              n={6}
              label="Result finalized on-chain"
              active={coordStatus?.status === "completed" || coordStatus?.status === "resuming"}
            />
          </div>
        </div>

        {/* Event Log */}
        <EventLog entries={logs} />
      </div>

      {/* Footer */}
      <footer className="mt-8 text-center text-xs text-zinc-600">
        AI Agent DAO &middot; NEAR Shade Agents &middot; Ensue Shared Memory &middot; Phala TEE
      </footer>
    </div>
  );
}

function FlowStep({
  n,
  label,
  active,
}: {
  n: number;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
        active ? "bg-zinc-800 text-zinc-200" : ""
      }`}
    >
      <span
        className={`flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold shrink-0 ${
          active
            ? "bg-blue-600 text-white"
            : "bg-zinc-800 text-zinc-500"
        }`}
      >
        {n}
      </span>
      <span>{label}</span>
      {active && (
        <span className="ml-auto text-blue-400 text-[10px] animate-pulse-dot">
          ACTIVE
        </span>
      )}
    </div>
  );
}
