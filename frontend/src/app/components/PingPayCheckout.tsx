"use client";

import { useState } from "react";
import { createCheckoutSession } from "@/lib/api";

interface Props {
  label: string;
  amount: string;
  chain?: string;
  symbol?: string;
  metadata?: Record<string, unknown>;
  className?: string;
}

export default function PingPayCheckout({
  label,
  amount,
  chain = "NEAR",
  symbol = "USDC",
  metadata,
  className,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCheckout() {
    setLoading(true);
    setError(null);
    try {
      const currentUrl = new URL(window.location.href);
      const baseUrl = `${currentUrl.origin}${currentUrl.pathname}`;
      const successUrl = `${baseUrl}?pingpay=success`;
      const cancelUrl = `${baseUrl}?pingpay=cancel`;

      const result = await createCheckoutSession({
        amount,
        chain,
        symbol,
        successUrl,
        cancelUrl,
        metadata,
      });

      if (result?.sessionUrl) {
        window.location.href = result.sessionUrl;
      } else {
        setError("Failed to create checkout session");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        onClick={handleCheckout}
        disabled={loading}
        className={
          className ||
          `text-[10px] px-3 py-1.5 rounded border border-purple-500/30 bg-purple-500/10
           text-purple-400 font-mono hover:bg-purple-500/15 hover:border-purple-500/50
           transition-all disabled:opacity-40 disabled:cursor-not-allowed`
        }
      >
        {loading ? "creating session..." : label}
      </button>
      {error && (
        <span className="text-[10px] text-red-400 font-mono">{error}</span>
      )}
    </div>
  );
}
