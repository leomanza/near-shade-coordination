"use client";

import { useState } from "react";
import Link from "next/link";
import { downloadRecoveryFile } from "../utils/recovery-file";

interface SuccessScreenProps {
  workerDid: string;
  displayName: string;
  coordinatorDid: string;
  phalaEndpoint?: string;
  cvmId?: string;
  nearAccount: string;
  storachaPrivateKey?: string;
  onReset: () => void;
}

export default function SuccessScreen({
  workerDid,
  displayName,
  coordinatorDid,
  phalaEndpoint,
  cvmId,
  nearAccount,
  storachaPrivateKey,
  onReset,
}: SuccessScreenProps) {
  const [copied, setCopied] = useState(false);

  function handleCopyDid() {
    navigator.clipboard.writeText(workerDid);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownloadRecovery() {
    downloadRecoveryFile({
      workerDid,
      displayName,
      coordinatorDid,
      phalaEndpoint,
      cvmId,
      nearAccount,
      storachaPrivateKey: storachaPrivateKey || "(not available)",
      registeredAt: new Date().toISOString(),
    });
  }

  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 terminal-card">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[#00ff41] text-lg">&#10003;</span>
        <h3 className="text-sm font-semibold text-zinc-100 font-mono">
          Worker Active!
        </h3>
      </div>

      <p className="text-xs text-zinc-400 font-mono mb-4">
        <span className="text-zinc-200">{displayName}</span> is live and
        connected to the coordination network.
      </p>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded p-3 mb-4 space-y-2">
        <div>
          <p className="text-[9px] text-zinc-600 font-mono mb-0.5">Worker DID</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-300 font-mono break-all">
              {workerDid}
            </span>
            <button
              onClick={handleCopyDid}
              className="text-[9px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500 font-mono hover:border-zinc-600 hover:text-zinc-400 transition-colors shrink-0"
            >
              {copied ? "copied" : "copy"}
            </button>
          </div>
        </div>

        {phalaEndpoint && (
          <div>
            <p className="text-[9px] text-zinc-600 font-mono mb-0.5">
              Phala endpoint
            </p>
            <p className="text-[10px] text-zinc-400 font-mono break-all">
              {phalaEndpoint}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={handleDownloadRecovery}
          className="w-full px-4 py-2.5 rounded border border-zinc-700 bg-zinc-800 text-xs text-zinc-300 font-mono hover:border-zinc-600 hover:text-zinc-200 transition-colors"
        >
          Download recovery file
        </button>

        <Link
          href="/dashboard"
          className="w-full px-4 py-2.5 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-xs font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all text-center"
        >
          View in Dashboard
        </Link>

        <button
          onClick={onReset}
          className="text-[10px] text-zinc-600 font-mono hover:text-zinc-500 transition-colors mt-1"
        >
          Deploy another worker
        </button>
      </div>
    </div>
  );
}
