"use client";

import { useCallback } from "react";
import Link from "next/link";
import WorkerCard from "../components/WorkerCard";
import StatusDot from "../components/StatusDot";
import AgentEndpointConfig from "../components/AgentEndpointConfig";
import { usePolling } from "@/lib/use-polling";
import { useAuth } from "@/lib/auth";
import {
  getCoordinatorStatus,
  getWorkerStatuses,
  getOnChainState,
  type CoordinatorStatus,
  type WorkerStatuses,
  type OnChainState,
  type OnChainProposal,
  type ProposalState,
} from "@/lib/api";

const STATE_COLORS: Record<ProposalState, string> = {
  Created: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  WorkersCompleted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Finalized: "bg-green-500/20 text-green-400 border-green-500/30",
  TimedOut: "bg-red-500/20 text-red-400 border-red-500/30",
};

export default function WorkerDashboardHub() {
  const { accountId, role, workerId, connect, disconnect, connecting, forceConnect } = useAuth();

  // If already connected as a known worker, we can either show the hub or redirect.
  // For now, let's show the hub as a "Worker Central".

  return (
    <PageShell accountId={accountId} onDisconnect={disconnect}>
      <div className="flex flex-col items-center justify-center py-10">
        <h2 className="text-xl font-bold text-zinc-100 font-mono mb-8">// Worker Central</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-3xl">
          <WorkerLink 
            id="worker1" 
            account="worker1.agents-coordinator.testnet" 
            active={accountId === "worker1.agents-coordinator.testnet"}
          />
          <WorkerLink 
            id="worker2" 
            account="worker2.agents-coordinator.testnet" 
            active={accountId === "worker2.agents-coordinator.testnet"}
          />
          <WorkerLink 
            id="worker3" 
            account="worker3.agents-coordinator.testnet" 
            active={accountId === "worker3.agents-coordinator.testnet"}
          />
        </div>

        <div className="mt-16 pt-8 border-t border-zinc-800 w-full flex flex-col items-center">
          <p className="text-xs text-zinc-600 font-mono mb-4">
            Custom setup? Use your own wallet
          </p>
          <button
            onClick={connect}
            disabled={connecting}
            className="px-6 py-2 rounded border border-zinc-700 text-zinc-400 font-mono text-xs
                       hover:border-zinc-600 hover:text-zinc-300 transition-all disabled:opacity-40"
          >
            {connecting ? "connecting..." : (accountId ? "switch wallet" : "connect manual wallet")}
          </button>
        </div>
      </div>
    </PageShell>
  );
}

function WorkerLink({ id, account, active }: { id: string; account: string; active?: boolean }) {
  return (
    <Link 
      href={`/${id}`}
      className={`flex flex-col items-center p-6 rounded-xl border transition-all hover:scale-105 ${
        active 
          ? "bg-[#00ff41]/5 border-[#00ff41]/30 text-[#00ff41]" 
          : "bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700"
      }`}
    >
      <div className={`h-12 w-12 rounded-full mb-4 flex items-center justify-center ${
        active ? "bg-[#00ff41]/20" : "bg-zinc-800"
      }`}>
        <span className="text-lg font-bold">W{id.slice(-1)}</span>
      </div>
      <span className="text-sm font-bold font-mono uppercase mb-1">{id}</span>
      <span className="text-[10px] opacity-40 font-mono truncate w-full text-center">{account}</span>
      {active && (
        <span className="mt-3 text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#00ff41]/10 border border-[#00ff41]/20">
          ACTIVE SESSION
        </span>
      )}
    </Link>
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
          NEAR Protocol &middot; NEAR AI &middot; Shade Agents &middot; Ensue Network &middot; Nova SDK
        </footer>
      </div>
    </div>
  );
}

/* ─── Finalized Proposal Row (aggregate only) ────────────────────────────── */

function FinalizedProposalRow({
  proposalId,
  proposal,
}: {
  proposalId: number;
  proposal: OnChainProposal;
}) {
  const parsed = proposal.finalized_result
    ? (() => {
        try {
          return JSON.parse(proposal.finalized_result);
        } catch {
          return null;
        }
      })()
    : null;

  const isVote = parsed && typeof parsed.approved === "number";

  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-800/60 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-mono text-zinc-400 font-bold">#{proposalId}</span>
        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${STATE_COLORS[proposal.state]}`}
        >
          {proposal.state}
        </span>
        {isVote && (
          <span
            className={`font-semibold ${
              parsed.decision === "Approved" ? "text-green-400" : "text-red-400"
            }`}
          >
            {parsed.decision}
          </span>
        )}
      </div>
      {isVote && (
        <span className="text-zinc-500">
          {parsed.approved}Y / {parsed.rejected}N
        </span>
      )}
    </div>
  );
}

