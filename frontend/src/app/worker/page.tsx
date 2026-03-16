"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import StatusDot from "../components/StatusDot";
import WorkerDashboardContent from "../components/WorkerDashboardContent";
import { useAuth } from "@/lib/auth";
import { usePolling } from "@/lib/use-polling";
import {
  getWorkerStatuses,
  getWorkersForAccount,
  type WorkerStatuses,
  type RegistryWorker,
} from "@/lib/api";

export default function WorkerDashboardHub() {
  const { accountId, role, workerId, connect, disconnect, connecting } = useAuth();
  const [myWorkers, setMyWorkers] = useState<RegistryWorker[]>([]);
  const [selectedDid, setSelectedDid] = useState<string | null>(null);
  const [loadingWorkers, setLoadingWorkers] = useState(false);

  const workerFetcher = useCallback(getWorkerStatuses, []);
  const { data: workerStatuses, error: workerError } = usePolling<WorkerStatuses>(workerFetcher, 3000);

  // Fetch workers registered by the connected account
  useEffect(() => {
    if (!accountId) {
      setMyWorkers([]);
      setSelectedDid(null);
      return;
    }
    setLoadingWorkers(true);
    getWorkersForAccount(accountId).then((workers) => {
      setMyWorkers(workers);
      // Auto-select if only one worker, or if workerId from auth matches
      if (workers.length === 1) {
        setSelectedDid(workers[0].worker_did);
      } else if (workerId) {
        const match = workers.find(w => w.worker_did === workerId);
        if (match) setSelectedDid(match.worker_did);
      }
      setLoadingWorkers(false);
    });
  }, [accountId, workerId]);

  // If a worker is selected, show its dashboard
  if (selectedDid && accountId) {
    return (
      <WorkerDashboardContent
        workerId={selectedDid}
        accountId={accountId}
        onDisconnect={() => {
          if (myWorkers.length > 1) {
            setSelectedDid(null); // go back to picker
          } else {
            disconnect();
          }
        }}
      />
    );
  }

  // Build worker list: user's own workers + all registry workers for browsing
  const allWorkerDids = workerStatuses?.workers ? Object.keys(workerStatuses.workers) : [];

  return (
    <PageShell accountId={accountId} onDisconnect={disconnect}>
      <div className="flex flex-col items-center justify-center py-6">
        <h2 className="text-xl font-bold text-zinc-100 font-mono mb-8">// Worker Central</h2>

        {!accountId ? (
          <div className="text-center">
            <p className="text-xs text-zinc-500 font-mono mb-4">
              Connect your wallet to see your workers
            </p>
            <button
              onClick={connect}
              disabled={connecting}
              className="px-6 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-sm font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-40"
            >
              {connecting ? "connecting..." : "Connect Wallet"}
            </button>
          </div>
        ) : loadingWorkers ? (
          <p className="text-xs text-zinc-500 font-mono animate-pulse">Loading workers...</p>
        ) : (
          <>
            {/* My Workers */}
            {myWorkers.length > 0 && (
              <div className="w-full max-w-3xl mb-8">
                <h3 className="text-sm text-zinc-400 font-mono mb-3">Your Workers</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {myWorkers.map((w) => {
                    const status = workerStatuses?.workers[w.worker_did] || "unknown";
                    const displayName = workerStatuses?.workerNames?.[w.worker_did];
                    return (
                      <button
                        key={w.worker_did}
                        onClick={() => setSelectedDid(w.worker_did)}
                        className="flex flex-col items-center p-5 rounded-xl border transition-all hover:scale-105
                                   bg-[#00ff41]/5 border-[#00ff41]/30 text-[#00ff41]"
                      >
                        <div className="h-12 w-12 rounded-full mb-3 flex items-center justify-center bg-[#00ff41]/20">
                          <StatusDot status={workerError ? "offline" : status} />
                        </div>
                        <span className="text-sm font-bold font-mono mb-1">
                          {displayName || "Worker"}
                        </span>
                        <span className="text-[10px] opacity-60 font-mono truncate w-full text-center">
                          {w.worker_did.substring(0, 24)}...
                        </span>
                        <span className="mt-2 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#00ff41]/10 border border-[#00ff41]/20">
                          {status.toUpperCase()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {myWorkers.length === 0 && (
              <div className="text-center mb-8">
                <p className="text-xs text-zinc-500 font-mono mb-3">
                  No workers found for <span className="text-zinc-300">{accountId}</span>
                </p>
                <Link
                  href="/buy"
                  className="inline-block px-5 py-2.5 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-xs font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all"
                >
                  Deploy a Worker
                </Link>
              </div>
            )}

            {/* All Network Workers */}
            {allWorkerDids.length > 0 && (
              <div className="w-full max-w-3xl">
                <h3 className="text-sm text-zinc-400 font-mono mb-3">All Network Workers</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {allWorkerDids.map((did) => {
                    const status = workerStatuses?.workers[did] || "unknown";
                    const displayName = workerStatuses?.workerNames?.[did];
                    const isOwn = myWorkers.some(w => w.worker_did === did);
                    return (
                      <div
                        key={did}
                        className={`flex items-center gap-3 p-3 rounded-lg ${
                          isOwn ? "bg-[#00ff41]/5 border border-[#00ff41]/20" : "bg-zinc-800/40"
                        }`}
                      >
                        <StatusDot status={workerError ? "offline" : status} />
                        <div className="min-w-0">
                          <p className="text-xs font-mono text-zinc-300 font-semibold truncate">
                            {displayName || (did.startsWith("did:") ? did.substring(0, 20) + "..." : did)}
                          </p>
                          {did.startsWith("did:") && (
                            <p className="text-[10px] font-mono text-zinc-600 truncate">
                              {did.substring(0, 28)}...
                            </p>
                          )}
                        </div>
                        <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 shrink-0">
                          {status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="mt-8 pt-6 border-t border-zinc-800 w-full flex flex-col items-center">
              <Link
                href="/buy"
                className="px-5 py-2 rounded border border-zinc-700 text-zinc-400 font-mono text-xs
                           hover:border-zinc-600 hover:text-zinc-300 transition-all"
              >
                Deploy another worker
              </Link>
            </div>
          </>
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
              <img src="/logo-iso.svg" alt="Delibera" className="h-8 w-8" />
              <h1 className="text-xl font-bold text-zinc-100 font-mono">Delibera</h1>
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
          NEAR Protocol &middot; NEAR AI &middot; Shade Agents &middot; Ensue Network &middot; Storacha
        </footer>
      </div>
    </div>
  );
}
