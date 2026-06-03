"use client";
import type { AuthState } from "@/lib/auth";

export default function ConnectScreen({ connect, connecting }: AuthState) {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-bold">Bring your IronClaw to Delibera</h1>
      <p className="mt-2 text-gray-600">
        This wizard registers your IronClaw agent as a worker on the Delibera
        protocol. You&rsquo;ll need ~0.15 NEAR (testnet) and about 3 minutes.
      </p>
      <button
        onClick={connect}
        disabled={connecting}
        className="mt-8 rounded-md bg-blue-600 px-6 py-3 text-white disabled:opacity-50"
      >
        {connecting ? "Connecting…" : "Connect NEAR Wallet"}
      </button>
      <p className="mt-4 text-xs text-gray-500">
        We use your wallet for ONE on-chain signature (policy commit). Your
        agent&rsquo;s keys live in an Intel TDX enclave inside outlayer; we
        never see them.
      </p>
    </main>
  );
}
