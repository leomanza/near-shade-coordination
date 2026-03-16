"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://protocol-api-production.up.railway.app";

export type ProvisionStatus =
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

export interface ProvisionJobState {
  jobId: string;
  status: ProvisionStatus;
  step: string;
  workerDid?: string;
  storachaPrivateKey?: string;
  phalaEndpoint?: string;
  cvmId?: string;
  dashboardUrl?: string;
  coordinatorDid?: string;
  displayName?: string;
  nearAccount?: string;
  error?: string;
}

const POLL_INTERVAL = 5000;
const STORAGE_KEY = "delibera_provision_job_id";

export function useProvisionJob() {
  const [job, setJob] = useState<ProvisionJobState | null>(null);
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

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  async function pollStatus(jobId: string): Promise<ProvisionJobState | null> {
    try {
      const res = await fetch(`${API_URL}/api/provision/status/${jobId}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      return await res.json();
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
      coordinatorDid: string;
      displayName: string;
      nearAccount: string;
    }) => {
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/provision/worker`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Provision request failed");

        const jobId = data.jobId as string;
        localStorage.setItem(STORAGE_KEY, jobId);

        // Initial state
        setJob({
          jobId,
          status: "generating_identity",
          step: "Generating worker identity",
          coordinatorDid: params.coordinatorDid,
          displayName: params.displayName,
          nearAccount: params.nearAccount,
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

  const completeRegistration = useCallback(
    async (txHash?: string) => {
      if (!job?.jobId) return;
      try {
        const res = await fetch(`${API_URL}/api/provision/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: job.jobId, txHash }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          console.error("Registration API error:", data);
        }
        // Transition to complete regardless — the worker is deployed even if API call fails
        setJob((prev) =>
          prev ? { ...prev, status: "complete", step: "Worker active" } : prev
        );
        localStorage.removeItem(STORAGE_KEY);
      } catch (err: any) {
        console.error("Failed to complete registration:", err);
        // Still transition to complete — user can download recovery file
        setJob((prev) =>
          prev ? { ...prev, status: "complete", step: "Worker active" } : prev
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
