"use client";

import { useEffect, useRef } from "react";

export interface LogEntry {
  time: string;
  message: string;
  type: "info" | "success" | "error" | "warning";
}

const TYPE_COLORS = {
  info: "text-zinc-400",
  success: "text-[#00ff41]",
  error: "text-red-400",
  warning: "text-yellow-400",
};

export default function EventLog({ entries }: { entries: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries.length]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-[#0a0f0a]/80 p-5">
      <h3 className="text-sm font-semibold text-zinc-100 mb-3 font-mono">
        // Event Log
      </h3>
      <div className="h-48 overflow-y-auto space-y-1 font-mono text-xs">
        {entries.length === 0 && (
          <p className="text-zinc-700">
            <span className="text-[#00ff41]/30 animate-cursor">_</span> awaiting events...
          </p>
        )}
        {entries.map((entry, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-zinc-700 shrink-0">{entry.time}</span>
            <span className={TYPE_COLORS[entry.type]}>{entry.message}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
