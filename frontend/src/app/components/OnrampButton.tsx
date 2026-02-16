"use client";

import { useCallback, useState } from "react";

export default function OnrampButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOnramp = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { PingpayOnramp } = await import("@pingpay/onramp-sdk");
      const onramp = new PingpayOnramp({
        onPopupReady: () => setLoading(false),
        onPopupClose: () => setLoading(false),
      });
      await onramp.initiateOnramp({ chain: "NEAR", asset: "wNEAR" });
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to open onramp");
    }
  }, []);

  return (
    <div className="inline-flex flex-col items-center gap-1">
      <button
        onClick={handleOnramp}
        disabled={loading}
        className="px-6 py-3 rounded border border-purple-500/30 bg-purple-500/10
                   text-sm font-semibold text-purple-400 font-mono
                   hover:bg-purple-500/15 hover:border-purple-500/50 transition-all
                   disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "opening..." : "buy NEAR"}
      </button>
      {error && (
        <span className="text-[10px] text-red-400 font-mono">{error}</span>
      )}
    </div>
  );
}
