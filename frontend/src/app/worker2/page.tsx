"use client";

import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import WorkerDashboardContent from "../components/WorkerDashboardContent";

const WORKER_ID = "worker2";
const ACCOUNT_ID = "worker2.agents-coordinator.testnet";

export default function Worker2Dashboard() {
  const { accountId, workerId, forceConnect, disconnect, connecting } = useAuth();

  useEffect(() => {
    // Auto-connect if not already connected as this specific worker
    if (!connecting && accountId !== ACCOUNT_ID) {
      forceConnect(ACCOUNT_ID);
    }
  }, [accountId, forceConnect, connecting]);

  if (connecting || accountId !== ACCOUNT_ID) {
    return (
      <div className="min-h-screen bg-[#050505] flex items-center justify-center font-mono text-[#00ff41]">
        <div className="animate-pulse">connecting as worker 2...</div>
      </div>
    );
  }

  return (
    <WorkerDashboardContent
      workerId={workerId || WORKER_ID}
      accountId={accountId}
      onDisconnect={disconnect}
    />
  );
}
