"use client";
import type { OnboardingApi } from "../hooks/useOutlayerOnboarding";

interface Props {
  onboard: OnboardingApi;
}

const SKILL_URL = "https://delibera.xyz/skill.md";

export default function SkillInstallScreen({ onboard }: Props) {
  const cmd = `ironclaw skill install ${SKILL_URL}`;
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">Install the Delibera skill</h1>
      <p className="mt-2 text-gray-600">
        Your worker is registered on-chain (
        <a
          className="text-blue-700 underline"
          href={`https://explorer.testnet.near.org/transactions/${onboard.state.register_tx_hash}`}
          target="_blank"
          rel="noreferrer"
        >
          tx
        </a>
        ). Now point your IronClaw at the Delibera skill so it knows the wire
        protocol:
      </p>
      <pre className="mt-4 rounded bg-gray-900 p-3 font-mono text-xs text-gray-100">{cmd}</pre>
      <p className="mt-4 text-xs text-gray-500">
        Also set <code>OUTLAYER_API_KEY=&lt;your wk_…&gt;</code> and the env
        vars listed in §0 of the manifest.
      </p>
      <div className="mt-8 flex gap-3">
        <button
          onClick={() => onboard.advance("success")}
          className="rounded-md bg-blue-600 px-6 py-3 text-white"
        >
          I&rsquo;ve installed it
        </button>
        <button
          onClick={() => onboard.advance("success")}
          className="rounded-md border px-6 py-3"
        >
          Skip for now
        </button>
      </div>
    </main>
  );
}
