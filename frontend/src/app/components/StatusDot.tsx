"use client";

const STATUS_COLORS: Record<string, string> = {
  idle: "bg-zinc-500",
  pending: "bg-yellow-500",
  processing: "bg-blue-500 animate-pulse-dot",
  monitoring: "bg-blue-500 animate-pulse-dot",
  aggregating: "bg-purple-500 animate-pulse-dot",
  resuming: "bg-orange-500 animate-pulse-dot",
  completed: "bg-green-500",
  failed: "bg-red-500",
  unknown: "bg-zinc-700",
  offline: "bg-red-900",
};

export default function StatusDot({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || STATUS_COLORS.unknown;
  return <span className={`inline-block h-3 w-3 rounded-full ${color}`} />;
}
