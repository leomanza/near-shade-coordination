"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import PingPayCheckout from "../components/PingPayCheckout";
import {
  getActiveCoordinators,
  getRegistryStats,
  deployToPhala,
  updateAgentEndpoint,
  type RegistryCoordinator,
  type DeployResponse,
} from "@/lib/api";

type AgentType = "coordinator" | "worker";

export default function BuyPage() {
  const { accountId, connect, disconnect, connecting } = useAuth();
  const [tab, setTab] = useState<AgentType>(() => {
    if (typeof window !== "undefined") {
      return (sessionStorage.getItem("delibera_tab") as AgentType) || "worker";
    }
    return "worker";
  });

  // Persist tab selection
  useEffect(() => {
    sessionStorage.setItem("delibera_tab", tab);
  }, [tab]);

  return (
    <div className="min-h-screen bg-[#050505] p-6 md:p-10 max-w-4xl mx-auto">
      <div className="fixed inset-0 cyber-grid pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none opacity-30" />

      <div className="relative z-10">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
              <img src="/logo-iso.svg" alt="Delibera" className="h-8 w-8" />
              <h1 className="text-xl font-bold text-zinc-100 font-mono">Delibera</h1>
            </Link>
            {accountId ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 font-mono truncate max-w-[180px]">
                  {accountId}
                </span>
                <button
                  onClick={disconnect}
                  className="text-[10px] px-3 py-1.5 rounded border border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 transition-colors font-mono"
                >
                  disconnect
                </button>
              </div>
            ) : null}
          </div>
          <p className="text-sm text-zinc-500 font-mono">
            Deploy Agent &middot; deploy your own coordinator or worker to Delibera
          </p>
        </header>

        {/* Connect wallet prompt */}
        {!accountId ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm text-zinc-500 font-mono mb-6">
              Connect your NEAR wallet to deploy an agent
            </p>
            <button
              onClick={connect}
              disabled={connecting}
              className="px-6 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-sm font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-40"
            >
              {connecting ? "connecting..." : "connect wallet"}
            </button>
          </div>
        ) : (
          <>
            {/* Tab selector */}
            <div className="flex gap-2 mb-6">
              <button
                onClick={() => setTab("coordinator")}
                className={`px-4 py-2 rounded text-xs font-mono transition-all border ${
                  tab === "coordinator"
                    ? "bg-[#00ff41]/10 border-[#00ff41]/30 text-[#00ff41]"
                    : "border-zinc-800 text-zinc-500 hover:border-zinc-600"
                }`}
              >
                Deploy Coordinator
              </button>
              <button
                onClick={() => setTab("worker")}
                className={`px-4 py-2 rounded text-xs font-mono transition-all border ${
                  tab === "worker"
                    ? "bg-[#00ff41]/10 border-[#00ff41]/30 text-[#00ff41]"
                    : "border-zinc-800 text-zinc-500 hover:border-zinc-600"
                }`}
              >
                Deploy Worker
              </button>
            </div>

            {/* Stats bar */}
            <RegistryStats />

            {/* Form */}
            {tab === "coordinator" ? (
              <CoordinatorForm accountId={accountId} />
            ) : (
              <WorkerForm accountId={accountId} />
            )}
          </>
        )}

        <footer className="mt-8 text-center text-[10px] text-zinc-700 font-mono">
          NEAR Protocol &middot; NEAR AI &middot; Shade Agents &middot; Ensue Network &middot; Nova SDK
        </footer>
      </div>
    </div>
  );
}

/* ─── Registry Stats ──────────────────────────────────────────────────── */

function RegistryStats() {
  const [stats, setStats] = useState<{
    total_coordinators: number;
    active_coordinators: number;
    total_workers: number;
    active_workers: number;
  } | null>(null);

  useEffect(() => {
    getRegistryStats().then(setStats);
  }, []);

  if (!stats) return null;

  return (
    <div className="flex gap-4 mb-6 p-3 rounded border border-zinc-800 bg-[#0a0f0a]/80 text-xs font-mono text-zinc-500">
      <span>
        <span className="text-[#00ff41]">{stats.active_coordinators}</span> coordinators
      </span>
      <span>
        <span className="text-[#00ff41]">{stats.active_workers}</span> workers
      </span>
      <span className="text-zinc-700">on-chain registry</span>
    </div>
  );
}

/* ─── Coordinator Deploy Form ─────────────────────────────────────────── */

const COORD_STORAGE_KEY = "delibera_coord_form";
const WORKER_STORAGE_KEY = "delibera_worker_form";

