"use client";
import { useState } from "react";
import type { AuthState } from "@/lib/auth";
import type { OnboardingApi } from "../hooks/useOutlayerOnboarding";

interface Props {
  onboard: OnboardingApi;
  auth: AuthState;
}

const SEED_RE = /^[a-zA-Z0-9_-]+$/;

export default function ConfigScreen({ onboard, auth }: Props) {
  const defaultSeed = `delibera-worker-${(auth.accountId ?? "anon").replace(/\./g, "-")}-${new Date().toISOString().slice(0, 7)}`;
  const [seed, setSeed] = useState(onboard.state.seed || defaultSeed);
  const [advanced, setAdvanced] = useState(onboard.state.path === "B_bound");
  const [endpoint, setEndpoint] = useState(onboard.state.endpoint_url || `ensue://${defaultSeed}`);

  const seedValid = SEED_RE.test(seed) && seed.length >= 3;

  function handleContinue() {
    onboard.dispatch({ type: "set_seed", seed });
    onboard.dispatch({ type: "set_endpoint", endpoint_url: endpoint, cvm_id: "outlayer-tdx" });
    onboard.dispatch({ type: "set_path", path: advanced ? "B_bound" : "A_anonymous" });
    onboard.advance("register");
  }

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-3xl font-bold">Name your worker</h1>

      <label className="mt-6 block">
        <span className="text-sm font-medium">Seed (worker identifier)</span>
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-sm"
        />
        {!seedValid && (
          <p className="mt-1 text-xs text-red-600">letters, digits, _ and - only; ≥ 3 chars</p>
        )}
      </label>

      <details className="mt-6 cursor-pointer">
        <summary className="text-sm text-blue-700">Advanced: dispatch mode</summary>
        <label className="mt-2 block">
          <span className="text-xs text-gray-500">
            endpoint_url (ensue:// for polling, https:// for webhook)
          </span>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            className="mt-1 w-full rounded-md border px-3 py-2 font-mono text-xs"
          />
        </label>
      </details>

      <details className="mt-6 cursor-pointer" open={advanced}>
        <summary className="text-sm text-blue-700">Advanced: wallet path</summary>
        <div className="mt-2 space-y-2">
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="path"
              checked={!advanced}
              onChange={() => setAdvanced(false)}
              className="mt-1"
            />
            <span className="text-sm">
              <strong>Anonymous trial</strong> (recommended) — 1 wallet popup, 100-call cap, 30-day expiry
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="path"
              checked={advanced}
              onChange={() => setAdvanced(true)}
              className="mt-1"
            />
            <span className="text-sm">
              <strong>NEAR-bound</strong> — permanent, no caps. Currently blocked on outlayer&rsquo;s api_key-for-bound-wallets fix; the wizard surfaces this and routes you back to anonymous.
            </span>
          </label>
        </div>
      </details>

      <button
        disabled={!seedValid}
        onClick={handleContinue}
        className="mt-8 rounded-md bg-blue-600 px-6 py-3 text-white disabled:opacity-50"
      >
        Continue
      </button>
    </main>
  );
}
