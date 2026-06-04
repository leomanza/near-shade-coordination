"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OnboardingApi } from "../hooks/useOutlayerOnboarding";

const NEAR_RPC = "https://test.rpc.fastnear.com";
const TARGET_YOCTO = BigInt("110000000000000000000000"); // 0.11 NEAR

interface Props {
  onboard: OnboardingApi;
}

export default function FundScreen({ onboard }: Props) {
  const account = onboard.state.wallet?.near_account_id;
  const [balance, setBalance] = useState<bigint>(BigInt(0));
  const [poll, setPoll] = useState(0);
  const [checking, setChecking] = useState(false);
  const advancedRef = useRef(false);

  // Single source of truth for "is the wallet funded?" — used by the
  // automatic 3s poll AND the manual "Check now" button. The wallet's own
  // tx-status UI can briefly show "transaction doesn't exist" due to RPC
  // propagation race; we ignore that and trust view_account.
  const checkBalance = useCallback(async () => {
    if (!account) return;
    setChecking(true);
    try {
      const res = await fetch(NEAR_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "query",
          params: { request_type: "view_account", finality: "final", account_id: account },
        }),
      });
      const json = await res.json();
      const amount = BigInt(json.result?.amount ?? "0");
      setBalance(amount);
      if (!advancedRef.current && amount >= TARGET_YOCTO) {
        advancedRef.current = true;
        onboard.advance("policy");
      }
    } catch {
      /* swallow; user can retry */
    } finally {
      setChecking(false);
    }
  }, [account, onboard]);

  useEffect(() => {
    if (!account) return;
    checkBalance();
    const id = setInterval(() => {
      setPoll((n) => n + 1);
      checkBalance();
    }, 3000);
    return () => clearInterval(id);
  }, [account, checkBalance]);

  if (!account) return null;
  const fundUrl = `https://outlayer.fastnear.com/wallet/fund?to=${account}&amount=0.15`;

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">Fund your worker</h1>
      <p className="mt-2 text-gray-600">
        Send 0.15 NEAR to the address below. Funds cover the 0.1 NEAR
        registration deposit + ~0.001 NEAR for policy storage + gas.
      </p>

      <div className="mt-6 rounded bg-gray-100 p-4 font-mono text-xs break-all">
        {account}
      </div>

      <a
        href={fundUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-6 inline-block rounded-md bg-blue-600 px-6 py-3 text-white"
      >
        Fund via outlayer (one-click)
      </a>

      <details className="mt-4 cursor-pointer">
        <summary className="text-sm text-blue-700">Or fund via CLI</summary>
        <pre className="mt-2 rounded bg-gray-900 p-3 text-xs text-gray-100">
{`near tokens <YOUR>.testnet send-near ${account} '0.15 NEAR' --networkId testnet`}
        </pre>
      </details>

      <div className="mt-8 flex items-center gap-3">
        <button
          onClick={checkBalance}
          disabled={checking}
          className="rounded-md border px-3 py-1 text-sm disabled:opacity-50"
        >
          {checking ? "Checking…" : "Check balance now"}
        </button>
        <span className="text-sm">
          Polled {poll} times · Balance:{" "}
          <strong>{(Number(balance) / 1e24).toFixed(4)} NEAR</strong> / 0.11 needed
        </span>
      </div>

      <p className="mt-3 text-xs text-gray-500">
        <strong>Heads-up:</strong> when you sign the fund tx, your wallet may
        briefly show &ldquo;Transaction doesn&rsquo;t exist&rdquo; — that&rsquo;s
        a known race between your wallet&rsquo;s status check and NEAR&rsquo;s
        RPC propagation. The on-chain balance above is authoritative; ignore
        the wallet error and let this poll catch up.
      </p>
    </main>
  );
}