function CoordinatorForm({ accountId }: { accountId: string }) {
  const [name, setName] = useState("");
  const [ensueApiKey, setEnsueApiKey] = useState("");
  const [ensueToken, setEnsueToken] = useState("");
  const [nearAiApiKey, setNearAiApiKey] = useState("");
  const [sponsorAccountId, setSponsorAccountId] = useState("");
  const [sponsorPrivateKey, setSponsorPrivateKey] = useState("");
  const [agentContractId, setAgentContractId] = useState("");
  const [phalaApiKey, setPhalaApiKey] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<DeployResponse | null>(null);
  const [paymentDone, setPaymentDone] = useState(false);

  // Restore form state after PingPay redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("pingpay") === "success") {
      setPaymentDone(true);
      try {
        const saved = sessionStorage.getItem(COORD_STORAGE_KEY);
        if (saved) {
          const s = JSON.parse(saved);
          if (s.name) setName(s.name);
          if (s.ensueApiKey) setEnsueApiKey(s.ensueApiKey);
          if (s.ensueToken) setEnsueToken(s.ensueToken);
          if (s.nearAiApiKey) setNearAiApiKey(s.nearAiApiKey);
          if (s.sponsorAccountId) setSponsorAccountId(s.sponsorAccountId);
          if (s.sponsorPrivateKey) setSponsorPrivateKey(s.sponsorPrivateKey);
          if (s.agentContractId) setAgentContractId(s.agentContractId);
          if (s.phalaApiKey) setPhalaApiKey(s.phalaApiKey);
          sessionStorage.removeItem(COORD_STORAGE_KEY);
        }
      } catch {}
    }
  }, []);

  async function handleDeploy() {
    setDeploying(true);
    setResult(null);
    const res = await deployToPhala({
      type: "coordinator",
      name,
      phalaApiKey,
      ensueApiKey,
      ensueToken,
      nearAiApiKey,
      sponsorAccountId,
      sponsorPrivateKey,
      agentContractId: agentContractId || undefined,
    });
    // Save the deployed coordinator's endpoint URL to Ensue
    if (res?.success && res.endpointUrl && res.name) {
      updateAgentEndpoint(res.name, res.endpointUrl, res.cvmId, res.dashboardUrl);
    }
    setResult(res);
    setDeploying(false);
  }

  // Persist form state so it survives PingPay redirect
  useEffect(() => {
    if (!paymentDone && name) {
      sessionStorage.setItem(COORD_STORAGE_KEY, JSON.stringify({
        name, ensueApiKey, ensueToken, nearAiApiKey, sponsorAccountId, sponsorPrivateKey, agentContractId, phalaApiKey,
      }));
    }
  }, [name, ensueApiKey, ensueToken, nearAiApiKey, sponsorAccountId, sponsorPrivateKey, agentContractId, phalaApiKey, paymentDone]);

  const canDeploy = name.length >= 2 && ensueApiKey && sponsorAccountId && sponsorPrivateKey;

  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 terminal-card">
      <h3 className="text-sm font-semibold text-zinc-100 mb-1 font-mono">
        // Deploy Coordinator Agent
      </h3>
      <p className="text-[10px] text-zinc-600 mb-6">
        A coordinator dispatches proposals to workers, tallies votes, and settles results on-chain.
      </p>

      <div className="space-y-4">
        <Field label="Owner Account" value={accountId} disabled />
        <Field label="Coordinator Name" value={name} onChange={setName} placeholder="my-dao" />

        <div className="border-t border-zinc-800 pt-4">
          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-3">
            API Keys (stored encrypted in Phala TEE)
          </p>
          <div className="space-y-3">
            <Field label="Ensue API Key" value={ensueApiKey} onChange={setEnsueApiKey} placeholder="lmn_..." type="password" />
            <Field label="Ensue Token" value={ensueToken} onChange={setEnsueToken} placeholder="(same as API key if applicable)" type="password" />
            <Field label="NEAR AI API Key" value={nearAiApiKey} onChange={setNearAiApiKey} placeholder="sk-..." type="password" />
            <Field label="Phala Cloud API Key (optional — skip for local)" value={phalaApiKey} onChange={setPhalaApiKey} placeholder="phak_..." type="password" />
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-4">
          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-3">
            Shade Agent Config (Sponsor funds the agent account)
          </p>
          <div className="space-y-3">
            <Field label="Sponsor Account ID" value={sponsorAccountId} onChange={setSponsorAccountId} placeholder="your-account.near" />
            <Field label="Sponsor Private Key" value={sponsorPrivateKey} onChange={setSponsorPrivateKey} placeholder="ed25519:..." type="password" />
            <Field label="Agent Contract ID (optional — defaults to platform contract)" value={agentContractId} onChange={setAgentContractId} placeholder="coordinator.agents-coordinator.near" />
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-4">
          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-3">
            Payment (0.1 NEAR minimum)
          </p>
          {!paymentDone ? (
            <PingPayCheckout
              label="pay 0.1 NEAR to register"
              amount="100000000000000000000000"
              chain="NEAR"
              symbol="NEAR"
              metadata={{ type: "buy_coordinator", name, owner: accountId }}
              className="text-xs px-4 py-2 rounded border border-[#00ff41]/30 bg-[#00ff41]/10 text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-40"
            />
          ) : (
            <span className="text-xs text-green-400 font-mono">Payment received</span>
          )}
        </div>

        <button
          onClick={handleDeploy}
          disabled={!canDeploy || deploying || !paymentDone}
          className="w-full mt-2 px-4 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-sm font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {deploying ? "deploying..." : "deploy coordinator"}
        </button>

        {result && (
          <div className={`p-3 rounded text-xs font-mono ${result.success ? "bg-green-950/30 border border-green-900/40 text-green-400" : "bg-red-950/30 border border-red-900/40 text-red-400"}`}>
            {result.success ? (
              result.cvmId ? (
                <span>
                  Deployed! CVM ID: {result.cvmId}
                  {result.dashboardUrl && (
                    <>
                      {" — "}
                      <a href={result.dashboardUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-300">
                        view dashboard
                      </a>
                    </>
                  )}
                </span>
              ) : "Registered locally!"
            ) : `Error: ${result.error}`}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Worker Deploy Form ──────────────────────────────────────────────── */

function WorkerForm({ accountId }: { accountId: string }) {
  const [name, setName] = useState("");
  const [ensueApiKey, setEnsueApiKey] = useState("");
  const [ensueToken, setEnsueToken] = useState("");
  const [novaApiKey, setNovaApiKey] = useState("");
  const [novaAccountId, setNovaAccountId] = useState("");
  const [novaGroupId, setNovaGroupId] = useState("");
  const [nearAiApiKey, setNearAiApiKey] = useState("");
  const [phalaApiKey, setPhalaApiKey] = useState("");
  const [coordinatorId, setCoordinatorId] = useState<string>("");
  const [coordinators, setCoordinators] = useState<RegistryCoordinator[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [result, setResult] = useState<DeployResponse | null>(null);
  const [paymentDone, setPaymentDone] = useState(false);

  useEffect(() => {
    getActiveCoordinators().then((c) => setCoordinators(c ?? []));
  }, []);

  // Restore form state after PingPay redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("pingpay") === "success") {
      setPaymentDone(true);
      try {
        const saved = sessionStorage.getItem(WORKER_STORAGE_KEY);
        if (saved) {
          const s = JSON.parse(saved);
          if (s.name) setName(s.name);
          if (s.ensueApiKey) setEnsueApiKey(s.ensueApiKey);
          if (s.ensueToken) setEnsueToken(s.ensueToken);
          if (s.novaApiKey) setNovaApiKey(s.novaApiKey);
          if (s.novaAccountId) setNovaAccountId(s.novaAccountId);
          if (s.novaGroupId) setNovaGroupId(s.novaGroupId);
          if (s.nearAiApiKey) setNearAiApiKey(s.nearAiApiKey);
          if (s.phalaApiKey) setPhalaApiKey(s.phalaApiKey);
          if (s.coordinatorId) setCoordinatorId(s.coordinatorId);
          sessionStorage.removeItem(WORKER_STORAGE_KEY);
        }
      } catch {}
    }
  }, []);

  async function handleDeploy() {
    setDeploying(true);
    setResult(null);
    const res = await deployToPhala({
      type: "worker",
      name,
      phalaApiKey,
      ensueApiKey,
      ensueToken,
      nearAiApiKey,
      novaApiKey,
      novaAccountId,
      novaGroupId: novaGroupId || undefined,
      coordinatorId: coordinatorId || undefined,
    });
    // Save the deployed worker's endpoint URL to Ensue for future API calls
    if (res?.success && res.endpointUrl && res.name) {
      updateAgentEndpoint(res.name, res.endpointUrl, res.cvmId, res.dashboardUrl);
    }
    setResult(res);
    setDeploying(false);
  }

  // Persist form state so it survives PingPay redirect
  useEffect(() => {
    if (!paymentDone && name) {
      sessionStorage.setItem(WORKER_STORAGE_KEY, JSON.stringify({
        name, ensueApiKey, ensueToken, novaApiKey, novaAccountId, novaGroupId, nearAiApiKey, phalaApiKey, coordinatorId,
      }));
    }
  }, [name, ensueApiKey, ensueToken, novaApiKey, novaAccountId, novaGroupId, nearAiApiKey, phalaApiKey, coordinatorId, paymentDone]);

  const canDeploy = name.length >= 2 && ensueApiKey && nearAiApiKey;

  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 terminal-card">
      <h3 className="text-sm font-semibold text-zinc-100 mb-1 font-mono">
        // Deploy Worker Agent
      </h3>
      <p className="text-[10px] text-zinc-600 mb-6">
        A worker agent deliberates on proposals using AI, maintains persistent identity via Nova, and votes privately.
      </p>

      <div className="space-y-4">
        <Field label="Owner Account" value={accountId} disabled />
        <Field label="Worker Name" value={name} onChange={setName} placeholder="voter-alice" />

        {/* Optional: Join a coordinator */}
        <div>
          <label className="block text-[10px] text-zinc-500 font-mono mb-1">
            Join Coordinator (optional)
          </label>
          <select
            value={coordinatorId}
            onChange={(e) => setCoordinatorId(e.target.value)}
            className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-mono focus:border-[#00ff41]/30 focus:outline-none"
          >
            <option value="">-- none (set later) --</option>
            {coordinators.map((c) => (
              <option key={c.coordinator_id} value={c.coordinator_id}>
                {c.coordinator_id} (owner: {c.owner.slice(0, 20)}...)
              </option>
            ))}
          </select>
        </div>

        {/* Optional: Reuse existing Nova Group */}
        <Field label="Nova Group ID (optional — reuse existing group)" value={novaGroupId} onChange={setNovaGroupId} placeholder="delibera-worker-alice-1234567890" />

        <div className="border-t border-zinc-800 pt-4">
          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-3">
            API Keys (stored encrypted in Phala TEE)
          </p>
          <div className="space-y-3">
            <Field label="Ensue API Key" value={ensueApiKey} onChange={setEnsueApiKey} placeholder="lmn_..." type="password" />
            <Field label="Ensue Token" value={ensueToken} onChange={setEnsueToken} placeholder="(same as API key if applicable)" type="password" />
            <Field label="NEAR AI API Key" value={nearAiApiKey} onChange={setNearAiApiKey} placeholder="sk-..." type="password" />
            <Field label="Nova API Key (optional)" value={novaApiKey} onChange={setNovaApiKey} placeholder="nova_sk_..." type="password" />
            <Field label="Nova Account ID (optional)" value={novaAccountId} onChange={setNovaAccountId} placeholder="your-account.near" />
            <Field label="Phala Cloud API Key (optional — skip for local)" value={phalaApiKey} onChange={setPhalaApiKey} placeholder="sk-..." type="password" />
          </div>
        </div>

        <div className="border-t border-zinc-800 pt-4">
          <p className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-3">
            Payment (0.1 NEAR minimum)
          </p>
          {!paymentDone ? (
            <PingPayCheckout
              label="pay 0.1 NEAR to register"
              amount="100000000000000000000000"
              chain="NEAR"
              symbol="NEAR"
              metadata={{ type: "buy_worker", name, owner: accountId }}
              className="text-xs px-4 py-2 rounded border border-[#00ff41]/30 bg-[#00ff41]/10 text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-40"
            />
          ) : (
            <span className="text-xs text-green-400 font-mono">Payment received</span>
          )}
        </div>

        <button
          onClick={handleDeploy}
          disabled={!canDeploy || deploying || !paymentDone}
          className="w-full mt-2 px-4 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-sm font-semibold text-[#00ff41] font-mono hover:bg-[#00ff41]/15 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {deploying ? "deploying..." : "deploy worker"}
        </button>

        {result && (
          <div className={`p-3 rounded text-xs font-mono ${result.success ? "bg-green-950/30 border border-green-900/40 text-green-400" : "bg-red-950/30 border border-red-900/40 text-red-400"}`}>
            {result.success ? (
              result.cvmId ? (
                <span>
                  Deployed! CVM ID: {result.cvmId}
                  {result.dashboardUrl && (
                    <>
                      {" — "}
                      <a href={result.dashboardUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-green-300">
                        view dashboard
                      </a>
                    </>
                  )}
                </span>
              ) : "Registered locally!"
            ) : `Error: ${result.error}`}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Shared Field Component ──────────────────────────────────────────── */

function Field({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  type = "text",
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] text-zinc-500 font-mono mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full px-3 py-2 rounded bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 font-mono placeholder:text-zinc-700 focus:border-[#00ff41]/30 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
      />
    </div>
  );
}
