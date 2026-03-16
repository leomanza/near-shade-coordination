"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://protocol-api-production.up.railway.app";

export type CoordinatorProvisionStatus =
  | "generating_identity"
  | "creating_space"
  | "provisioning_ensue"
  | "preparing_phala"
  | "deploying_phala"
  | "waiting_for_url"
  | "awaiting_near_signature"
  | "registering"
  | "complete"
  | "failed";

export interface CoordinatorJobState {
  jobId: string;
  status: CoordinatorProvisionStatus;
  step: string;
  coordinatorDid?: string;  // the generated DID (stored in workerDid field on server)
  storachaPrivateKey?: string;
  phalaEndpoint?: string;
  cvmId?: string;
  dashboardUrl?: string;
  displayName?: string;
  nearAccount?: string;
  minWorkers?: number;
  maxWorkers?: number;
  ensueOrgName?: string;
  ensueClaimUrl?: string;
  ensueVerificationCode?: string;
  contractAddress?: string;  // set after tx #1 (factory deploy)
  error?: string;
}

const POLL_INTERVAL = 5000;
const STORAGE_KEY = "delibera_coordinator_provision_job_id";

export function useCoordinatorProvision() {
  const [job, setJob] = useState<CoordinatorJobState | null>(null);
  const [loading, setLoading] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resume from localStorage on mount
  useEffect(() => {
    const savedJobId = localStorage.getItem(STORAGE_KEY);
    if (savedJobId) {
      pollStatus(savedJobId).then((data) => {
        if (data && data.status !== "failed") {
          setJob(data);
          if (data.status !== "complete" && data.status !== "awaiting_near_signature") {
            startPolling(savedJobId);
          }
        } else {
          localStorage.removeItem(STORAGE_KEY);
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  async function pollStatus(jobId: string): Promise<CoordinatorJobState | null> {
    try {
      const res = await fetch(`${API_URL}/api/provision/status/${jobId}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      // Map server field: workerDid → coordinatorDid
      return {
        ...data,
        coordinatorDid: data.workerDid || data.coordinatorDid,
      };
    } catch {
      return null;
    }
  }

  function startPolling(jobId: string) {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      const data = await pollStatus(jobId);
      if (!data) return;
      setJob(data);
      if (
        data.status === "complete" ||
        data.status === "failed" ||
        data.status === "awaiting_near_signature"
      ) {
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }, POLL_INTERVAL);
  }

  const startProvision = useCallback(
    async (params: {
      displayName: string;
      nearAccount: string;
      minWorkers: number;
      maxWorkers: number;
      contractAddress?: string;
    }) => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/provision/coordinator`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Provision request failed");

        const jobId = data.jobId as string;
        localStorage.setItem(STORAGE_KEY, jobId);

        setJob({
          jobId,
          status: "generating_identity",
          step: "Generating coordinator identity",
          displayName: params.displayName,
          nearAccount: params.nearAccount,
          minWorkers: params.minWorkers,
          maxWorkers: params.maxWorkers,
        });

        startPolling(jobId);
        return jobId;
      } catch (err: any) {
        setJob({
          jobId: "",
          status: "failed",
          step: "Failed to start",
          error: err?.message || "Unknown error",
        });
        return null;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /** Call after both wallet txs are signed */
  const completeRegistration = useCallback(
    async (contractAddress?: string, txHash?: string) => {
      if (!job?.jobId) return;
      try {
        const res = await fetch(`${API_URL}/api/provision/coordinator-register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.jobId, contractAddress, txHash }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("Coordinator registration API error:", data);
        }
        setJob((prev) =>
          prev ? { ...prev, status: "complete", step: "Coordinator active", contractAddress } : prev
        );
        localStorage.removeItem(STORAGE_KEY);
      } catch (err: any) {
        console.error("Failed to complete coordinator registration:", err);
        setJob((prev) =>
          prev ? { ...prev, status: "complete", step: "Coordinator active", contractAddress } : prev
        );
        localStorage.removeItem(STORAGE_KEY);
      }
    },
    [job?.jobId]
  );

  const reset = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = null;
    setJob(null);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { job, loading, startProvision, completeRegistration, reset };
}
