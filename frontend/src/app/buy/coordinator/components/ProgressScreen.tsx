"use client";

import type { CoordinatorProvisionStatus } from "../hooks/useCoordinatorProvision";

interface ProgressScreenProps {
  status: CoordinatorProvisionStatus;
  step: string;
  displayName?: string;
}

const STEPS: Array<{ key: CoordinatorProvisionStatus; label: string }> = [
  { key: "generating_identity", label: "Generating coordinator identity" },
  { key: "creating_space", label: "Creating Storacha space" },
  { key: "provisioning_ensue", label: "Provisioning coordination memory" },
  { key: "preparing_phala", label: "Preparing Phala deployment" },
  { key: "deploying_phala", label: "Deploying to Phala TEE" },
  { key: "waiting_for_url", label: "Waiting for public URL" },
  { key: "awaiting_near_signature", label: "Ready for on-chain registration" },
];

function getStepState(
  stepKey: CoordinatorProvisionStatus,
  currentStatus: CoordinatorProvisionStatus
): "done" | "active" | "pending" {
  const stepIndex = STEPS.findIndex((s) => s.key === stepKey);
  const currentIndex = STEPS.findIndex((s) => s.key === currentStatus);
  if (currentIndex < 0) return "pending";
  if (stepIndex < currentIndex) return "done";
  if (stepIndex === currentIndex) return "active";
  return "pending";
}

export default function ProgressScreen({
  status,
  step,
  displayName,
}: ProgressScreenProps) {
  return (
    <div className="rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 terminal-card">
      <h3 className="text-sm font-semibold text-zinc-100 mb-1 font-mono">
        Deploying {displayName ? `"${displayName}"` : "your coordinator"}...
      </h3>
      <p className="text-[10px] text-zinc-600 mb-6 font-mono">
        This may take 3-10 minutes. You can close this tab and return later.
      </p>

      <div className="space-y-3">
        {STEPS.map((s) => {
          const state = getStepState(s.key, status);
          return (
            <div key={s.key} className="flex items-center gap-3">
              <span className="text-sm w-5 text-center">
                {state === "done" && (
                  <span className="text-[#00ff41]">&#10003;</span>
                )}
                {state === "active" && (
                  <span className="text-yellow-500 animate-pulse">&#9679;</span>
                )}
                {state === "pending" && (
                  <span className="text-zinc-700">&#9675;</span>
                )}
              </span>
              <span
                className={`text-xs font-mono ${
                  state === "done"
                    ? "text-zinc-400"
                    : state === "active"
                    ? "text-zinc-200"
                    : "text-zinc-600"
                }`}
              >
                {s.label}
                {state === "active" && s.key === "waiting_for_url" && (
                  <span className="text-[10px] text-zinc-500 ml-2">
                    (this takes 3-10 minutes)
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="text-[10px] text-zinc-600 font-mono mt-5">
        Current: {step}
      </p>
    </div>
  );
}
