"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import WorkerCard from "../components/WorkerCard";
import CoordinatorPanel from "../components/CoordinatorPanel";
import ContractStatePanel from "../components/ContractStatePanel";
import EventLog, { type LogEntry } from "../components/EventLog";
import StatusDot from "../components/StatusDot";
import { usePolling } from "@/lib/use-polling";
import {
  getCoordinatorStatus,
  getWorkerStatuses,
  getCoordinatorHealth,
  resetMemory,
  type CoordinatorStatus,
  type WorkerStatuses,
} from "@/lib/api";
import Link from "next/link";

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
        // Add Nova-related log messages for vote flow
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
      ...workers,
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
    <div className="min-h-screen bg-[#050505] p-6 md:p-10 max-w-6xl mx-auto">
      {/* Background layers */}
      <div className="fixed inset-0 cyber-grid pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none opacity-30" />

      <div className="relative z-10">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <div
                className="h-8 w-8 rounded border border-[#00ff41]/30 bg-[#00ff41]/10
                            flex items-center justify-center text-xs font-bold font-mono
                            text-[#00ff41] text-glow-green"
              >
                S
              </div>
              <h1 className="text-xl font-bold text-zinc-100 font-mono">
                ShadeBoard
              </h1>
            </Link>
          </div>
          <p className="text-sm text-zinc-500 font-mono">
            Multi-agent deliberation &amp; voting &middot; private coordination on NEAR
          </p>
        </header>

        {/* System Status Bar */}
        <div className="flex items-center gap-4 mb-6 p-3 rounded border border-zinc-800 bg-[#0a0f0a]/80">
          <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
            <StatusDot status={coordinatorOnline ? "completed" : "offline"} />
            <span>Coordinator</span>
          </div>
          {AGENTS.map((a) => {
            const status =
              workerStatuses?.workers[a.id as keyof typeof workerStatuses.workers] || "unknown";
            return (
              <div key={a.id} className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
                <StatusDot status={workerError ? "offline" : status} />
                <span>{a.label.replace("Voter Agent ", "V")}</span>
              </div>
            );
          })}
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
              onLog={addLog}
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
          <div className="rounded-xl border border-zinc-800 bg-[#0a0f0a]/80 p-5">
            <h3 className="text-sm font-semibold text-zinc-100 mb-4 font-mono">
              // Voting Flow
            </h3>
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
                label="Agents load identity from Nova"
                active={
                  workerStatuses?.workers.worker1 === "processing" ||
                  workerStatuses?.workers.worker2 === "processing" ||
                  workerStatuses?.workers.worker3 === "processing"
                }
                nova
              />
              <FlowStep
                n={4}
                label="AI deliberation (manifesto + identity)"
                active={
                  workerStatuses?.workers.worker1 === "processing" ||
                  workerStatuses?.workers.worker2 === "processing" ||
                  workerStatuses?.workers.worker3 === "processing"
                }
              />
              <FlowStep
                n={5}
                label="Record decision to Nova memory"
                active={
                  workerStatuses?.workers.worker1 === "completed" ||
                  workerStatuses?.workers.worker2 === "completed" ||
                  workerStatuses?.workers.worker3 === "completed"
                }
                nova
              />
              <FlowStep
                n={6}
                label="Record votes on-chain (nullifier)"
                active={coordStatus?.status === "recording_submissions"}
              />
              <FlowStep
                n={7}
                label="Coordinator tallies votes"
                active={coordStatus?.status === "aggregating"}
              />
              <FlowStep
                n={8}
                label="Result finalized on-chain"
                active={coordStatus?.status === "completed" || coordStatus?.status === "resuming"}
              />
            </div>

            {/* Legend */}
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

          {/* Event Log */}
          <EventLog entries={logs} />
        </div>

        {/* Footer */}
        <footer className="mt-8 text-center text-[10px] text-zinc-700 font-mono">
          NEAR Protocol &middot; NEAR AI &middot; Shade Agents &middot; Ensue Network &middot; Nova SDK
        </footer>
      </div>
    </div>
  );
}

function FlowStep({
  n,
  label,
  active,
  nova,
}: {
  n: number;
  label: string;
  active?: boolean;
  nova?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-lg transition-colors ${
        active ? "bg-zinc-800/80 text-zinc-200" : ""
      }`}
    >
      <span
        className={`flex items-center justify-center h-6 w-6 rounded-full text-[10px] font-bold shrink-0 ${
          active
            ? nova
              ? "bg-[#00ff41]/20 text-[#00ff41] border border-[#00ff41]/30"
              : "bg-blue-600 text-white"
            : nova
              ? "bg-[#00ff41]/5 text-[#00ff41]/40 border border-[#00ff41]/10"
              : "bg-zinc-800 text-zinc-500"
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
