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

export interface BaseJobState {
  jobId: string;
  status: ProvisionStatus;
  step: string;
  phalaEndpoint?: string;
  cvmId?: string;
  dashboardUrl?: string;
  displayName?: string;
  nearAccount?: string;
  error?: string;
}

const POLL_INTERVAL = 5000;

/**
 * Generic job status polling hook.
 * Used by both worker and coordinator provision flows.
 */
export function useProvisionJobPoller<T extends BaseJobState>(
  storageKey: string,
  mapResponse: (data: any) => T
) {
  const [job, setJob] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollStatus = useCallback(async (jobId: string): Promise<T | null> => {
    try {
      const res = await fetch(`${API_URL}/api/provision/status/${jobId}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return mapResponse(data);
    } catch {
      return null;
    }
  }, [mapResponse]);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback((jobId: string) => {
    stopPolling();
    pollingRef.current = setInterval(async () => {
      const data = await pollStatus(jobId);
      if (!data) return;
      setJob(data);
      if (
        data.status === "complete" ||
        data.status === "failed" ||
        data.status === "awaiting_near_signature"
      ) {
        stopPolling();
      }
    }, POLL_INTERVAL);
  }, [pollStatus, stopPolling]);

  // Resume from localStorage on mount
  useEffect(() => {
    const savedJobId = localStorage.getItem(storageKey);
    if (savedJobId) {
      pollStatus(savedJobId).then((data) => {
        if (data && data.status !== "failed") {
          setJob(data);
          if (data.status !== "complete" && data.status !== "awaiting_near_signature") {
            startPolling(savedJobId);
          }
        } else {
          localStorage.removeItem(storageKey);
        }
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const reset = useCallback(() => {
    stopPolling();
    setJob(null);
    localStorage.removeItem(storageKey);
  }, [stopPolling, storageKey]);

  return { job, setJob, loading, setLoading, startPolling, stopPolling, pollStatus, reset };
}
