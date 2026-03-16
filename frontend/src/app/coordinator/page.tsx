"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import CoordinatorPanel from "../components/CoordinatorPanel";
import ContractStatePanel from "../components/ContractStatePanel";
import EventLog, { type LogEntry } from "../components/EventLog";
import StatusDot from "../components/StatusDot";
import ProposalHistoryPanel from "../components/ProposalHistoryPanel";
import WorkerManagementPanel from "../components/WorkerManagementPanel";
import { usePolling } from "@/lib/use-polling";
import { useAuth } from "@/lib/auth";
import {
  getCoordinatorStatus,
  getWorkerStatuses,
  getCoordinatorHealth,
  getRegisteredWorkers,
  getActiveCoordinators,
  setActiveCoordinatorUrl,
  setActiveContractId,
  type CoordinatorStatus,
  type WorkerStatuses,
  type RegisteredWorker,
} from "@/lib/api";
import Link from "next/link";

export default function CoordinatorDashboard() {
  const { accountId, connect, disconnect, connecting } = useAuth();
  const [activeUrl, setActiveUrl] = useState<string>("");
  const [activeContractId, setActiveContractIdState] = useState<string>("");
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [noCoordinatorFound, setNoCoordinatorFound] = useState(false);
  // Manual fallback
  const [showManual, setShowManual] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [contractInput, setContractInput] = useState("");
  const [connecting2, setConnecting2] = useState(false);

  // Auto-discover the user's coordinator from registry when wallet connects
  useEffect(() => {
    if (!accountId) {
      setResolved(false);
      setNoCoordinatorFound(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    setNoCoordinatorFound(false);

    (async () => {
      const all = await getActiveCoordinators();
      if (cancelled) return;

      const mine = (all ?? []).filter((c) => c.account_id === accountId);
      if (mine.length > 0) {
        const coord = mine[0]; // auto-select first (most users have one)
        await selectCoordinator(coord.endpoint_url);
      } else {
        setNoCoordinatorFound(true);
      }
      setResolving(false);
      setResolved(true);
    })();

    return () => { cancelled = true; };
  }, [accountId]);

  async function selectCoordinator(endpointUrl: string) {
    setConnecting2(true);
    setActiveCoordinatorUrl(endpointUrl);
    setActiveUrl(endpointUrl);

    // Discover the coordinator's contract ID from its health endpoint
    try {
      const health = await getCoordinatorHealth();
      if (health?.contractId && health.contractId !== "N/A") {
        setActiveContractId(health.contractId);
        setActiveContractIdState(health.contractId);
      }
    } catch {
      // Health fetch failed — contract ID stays as-is
    }
    setConnecting2(false);
  }

  // Not connected — show connect prompt
  if (!accountId) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center py-20">
          <p className="text-sm text-zinc-500 font-mono mb-6">
            Connect your NEAR wallet to manage your coordinator
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

  // Resolving the user's coordinator from registry
  if (resolving || !resolved) {
    return (
      <PageShell accountId={accountId} onDisconnect={disconnect}>
        <div className="flex items-center justify-center py-16">
          <p className="text-sm text-zinc-500 font-mono animate-pulse">
            Looking up your coordinator...
          </p>
        </div>
      </PageShell>
    );
  }

  // No coordinator found — show manual entry
  if (noCoordinatorFound && !activeUrl) {
    return (
      <PageShell accountId={accountId} onDisconnect={disconnect}>
        <div className="flex flex-col items-center justify-center py-16 gap-4">
          <p className="text-sm text-zinc-500 font-mono">
            No coordinator found for <span className="text-zinc-300">{accountId}</span>
          </p>
          <p className="text-xs text-zinc-600 font-mono">
            Deploy a coordinator from the{" "}
            <Link href="/buy/coordinator" className="text-[#00ff41]/70 hover:text-[#00ff41] underline">
              buy page
            </Link>
            , or enter a coordinator URL manually.
          </p>
          <div className="flex gap-2 w-full max-w-lg mt-2">
            <input
              type="text"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="Coordinator URL: https://...phala.network"
              className="flex-1 px-3 py-2 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-300 font-mono placeholder:text-zinc-700 focus:border-[#00ff41]/30 focus:outline-none"
            />
            <button
              onClick={async () => {
                if (customUrl) {
                  await selectCoordinator(customUrl);
                  setNoCoordinatorFound(false);
                  setCustomUrl("");
                }
              }}
              disabled={connecting2 || !customUrl}
              className="px-4 py-2 rounded text-xs font-mono bg-[#00ff41]/10 border border-[#00ff41]/30 text-[#00ff41] hover:bg-[#00ff41]/15 transition-all disabled:opacity-30"
            >
              {connecting2 ? "..." : "connect"}
            </button>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell accountId={accountId} onDisconnect={disconnect}>
      {/* ── Active Coordinator Info ── */}
      <div className="mb-6 p-3 rounded border border-zinc-800 bg-[#0a0f0a]/80">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono text-[#00ff41]/70 truncate">{activeUrl}</div>
            {activeContractId ? (
              <div className="text-[10px] font-mono text-zinc-500 truncate">
                contract: <span className="text-zinc-400">{activeContractId}</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="text"
                  value={contractInput}
                  onChange={(e) => setContractInput(e.target.value)}
                  placeholder="Contract ID: mycoord.coord-factory.agents-coordinator.testnet"
                  className="flex-1 px-2 py-1 rounded bg-zinc-900 border border-amber-700/40 text-[10px] text-zinc-300 font-mono placeholder:text-zinc-700 focus:border-amber-500/50 focus:outline-none"
                />
                <button
                  onClick={() => {
                    if (contractInput.trim()) {
                      setActiveContractId(contractInput.trim());
                      setActiveContractIdState(contractInput.trim());
                      setContractInput("");
                    }
                  }}
                  disabled={!contractInput.trim()}
                  className="px-2 py-1 rounded text-[10px] font-mono bg-amber-900/30 border border-amber-700/40 text-amber-400 hover:bg-amber-900/40 transition-all disabled:opacity-30"
                >
                  set
                </button>
              </div>
            )}
          </div>
          {!showManual ? (
            <button
              onClick={() => setShowManual(true)}
              className="text-[9px] px-2 py-1 rounded border border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700 transition-colors font-mono shrink-0 ml-3"
            >
              change
            </button>
          ) : (
            <div className="flex gap-2 ml-3 shrink-0">
              <input
                type="text"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                placeholder="URL or contract ID"
                className="w-48 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-[10px] text-zinc-300 font-mono placeholder:text-zinc-700 focus:border-[#00ff41]/30 focus:outline-none"
              />
              <button
                onClick={async () => {
                  if (customUrl) {
                    await selectCoordinator(customUrl);
                    setCustomUrl("");
                    setShowManual(false);
                  }
                }}
                disabled={connecting2 || !customUrl}
                className="px-2 py-1 rounded text-[10px] font-mono bg-[#00ff41]/10 border border-[#00ff41]/30 text-[#00ff41] hover:bg-[#00ff41]/15 transition-all disabled:opacity-30"
              >
                {connecting2 ? "..." : "go"}
              </button>
              <button
                onClick={() => { setShowManual(false); setCustomUrl(""); }}
                className="px-2 py-1 rounded text-[10px] font-mono border border-zinc-700 text-zinc-500 hover:text-zinc-400 transition-colors"
              >
                cancel
              </button>
            </div>
          )}
        </div>
      </div>

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
          NEAR Protocol &middot; NEAR AI &middot; Shade Agents &middot; Ensue Network &middot; Storacha
        </footer>
      </div>
    </div>
  );
}

/* ─── Coordinator Content (authenticated) ─────────────────────────────── */

function CoordinatorContent() {
  const { accountId, signAndSendTransaction } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
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
          addLog(`[storacha] ${id}: loading persistent identity from Storacha...`, "info");
        }
        if (status === "completed" && prev === "processing") {
          addLog(`[storacha] ${id}: decision recorded to Storacha persistent memory`, "success");
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
          const name = workerStatuses?.workerNames?.[w.worker_id];
          return (
            <div key={w.worker_id} className="flex items-center gap-2 text-xs text-zinc-400 font-mono">
              <StatusDot status={workerError ? "offline" : status} />
              <span title={w.worker_id}>{name || truncateDid(w.worker_id)}</span>
            </div>
          );
        })}
        {workers.length === 0 && (
          <span className="text-xs text-zinc-600 font-mono">No registered workers</span>
        )}
      </div>

      {/* Coordinator Panel + Worker Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <CoordinatorPanel status={coordStatus} online={coordinatorOnline} />

        {workers.map((w) => {
          const status = workerStatuses?.workers[w.worker_id] || "unknown";
          const name = workerStatuses?.workerNames?.[w.worker_id];
          return (
            <WorkerStatusCard
              key={w.worker_id}
              worker={w}
              status={workerError ? "offline" : status}
              displayName={name}
            />
          );
        })}
      </div>

      {/* Contract State (on-chain reads + owner management) */}
      <div className="mb-6">
        <ContractStatePanel accountId={accountId} signAndSendTransaction={signAndSendTransaction} />
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

/* ─── DID Display Helper ─────────────────────────────────────────────── */

function truncateDid(id: string): string {
  if (id.startsWith("did:key:")) {
    const key = id.slice("did:key:".length);
    return `${key.slice(0, 8)}…${key.slice(-4)}`;
  }
  return id;
}

/* ─── Minimal Worker Status Card ─────────────────────────────────────── */

function WorkerStatusCard({
  worker,
  status,
  displayName,
}: {
  worker: RegisteredWorker;
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
              {displayName || truncateDid(worker.worker_id)}
            </h3>
            <p className="text-[10px] text-zinc-600 font-mono truncate max-w-[150px]" title={worker.worker_id}>
              {displayName ? truncateDid(worker.worker_id) : worker.account_id || ""}
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

/* ─── Flow Step ──────────────────────────────────────────────────────────── */

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
