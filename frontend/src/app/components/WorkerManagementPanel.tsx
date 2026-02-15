"use client";

import { useCallback, useState } from "react";
import { usePolling } from "@/lib/use-polling";
import {
  getRegisteredWorkers,
  registerWorker,
  removeWorker,
  type RegisteredWorker,
} from "@/lib/api";

interface Props {
  onWorkerChanged?: () => void;
}

export default function WorkerManagementPanel({ onWorkerChanged }: Props) {
  const fetcher = useCallback(async () => {
    const data = await getRegisteredWorkers();
    return data ?? null;
  }, []);
  const { data, refresh } = usePolling<{ workers: RegisteredWorker[]; activeCount: number }>(
    fetcher,
    10000
  );

  const [newWorkerId, setNewWorkerId] = useState("");
  const [newAccountId, setNewAccountId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const workers = data?.workers ?? [];

  async function handleRegister() {
    if (!newWorkerId.trim() || submitting) return;
    setSubmitting(true);
    const result = await registerWorker(newWorkerId.trim(), newAccountId.trim() || undefined);
    if (result) {
      setNewWorkerId("");
      setNewAccountId("");
      refresh();
      onWorkerChanged?.();
    }
    setSubmitting(false);
  }

  async function handleRemove(workerId: string) {
    setRemoving(workerId);
    await removeWorker(workerId);
    refresh();
    onWorkerChanged?.();
    setRemoving(null);
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#0a0f0a]/80 p-5">
      <h3 className="text-sm font-semibold text-zinc-100 mb-4 font-mono">
        // Worker Management (On-Chain)
      </h3>

      {/* Registered workers list */}
      {workers.length === 0 ? (
        <p className="text-xs text-zinc-600 font-mono mb-4">No registered workers</p>
      ) : (
        <div className="space-y-1.5 mb-4 max-h-48 overflow-y-auto">
          {workers.map((w) => (
            <div
              key={w.worker_id}
              className="flex items-center justify-between p-2 rounded-lg bg-zinc-800/60 text-xs"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${w.active ? "bg-green-500" : "bg-zinc-600"}`}
                />
                <span className="font-mono text-zinc-300">{w.worker_id}</span>
                {w.account_id && (
                  <span className="text-zinc-600 font-mono text-[10px] truncate max-w-[120px]">
                    {w.account_id}
                  </span>
                )}
              </div>
              <button
                onClick={() => handleRemove(w.worker_id)}
                disabled={removing === w.worker_id}
                className="text-[10px] px-2 py-1 rounded border border-red-900/30 bg-red-950/30 text-red-400
                           hover:bg-red-950/50 hover:border-red-800/40 disabled:opacity-40
                           disabled:cursor-not-allowed transition-colors font-mono"
              >
                {removing === w.worker_id ? "..." : "remove"}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Register new worker */}
      <div className="space-y-2 p-3 rounded bg-zinc-900/80 border border-zinc-800">
        <p className="text-[9px] text-zinc-600 font-mono">
          // Register a worker on the smart contract
        </p>
        <div className="flex gap-2">
          <input
            value={newWorkerId}
            onChange={(e) => setNewWorkerId(e.target.value)}
            placeholder="worker ID (e.g. worker4)"
            className="flex-1 text-[10px] bg-zinc-800/60 border border-zinc-700/50 rounded p-1.5
                       text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#00ff41]/30 font-mono"
          />
          <input
            value={newAccountId}
            onChange={(e) => setNewAccountId(e.target.value)}
            placeholder="NEAR account (optional)"
            className="flex-1 text-[10px] bg-zinc-800/60 border border-zinc-700/50 rounded p-1.5
                       text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#00ff41]/30 font-mono"
          />
        </div>
        <button
          onClick={handleRegister}
          disabled={!newWorkerId.trim() || submitting}
          className="text-[10px] px-3 py-1.5 rounded bg-[#00ff41]/10 border border-[#00ff41]/30
                     text-[#00ff41] font-mono hover:bg-[#00ff41]/15 disabled:opacity-40
                     disabled:cursor-not-allowed transition-all"
        >
          {submitting ? "registering..." : "register worker"}
        </button>
      </div>
    </div>
  );
}
