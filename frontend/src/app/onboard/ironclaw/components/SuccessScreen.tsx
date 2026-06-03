"use client";
import Link from "next/link";
import { useState } from "react";
import type { OnboardingApi } from "../hooks/useOutlayerOnboarding";

interface Props {
  onboard: OnboardingApi;
}

export default function SuccessScreen({ onboard }: Props) {
  const { wallet, worker_did, register_tx_hash } = onboard.state;
  const [copied, setCopied] = useState(false);

  function copyKey() {
    if (!wallet?.api_key) return;
    navigator.clipboard.writeText(wallet.api_key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-bold">Your worker is live</h1>
      <p className="mt-2 text-gray-600">
        Tx{" "}
        <a
          className="text-blue-700 underline"
          target="_blank"
          rel="noreferrer"
          href={`https://explorer.testnet.near.org/transactions/${register_tx_hash}`}
        >
          {register_tx_hash?.slice(0, 12)}…
        </a>
      </p>

      <div className="mt-6 rounded bg-yellow-50 p-4 text-sm">
        <h3 className="font-semibold">Save this API key now</h3>
        <p className="mt-1 text-xs text-gray-700">
          Outlayer only shows it once. You&rsquo;ll need it as{" "}
          <code className="ml-1">OUTLAYER_API_KEY</code> on your agent.
        </p>
        <button
          onClick={copyKey}
          className="mt-2 rounded bg-yellow-200 px-3 py-1 text-xs"
        >
          {copied ? "Copied ✓" : "Copy api_key"}
        </button>
      </div>

      <div className="mt-6 space-y-2 text-sm">
        <p>
          <strong>Worker DID:</strong>{" "}
          <code className="text-xs">{worker_did}</code>
        </p>
        <p>
          <strong>NEAR account:</strong>{" "}
          <code className="text-xs">{wallet?.near_account_id}</code>
        </p>
      </div>

      <div className="mt-8 flex gap-3">
        <Link
          href={`/dashboard/worker/${worker_did}`}
          className="rounded-md bg-blue-600 px-6 py-3 text-white"
        >
          View in dashboard →
        </Link>
        <button
          onClick={onboard.reset}
          className="rounded-md border px-6 py-3"
        >
          Register another
        </button>
      </div>
    </main>
  );
}
