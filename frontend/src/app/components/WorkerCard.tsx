"use client";

import { useCallback, useState } from "react";
import StatusDot from "./StatusDot";
import {
  getWorkerHealth,
  getAgentIdentity,
  feedKnowledge,
  updateAgentManifesto,
  type WorkerHealth,
  type AgentIdentity,
} from "@/lib/api";
import { usePolling } from "@/lib/use-polling";

interface WorkerCardProps {
  workerId: string;
  label: string;
  port: number;
  status: string;
  onLog?: (msg: string, type?: "info" | "success" | "error" | "warning") => void;
}

export default function WorkerCard({ workerId, label, port, status, onLog }: WorkerCardProps) {
  const healthFetcher = useCallback(() => getWorkerHealth(workerId), [workerId]);
  const identityFetcher = useCallback(() => getAgentIdentity(workerId), [workerId]);
  const { data: health, error: healthError } = usePolling<WorkerHealth>(healthFetcher, 5000);
  const { data: identity, refresh: refreshIdentity } = usePolling<AgentIdentity>(identityFetcher, 10000);

  const online = !healthError && health?.healthy;
  const [expanded, setExpanded] = useState(false);
  const [feedTab, setFeedTab] = useState<"knowledge" | "manifesto" | null>(null);

  const agentName = identity?.manifesto?.name;
  const agentRole = identity?.manifesto?.role;
  const hasNova = !!identity;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      {/* Main card */}
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <StatusDot status={online ? status : "offline"} />
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 font-mono">
                {agentName ? `${agentName}` : label}
              </h3>
              <p className="text-[10px] text-zinc-600 font-mono">
                {agentRole || label} &middot; :{port}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasNova && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#00ff41]/10 text-[#00ff41]/60 border border-[#00ff41]/20 font-mono">
                NOVA
              </span>
            )}
            <span className="text-xs font-mono px-2 py-1 rounded-md bg-zinc-800 text-zinc-400">
              {online ? status : "offline"}
            </span>
          </div>
        </div>

        {/* Agent values preview */}
        {identity?.manifesto?.values && (
          <div className="flex flex-wrap gap-1 mb-2">
            {identity.manifesto.values.slice(0, 2).map((v, i) => (
              <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-500 truncate max-w-[140px]">
                {v}
              </span>
            ))}
            {identity.manifesto.values.length > 2 && (
              <span className="text-[9px] text-zinc-600">+{identity.manifesto.values.length - 2}</span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <p className="text-[10px] text-zinc-600">
            {status === "processing"
              ? "Loading identity & deliberating..."
              : status === "completed"
                ? "Vote submitted"
                : "Awaiting proposal"}
          </p>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[10px] text-zinc-600 hover:text-[#00ff41] font-mono transition-colors"
          >
            {expanded ? "[collapse]" : "[identity]"}
          </button>
        </div>
      </div>

      {/* Expanded identity panel */}
      {expanded && (
        <div className="border-t border-zinc-800 p-4 space-y-3 bg-zinc-950/50">
          {!identity ? (
            <p className="text-[10px] text-zinc-600 font-mono">
              Nova identity not available. Agent may not have NOVA_API_KEY configured.
            </p>
          ) : (
            <>
              {/* Manifesto */}
              <IdentitySection title="MANIFESTO" badge="NOVA">
                <p className="text-[10px] text-zinc-400 leading-relaxed">
                  {identity.manifesto.guidelines}
                </p>
                <div className="mt-2 space-y-1">
                  {identity.manifesto.values.map((v, i) => (
                    <div key={i} className="text-[10px] text-zinc-500 flex gap-1.5">
                      <span className="text-[#00ff41]/40 shrink-0">&gt;</span>
                      {v}
                    </div>
                  ))}
                </div>
              </IdentitySection>

              {/* Voting Weights */}
              <IdentitySection title="VOTING WEIGHTS">
                <div className="space-y-1.5">
                  {Object.entries(identity.preferences.votingWeights).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-500 font-mono w-32 truncate">
                        {k.replace(/_/g, " ")}
                      </span>
                      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#00ff41]/40 rounded-full"
                          style={{ width: `${(v as number) * 100}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-zinc-600 font-mono w-8 text-right">
                        {((v as number) * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </IdentitySection>

              {/* Knowledge Notes */}
              {identity.preferences.knowledgeNotes.length > 0 && (
                <IdentitySection title="ACCUMULATED KNOWLEDGE">
                  {identity.preferences.knowledgeNotes.map((note, i) => (
                    <div key={i} className="text-[10px] text-zinc-500 flex gap-1.5">
                      <span className="text-[#00ff41]/40 shrink-0">&gt;</span>
                      {note}
                    </div>
                  ))}
                </IdentitySection>
              )}

              {/* Decision History */}
              {identity.recentDecisions.length > 0 && (
                <IdentitySection title="RECENT DECISIONS">
                  {identity.recentDecisions.map((d, i) => (
                    <div key={i} className="text-[10px] flex items-start gap-2 mb-1">
                      <span className={`shrink-0 font-bold ${d.vote === "Approved" ? "text-green-400" : "text-red-400"}`}>
                        {d.vote === "Approved" ? "Y" : "N"}
                      </span>
                      <span className="text-zinc-500 truncate">{d.proposal.slice(0, 60)}...</span>
                    </div>
                  ))}
                </IdentitySection>
              )}

              {/* Action buttons */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setFeedTab(feedTab === "knowledge" ? null : "knowledge")}
                  className={`text-[10px] px-2.5 py-1.5 rounded font-mono transition-all ${
                    feedTab === "knowledge"
                      ? "bg-[#00ff41]/15 text-[#00ff41] border border-[#00ff41]/30"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
                  }`}
                >
                  feed knowledge
                </button>
                <button
                  onClick={() => setFeedTab(feedTab === "manifesto" ? null : "manifesto")}
                  className={`text-[10px] px-2.5 py-1.5 rounded font-mono transition-all ${
                    feedTab === "manifesto"
                      ? "bg-[#00ff41]/15 text-[#00ff41] border border-[#00ff41]/30"
                      : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
                  }`}
                >
                  edit manifesto
                </button>
              </div>

              {/* Feed Knowledge form */}
              {feedTab === "knowledge" && (
                <FeedKnowledgeForm
                  workerId={workerId}
                  onDone={(msg) => {
                    onLog?.(msg, "success");
                    refreshIdentity();
                    setFeedTab(null);
                  }}
                  onError={(msg) => onLog?.(msg, "error")}
                />
              )}

              {/* Edit Manifesto form */}
              {feedTab === "manifesto" && (
                <EditManifestoForm
                  workerId={workerId}
                  current={identity.manifesto}
                  onDone={(msg) => {
                    onLog?.(msg, "success");
                    refreshIdentity();
                    setFeedTab(null);
                  }}
                  onError={(msg) => onLog?.(msg, "error")}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────────────────────────── */

function IdentitySection({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[9px] font-bold text-zinc-600 font-mono tracking-wider">
          // {title}
        </span>
        {badge && (
          <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-[#00ff41]/10 text-[#00ff41]/50 border border-[#00ff41]/15 font-mono">
            {badge}
          </span>
        )}
      </div>
      <div className="pl-1">{children}</div>
    </div>
  );
}

function FeedKnowledgeForm({
  workerId,
  onDone,
  onError,
}: {
  workerId: string;
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!notes.trim() || submitting) return;
    setSubmitting(true);
    try {
      const noteList = notes.split("\n").map((n) => n.trim()).filter(Boolean);
      const result = await feedKnowledge(workerId, noteList);
      if (result) {
        onDone(`[nova] Knowledge fed to ${workerId}: ${noteList.length} notes`);
      } else {
        onError(`[nova] Failed to feed knowledge to ${workerId}`);
      }
    } catch {
      onError(`[nova] Error feeding knowledge to ${workerId}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 p-3 rounded bg-zinc-900/80 border border-zinc-800">
      <p className="text-[9px] text-zinc-600 font-mono">
        // Feed knowledge notes (one per line). These shape how the agent reasons.
      </p>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="e.g. Prioritize proposals that increase developer tooling..."
        className="w-full text-[10px] bg-zinc-800/60 border border-zinc-700/50 rounded p-2 text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#00ff41]/30 resize-none font-mono"
        rows={3}
      />
      <button
        onClick={handleSubmit}
        disabled={!notes.trim() || submitting}
        className="text-[10px] px-3 py-1.5 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-[#00ff41] font-mono hover:bg-[#00ff41]/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {submitting ? "feeding..." : "feed knowledge"}
      </button>
    </div>
  );
}

function EditManifestoForm({
  workerId,
  current,
  onDone,
  onError,
}: {
  workerId: string;
  current: { name: string; role: string; guidelines: string; values: string[] };
  onDone: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(current.name);
  const [role, setRole] = useState(current.role);
  const [guidelines, setGuidelines] = useState(current.guidelines);
  const [values, setValues] = useState(current.values.join("\n"));
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const valList = values.split("\n").map((v) => v.trim()).filter(Boolean);
      const result = await updateAgentManifesto(workerId, {
        name: name.trim(),
        role: role.trim(),
        guidelines: guidelines.trim(),
        values: valList,
      });
      if (result) {
        onDone(`[nova] Manifesto updated for ${workerId}`);
      } else {
        onError(`[nova] Failed to update manifesto for ${workerId}`);
      }
    } catch {
      onError(`[nova] Error updating manifesto for ${workerId}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-2 p-3 rounded bg-zinc-900/80 border border-zinc-800">
      <p className="text-[9px] text-zinc-600 font-mono">
        // Edit this agent&apos;s identity. Changes persist in Nova encrypted storage.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Agent name"
          className="text-[10px] bg-zinc-800/60 border border-zinc-700/50 rounded p-1.5 text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#00ff41]/30 font-mono"
        />
        <input
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Role"
          className="text-[10px] bg-zinc-800/60 border border-zinc-700/50 rounded p-1.5 text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#00ff41]/30 font-mono"
        />
      </div>
      <textarea
        value={guidelines}
        onChange={(e) => setGuidelines(e.target.value)}
        placeholder="Voting guidelines..."
        className="w-full text-[10px] bg-zinc-800/60 border border-zinc-700/50 rounded p-2 text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#00ff41]/30 resize-none font-mono"
        rows={2}
      />
      <textarea
        value={values}
        onChange={(e) => setValues(e.target.value)}
        placeholder="Core values (one per line)"
        className="w-full text-[10px] bg-zinc-800/60 border border-zinc-700/50 rounded p-2 text-zinc-300 placeholder-zinc-700 focus:outline-none focus:border-[#00ff41]/30 resize-none font-mono"
        rows={3}
      />
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="text-[10px] px-3 py-1.5 rounded bg-[#00ff41]/10 border border-[#00ff41]/30 text-[#00ff41] font-mono hover:bg-[#00ff41]/15 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
      >
        {submitting ? "saving..." : "save manifesto"}
      </button>
    </div>
  );
}
