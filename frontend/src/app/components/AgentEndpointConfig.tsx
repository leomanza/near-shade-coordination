"use client";

import { useState, useEffect } from "react";
import { fetchAgentEndpoints, updateAgentEndpoint } from "@/lib/api";

export default function AgentEndpointConfig({ agentId }: { agentId: string }) {
  const [endpoint, setEndpoint] = useState("");
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const [cvmId, setCvmId] = useState<string | null>(null);
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchAgentEndpoints().then((agents) => {
      const info = agents[agentId];
      if (info) {
        setCurrentEndpoint(info.endpoint);
        if (info.endpoint) setEndpoint(info.endpoint);
        setCvmId(info.cvmId);
        setDashboardUrl(info.dashboardUrl);
      }
    });
  }, [agentId]);

  async function handleSave() {
    if (!endpoint) return;
    setSaving(true);
    setSaved(false);
    const ok = await updateAgentEndpoint(agentId, endpoint);
    if (ok) {
      setCurrentEndpoint(endpoint);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  return (
    <div className="mb-6 p-4 rounded border border-zinc-800 bg-[#0a0f0a]/80">
      <h3 className="text-xs font-semibold text-zinc-400 font-mono mb-3 uppercase tracking-wider">
        Agent Endpoint &middot; {agentId}
      </h3>

      {currentEndpoint ? (
        <div className="text-xs font-mono text-[#00ff41]/80 mb-2 break-all">
          {currentEndpoint}
        </div>
      ) : (
        <p className="text-xs text-zinc-600 font-mono mb-2">No endpoint configured</p>
      )}

      {cvmId && (
        <div className="text-[10px] text-zinc-600 font-mono mb-1">
          CVM: {cvmId}
          {dashboardUrl && (
            <>
              {" — "}
              <a href={dashboardUrl} target="_blank" rel="noopener noreferrer" className="text-zinc-500 underline hover:text-zinc-400">
                dashboard
              </a>
            </>
          )}
        </div>
      )}

      <div className="flex gap-2 mt-3">
        <input
          type="text"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://...dstack-pha-prod5.phala.network"
          className="flex-1 px-3 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-300 font-mono placeholder:text-zinc-700 focus:border-[#00ff41]/30 focus:outline-none"
        />
        <button
          onClick={handleSave}
          disabled={saving || !endpoint || endpoint === currentEndpoint}
          className="px-3 py-1.5 rounded text-xs font-mono bg-[#00ff41]/10 border border-[#00ff41]/30 text-[#00ff41] hover:bg-[#00ff41]/15 transition-all disabled:opacity-30"
        >
          {saving ? "saving..." : saved ? "saved" : "update"}
        </button>
      </div>
    </div>
  );
}
