"use client";

import { useCallback } from "react";
import StatusDot from "./StatusDot";
import { getWorkerHealth, type WorkerHealth } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";

interface WorkerCardProps {
  workerId: string;
  label: string;
  port: number;
  status: string;
}

export default function WorkerCard({ workerId, label, port, status }: WorkerCardProps) {
  const healthFetcher = useCallback(() => getWorkerHealth(workerId), [workerId]);
  const { data: health, error: healthError } = usePolling<WorkerHealth>(healthFetcher, 5000);

  const online = !healthError && health?.healthy;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <StatusDot status={online ? status : "offline"} />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">{label}</h3>
            <p className="text-xs text-zinc-500 font-mono">:{port}</p>
          </div>
        </div>
        <span className="text-xs font-mono px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">
          {online ? status : "offline"}
        </span>
      </div>

      <p className="text-[10px] text-zinc-600">
        {status === "processing"
          ? "Deliberating on proposal..."
          : status === "completed"
            ? "Vote submitted"
            : "Waiting for proposal"}
      </p>
    </div>
  );
}
