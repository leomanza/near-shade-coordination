"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  workerDidFromNearAccount,
  ed25519PubkeyFromNearAccount,
} from "@/app/onboard/ironclaw/lib/worker-did-derivation";

interface WorkerRecord {
  account_id: string;
  worker_did: string;
  endpoint_url: string;
  cvm_id: string;
  registered_at: number;
  is_active: boolean;
  controller_pubkey?: number[] | null;
}

const REGISTRY_CONTRACT =
  process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID ||
  "registry.agents-coordinator.testnet";
const RPC = "https://test.rpc.fastnear.com";

async function fetchWorkerByDid(did: string): Promise<WorkerRecord | null> {
  const args = btoa(JSON.stringify({ worker_did: did }));
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "query",
      params: {
        request_type: "call_function",
        finality: "final",
        account_id: REGISTRY_CONTRACT,
        method_name: "get_worker_by_did",
        args_base64: args,
      },
    }),
  });
  const json = await res.json();
  const bytes: number[] | undefined = json.result?.result;
  if (!bytes) return null;
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  if (text === "null") return null;
  return JSON.parse(text);
}

function provenanceFromCvmId(cvmId: string): {
  label: string;
  detail: string;
} {
  if (cvmId === "outlayer-tdx") {
    return {
      label: "Outlayer TEE (autonomous)",
      detail: "Registered via wizard or autonomous /wallet/v1/call",
    };
  }
  if (cvmId === "external-webhook") {
    return {
      label: "External push (manual)",
      detail: "Registered via /buy/external-worker frontend flow",
    };
  }
  if (cvmId === "external-polling") {
    return {
      label: "External polling",
      detail: "Polls Ensue; coord-agent dispatches via /poll/task proxy",
    };
  }
  if (cvmId.startsWith("ironclaw-")) {
    return { label: "IronClaw (managed)", detail: cvmId };
  }
  if (cvmId.startsWith("phala-")) {
    return { label: "Phala CVM", detail: cvmId };
  }
  return { label: cvmId, detail: "Unknown provenance" };
}

function ControllerPubkeyB58(bytes: number[]): string {
  // bs58 of 32 bytes; uses same hand-rolled encoder as worker-did-derivation
  const ALPH =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const ZERO = BigInt(0);
  const EIGHT = BigInt(8);
  const N58 = BigInt(58);
  let num = ZERO;
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  for (const b of bytes) num = (num << EIGHT) + BigInt(b);
  let out = "";
  while (num > ZERO) {
    out = ALPH[Number(num % N58)] + out;
    num /= N58;
  }
  return "1".repeat(zeros) + out;
}

