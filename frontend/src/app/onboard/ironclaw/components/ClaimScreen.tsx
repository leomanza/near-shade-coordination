"use client";
import type { OnboardingApi } from "../hooks/useOutlayerOnboarding";

interface Props {
  onboard: OnboardingApi;
}

/**
 * Path B (NEAR-bound wallet) is documented but currently blocked on
 * outlayer's Q7 — `/register` with NEAR-binding doesn't return an api_key
 * on the running alpha API. The wizard surfaces this and routes the user
 * back to Path A. Wire in Path B when outlayer ships the fix.
 */
export default function ClaimScreen({ onboard }: Props) {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">NEAR-bound wallet (Path B)</h1>
      <p className="mt-2 text-gray-600">
        Path B is documented but currently blocked on{" "}
        <a
          className="text-blue-700 underline"
          href="https://github.com/leomanza/near-shade-coordination/blob/main/doc/plans/skill-testing/09-outlayer-e2e-attempt.md"
          target="_blank"
          rel="noreferrer"
        >
          outlayer Q7
        </a>
        : <code>POST /register</code> with NEAR binding doesn&rsquo;t return
        an api_key on the current alpha API.
      </p>
      <p className="mt-4 text-sm text-gray-600">
        Switch back to Path A (anonymous trial) to complete onboarding now.
        We&rsquo;ll wire Path B in once outlayer ships the fix.
      </p>
      <button
        onClick={() => {
          onboard.dispatch({ type: "set_path", path: "A_anonymous" });
          onboard.advance("register");
        }}
        className="mt-8 rounded-md bg-blue-600 px-6 py-3 text-white"
      >
        Use Path A instead
      </button>
    </main>
  );
}
