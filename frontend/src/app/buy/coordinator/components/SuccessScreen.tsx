"use client";

import { useState } from "react";
import Link from "next/link";
import { downloadCoordinatorRecoveryFile } from "../utils/recovery-file";

interface SuccessScreenProps {
  coordinatorDid: string;
  displayName: string;
  contractAddress?: string;
  phalaEndpoint?: string;
  cvmId?: string;
  nearAccount: string;
  storachaPrivateKey?: string;
  minWorkers: number;
  maxWorkers: number;
  ensueOrgName?: string;
  ensueClaimUrl?: string;
  ensueVerificationCode?: string;
  onReset: () => void;
}

export default function SuccessScreen({
  coordinatorDid,
  displayName,
  contractAddress,
  phalaEndpoint,
  cvmId,
  nearAccount,
  storachaPrivateKey,
  minWorkers,
  maxWorkers,
  ensueOrgName,
  ensueClaimUrl,
  ensueVerificationCode,
  onReset,
}: SuccessScreenProps) {
  const [copiedDid, setCopiedDid] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  function handleCopyDid() {
    navigator.clipboard.writeText(coordinatorDid);
    setCopiedDid(true);
    setTimeout(() => setCopiedDid(false), 2000);
  }

  function handleCopyCode() {
    if (!ensueVerificationCode) return;
    navigator.clipboard.writeText(ensueVerificationCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  }

  function handleDownloadRecovery() {
    downloadCoordinatorRecoveryFile({
      coordinatorDid,
      displayName,
      contractAddress,
      phalaEndpoint,
      cvmId,
      nearAccount,
      storachaPrivateKey: storachaPrivateKey || "(not available)",
      minWorkers,
      maxWorkers,
      ensueOrgName,
      ensueClaimUrl,
      ensueVerificationCode,
      registeredAt: new Date().toISOString(),
    });
  }

  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 terminal-card">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[#00ff41] text-lg">&#10003;</span>
        <h3 className="text-sm font-semibold text-zinc-100 font-mono">
          Coordinator Active!
        </h3>
      </div>

      <p className="text-xs text-zinc-400 font-mono mb-4">
        <span className="text-zinc-200">{displayName}</span> is live on the
        Delibera network.
      </p>

      {/* Coordinator details */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded p-3 mb-4 space-y-2">
        <div>
          <p className="text-[9px] text-zinc-600 font-mono mb-0.5">Coordinator DID</p>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-zinc-300 font-mono break-all">
              {coordinatorDid}
            </span>
            <button
              onClick={handleCopyDid}
              className="text-[9px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500 font-mono hover:border-zinc-600 hover:text-zinc-400 transition-colors shrink-0"
            >
              {copiedDid ? "copied" : "copy"}
            </button>
          </div>
        </div>

        {contractAddress && (
          <div>
            <p className="text-[9px] text-zinc-600 font-mono mb-0.5">Contract address</p>
            <p className="text-[10px] text-zinc-400 font-mono break-all">{contractAddress}</p>
          </div>
        )}

        {phalaEndpoint && (
          <div>
            <p className="text-[9px] text-zinc-600 font-mono mb-0.5">Phala endpoint</p>
            <p className="text-[10px] text-zinc-400 font-mono break-all">{phalaEndpoint}</p>
          </div>
        )}

        <div>
          <p className="text-[9px] text-zinc-600 font-mono mb-0.5">Worker pool</p>
          <p className="text-[10px] text-zinc-400 font-mono">
            min {minWorkers} / max {maxWorkers}
          </p>
        </div>
      </div>

      {/* Ensue claim (critical) */}
      {ensueClaimUrl && (
        <div className="border border-yellow-900/40 bg-yellow-950/20 rounded p-3 mb-4">
          <p className="text-[10px] text-yellow-500 font-mono font-semibold mb-2">
            &#9888; Activate coordination memory
          </p>
          <p className="text-[10px] text-zinc-400 font-mono mb-2 leading-relaxed">
            Visit the link below and enter your verification code to activate
            your coordinator&apos;s memory. Until this is done, your coordinator
            cannot store deliberation state.
          </p>
          <a
            href={ensueClaimUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[#00ff41]/70 font-mono underline hover:text-[#00ff41] block mb-2 break-all"
          >
            {ensueClaimUrl}
          </a>
          {ensueVerificationCode && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-500 font-mono">
                Code:{" "}
                <span className="text-zinc-200 font-semibold">
                  {ensueVerificationCode}
                </span>
              </span>
              <button
                onClick={handleCopyCode}
                className="text-[9px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500 font-mono hover:border-zinc-600 hover:text-zinc-400 transition-colors"
              >
                {copiedCode ? "copied" : "copy"}
              </button>
            </div>
          )}
          <p className="text-[9px] text-zinc-600 font-mono mt-2">
            Also included in your recovery file.
          </p>
        </div>
      )}

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
          Deploy another coordinator
        </button>
      </div>
    </div>
  );
}