export default function WorkerDetailPage() {
  const params = useParams();
  const did = decodeURIComponent(String(params.did ?? ""));

  const [worker, setWorker] = useState<WorkerRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!did) return;
    setLoading(true);
    fetchWorkerByDid(did)
      .then((w) => {
        setWorker(w);
        setError(w ? null : "Worker not found on-chain");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [did]);

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-center text-gray-500">
        Loading worker {did.slice(0, 24)}…
      </main>
    );
  }

  if (error || !worker) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <Link href="/dashboard" className="text-sm text-blue-600">
          ← Back to dashboard
        </Link>
        <h1 className="mt-4 text-2xl font-bold">Worker not found</h1>
        <p className="mt-2 text-gray-600">{error}</p>
        <p className="mt-2 break-all font-mono text-xs text-gray-500">
          {did}
        </p>
      </main>
    );
  }

  const provenance = provenanceFromCvmId(worker.cvm_id);
  const isOutlayer = worker.cvm_id === "outlayer-tdx";
  const ed25519Pub = isOutlayer
    ? ed25519PubkeyFromNearAccount(worker.account_id)
    : null;
  const derivedDid = isOutlayer
    ? workerDidFromNearAccount(worker.account_id)
    : null;
  const oneKeyConsistent = isOutlayer && derivedDid === worker.worker_did;
  const hasController =
    worker.controller_pubkey != null && worker.controller_pubkey.length === 32;
  const controllerB58 = hasController
    ? `ed25519:${ControllerPubkeyB58(worker.controller_pubkey as number[])}`
    : null;

  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/dashboard" className="text-sm text-blue-600">
        ← Back to dashboard
      </Link>

      <header className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Worker detail</h1>
          <p className="mt-1 text-sm text-gray-600">{provenance.label}</p>
        </div>
        <span
          className={
            "rounded-full px-3 py-1 text-xs font-semibold " +
            (worker.is_active
              ? "bg-green-100 text-green-800"
              : "bg-gray-200 text-gray-600")
          }
        >
          {worker.is_active ? "ACTIVE" : "INACTIVE"}
        </span>
      </header>

      <section className="mt-6 rounded-lg border bg-gray-50 p-4">
        <h2 className="text-sm font-semibold text-gray-900">Identity</h2>
        <dl className="mt-3 space-y-2 text-xs">
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <dt className="text-gray-600">Worker DID</dt>
            <dd className="break-all font-mono">{worker.worker_did}</dd>
          </div>
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <dt className="text-gray-600">NEAR account</dt>
            <dd className="break-all font-mono">
              <a
                href={`https://explorer.testnet.near.org/accounts/${worker.account_id}`}
                target="_blank"
                rel="noreferrer"
                className="text-blue-700 underline"
              >
                {worker.account_id}
              </a>
            </dd>
          </div>
          {ed25519Pub && (
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <dt className="text-gray-600">ed25519 pubkey</dt>
              <dd className="break-all font-mono">{ed25519Pub}</dd>
            </div>
          )}
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <dt className="text-gray-600">Endpoint</dt>
            <dd className="break-all font-mono">{worker.endpoint_url}</dd>
          </div>
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <dt className="text-gray-600">cvm_id</dt>
            <dd className="font-mono">{worker.cvm_id}</dd>
          </div>
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <dt className="text-gray-600">Registered at</dt>
            <dd>{new Date(worker.registered_at / 1e6).toISOString()}</dd>
          </div>
          <div className="grid grid-cols-[140px_1fr] gap-2">
            <dt className="text-gray-600">Controller pubkey</dt>
            <dd className="break-all font-mono">
              {hasController ? (
                controllerB58
              ) : (
                <span className="text-gray-500">
                  (none — registered without V3.1.1 controller_pubkey)
                </span>
              )}
            </dd>
          </div>
        </dl>

        {isOutlayer && (
          <div
            className={
              "mt-4 rounded p-3 text-xs " +
              (oneKeyConsistent
                ? "bg-green-50 text-green-900"
                : "bg-yellow-50 text-yellow-900")
            }
          >
            <strong>One-key-three-views check:</strong>{" "}
            {oneKeyConsistent
              ? `passes — worker_did, NEAR account, and ed25519 pubkey all derive from the same outlayer TEE key.`
              : `mismatch — worker_did stored on-chain (${worker.worker_did.slice(
                  0,
                  24,
                )}…) doesn't match what would derive from the account_id. Skill v0.4 §1 expects identity per the one-key model.`}
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Actions</h2>

        <div className="mt-3 space-y-3 text-sm">
          <ActionButton
            label="Freeze (outlayer)"
            description="Tell outlayer's TEE to refuse any further /wallet/v1/call from this wallet — protocol-level kill switch. Requires the worker's OUTLAYER_API_KEY (operator must paste in)."
            disabled={!isOutlayer}
            disabledReason={
              !isOutlayer ? "Worker isn't outlayer-managed" : undefined
            }
            onClick={() => {
              alert(
                "Freeze flow: prompt for OUTLAYER_API_KEY, POST <host>/wallet/v1/freeze. Not implemented in this pass — manual via curl for now.",
              );
            }}
          />

          <ActionButton
            label="Deactivate by controller signature (V3.1.1)"
            description="Sovereign deactivation — anyone with the controller private key can deactivate this worker without admin or registrant auth."
            disabled={!hasController}
            disabledReason={
              !hasController
                ? "Worker has no controller_pubkey. Registered before V3.1.1, or the wizard didn't set one. Use admin or registrant predecessor auth instead."
                : undefined
            }
            onClick={() => {
              alert(
                "V3.1.1 deactivate flow: sign canonical msg with controller key, submit to registry. Not implemented in this pass.",
              );
            }}
          />

          <ActionButton
            label="Deactivate (legacy — predecessor auth)"
            description="Standard deactivation. Requires the signing NEAR account to be either the original registrant or the contract admin."
            disabled={false}
            onClick={() => {
              window.location.href = `https://explorer.testnet.near.org/accounts/${REGISTRY_CONTRACT}`;
            }}
          />
        </div>
      </section>

      <section className="mt-6 text-center text-xs text-gray-500">
        Worker record fetched directly from{" "}
        <code>{REGISTRY_CONTRACT}</code> via NEAR RPC.
      </section>
    </main>
  );
}

interface ActionButtonProps {
  label: string;
  description: string;
  disabled: boolean;
  disabledReason?: string;
  onClick: () => void;
}

function ActionButton({
  label,
  description,
  disabled,
  disabledReason,
  onClick,
}: ActionButtonProps) {
  return (
    <div className="rounded border p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{label}</span>
        <button
          onClick={onClick}
          disabled={disabled}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-40"
          title={disabledReason}
        >
          {disabled ? "Unavailable" : "Run"}
        </button>
      </div>
      <p className="mt-1 text-xs text-gray-600">{description}</p>
      {disabled && disabledReason && (
        <p className="mt-1 text-xs italic text-gray-500">{disabledReason}</p>
      )}
    </div>
  );
}
