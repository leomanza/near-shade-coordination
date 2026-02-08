"use client";

import { useEffect, useRef } from "react";

export interface LogEntry {
  time: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
}

const TYPE_COLORS = {
  info: "text-zinc-400",
  success: "text-green-400",
  error: "text-red-400",
  warning: "text-yellow-400",
};

export default function EventLog({ entries }: { entries: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5">
      <h3 className="text-sm font-semibold text-zinc-100 mb-3">Event Log</h3>
      <div className="h-48 overflow-y-auto space-y-1 font-mono text-xs">
        {entries.length === 0 && (
          <p className="text-zinc-600">Waiting for events...</p>
        )}
        {entries.map((entry, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-zinc-600 shrink-0">{entry.time}</span>
            <span className={TYPE_COLORS[entry.type]}>{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
