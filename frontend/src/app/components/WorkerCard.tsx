"use client";

import { useCallback, useState } from "react";
import StatusDot from "./StatusDot";
import { triggerWorkerTask, getWorkerHealth, type WorkerHealth } from "@/lib/api";
import { usePolling } from "@/lib/use-polling";

interface WorkerCardProps {
  workerId: string;
  label: string;
  port: number;
  status: string;
}

export default function WorkerCard({ workerId, label, port, status }: WorkerCardProps) {
  const [triggering, setTriggering] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const healthFetcher = useCallback(() => getWorkerHealth(workerId), [workerId]);
  const { data: health, error: healthError } = usePolling<WorkerHealth>(healthFetcher, 5000);

  const online = !healthError && health?.healthy;

  async function handleTrigger(taskType: string) {
    setTriggering(true);
    setLastAction(null);
    const result = await triggerWorkerTask(workerId, taskType);
    setTriggering(false);
    if (result) {
      setLastAction(`Started: ${result.taskType}`);
    } else {
      setLastAction("Failed to trigger");
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <div className="flex items-center justify-between mb-4">
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

      <div className="flex gap-2 mb-3">
        {["random", "count", "multiply"].map((type) => (
          <button
            key={type}
            onClick={() => handleTrigger(type)}
            disabled={triggering || !online}
            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {type}
          </button>
        ))}
      </div>

      {lastAction && (
        <p className="text-xs text-zinc-500 mt-1">{lastAction}</p>
      )}
    </div>
  );
}
