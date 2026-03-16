"use client";

interface ErrorScreenProps {
  error?: string;
  coordinatorDid?: string;
  cvmId?: string;
  dashboardUrl?: string;
  onRetry: () => void;
  onReset: () => void;
}

export default function ErrorScreen({
  error,
  coordinatorDid,
  cvmId,
  dashboardUrl,
  onRetry,
  onReset,
}: ErrorScreenProps) {
  return (
    <div className="rounded border border-red-900/20 bg-[#0a0f0a]/80 p-6 terminal-card">
      <h3 className="text-sm font-semibold text-red-400 mb-2 font-mono">
        Deployment failed
      </h3>

      <p className="text-xs text-zinc-400 font-mono mb-4 leading-relaxed">
        {error || "Something went wrong during coordinator deployment."}
      </p>

      {(coordinatorDid || cvmId) && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded p-3 mb-4 space-y-1.5">
          {coordinatorDid && (
            <div className="text-[10px] text-zinc-500 font-mono">
              <span className="text-zinc-600">Coordinator DID:</span>{" "}
              <span className="text-zinc-400 break-all">{coordinatorDid}</span>
            </div>
          )}
          {cvmId && (
            <div className="text-[10px] text-zinc-500 font-mono">
              <span className="text-zinc-600">CVM ID:</span>{" "}
              <span className="text-zinc-400">{cvmId}</span>
              {dashboardUrl && (
                <>
                  {" "}
                  <a
                    href={dashboardUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#00ff41]/60 underline hover:text-[#00ff41]"
                  >
                    view
                  </a>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onRetry}
          className="flex-1 px-4 py-2.5 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-xs font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all"
        >
          Retry
        </button>
        <button
          onClick={onReset}
          className="px-4 py-2.5 rounded border border-zinc-700 bg-zinc-800 text-xs text-zinc-400 font-mono hover:border-zinc-600 transition-colors"
        >
          Start over
        </button>
      </div>
    </div>
  );
}
