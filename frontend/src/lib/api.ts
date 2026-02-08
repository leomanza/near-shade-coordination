const COORDINATOR_URL = process.env.NEXT_PUBLIC_COORDINATOR_URL || "http://localhost:3000";
const WORKER_URLS: Record<string, string> = {
  worker1: process.env.NEXT_PUBLIC_WORKER1_URL || "http://localhost:3001",
  worker2: process.env.NEXT_PUBLIC_WORKER2_URL || "http://localhost:3002",
  worker3: process.env.NEXT_PUBLIC_WORKER3_URL || "http://localhost:3003",
};

export interface WorkerStatuses {
  workers: {
    worker1: string;
    worker2: string;
    worker3: string;
  };
  timestamp: string;
}

export interface CoordinatorStatus {
  status: string;
  proposalId: number | null;
  tally: {
    aggregatedValue: number;
    workerCount: number;
    workers: Array<{
      workerId: string;
      taskType: string;
      output: { value: number; data?: unknown; computedAt: string };
      processingTime?: number;
    }>;
    timestamp: string;
    proposalId?: number;
  } | null;
  timestamp: string;
}

export interface PendingCoordinations {
  count: number;
  requests: Array<[number, { task_config: string; config_hash: string; timestamp: number }]>;
  timestamp: string;
}

export interface WorkerHealth {
  healthy: boolean;
  worker: string;
  timestamp: string;
}

export interface TaskExecuteResponse {
  message: string;
  worker: string;
  taskType: string;
}

async function safeFetch<T>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getCoordinatorStatus(): Promise<CoordinatorStatus | null> {
  return safeFetch<CoordinatorStatus>(`${COORDINATOR_URL}/api/coordinate/status`);
}

export async function getWorkerStatuses(): Promise<WorkerStatuses | null> {
  return safeFetch<WorkerStatuses>(`${COORDINATOR_URL}/api/coordinate/workers`);
}

export async function getPendingCoordinations(): Promise<PendingCoordinations | null> {
  return safeFetch<PendingCoordinations>(`${COORDINATOR_URL}/api/coordinate/pending`);
}

export async function getCoordinatorHealth(): Promise<{ status: string } | null> {
  return safeFetch(`${COORDINATOR_URL}/`);
}

export async function getWorkerHealth(workerId: string): Promise<WorkerHealth | null> {
  const url = WORKER_URLS[workerId];
  if (!url) return null;
  return safeFetch<WorkerHealth>(`${url}/api/task/health`);
}

export async function triggerWorkerTask(
  workerId: string,
  taskType: string = "random",
  parameters?: Record<string, unknown>
): Promise<TaskExecuteResponse | null> {
  const url = WORKER_URLS[workerId];
  if (!url) return null;
  return safeFetch<TaskExecuteResponse>(`${url}/api/task/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskConfig: { type: taskType, parameters, timeout: 3000 },
    }),
  });
}

export async function resetMemory(): Promise<{ message: string } | null> {
  return safeFetch(`${COORDINATOR_URL}/api/coordinate/reset`, { method: "POST" });
}

export async function triggerCoordination(
  taskType: string = "random"
): Promise<{ message: string } | null> {
  return safeFetch(`${COORDINATOR_URL}/api/coordinate/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskConfig: { type: taskType, timeout: 3000 },
    }),
  });
}

// ── On-chain reads (directly from NEAR RPC) ──

const NEAR_RPC = "https://test.rpc.fastnear.com";
const CONTRACT_ID = process.env.NEXT_PUBLIC_contractId || "ac-proxy.agents-coordinator.testnet";

async function nearViewCall<T>(method: string, args: Record<string, unknown> = {}): Promise<T | null> {
  try {
    const res = await fetch(NEAR_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: CONTRACT_ID,
          method_name: method,
          args_base64: btoa(JSON.stringify(args)),
        },
      }),
    });
    const data = await res.json();
    if (data.error || !data.result?.result) return null;
    const bytes = new Uint8Array(data.result.result);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export type ProposalState = "Created" | "WorkersCompleted" | "Finalized" | "TimedOut";

export interface WorkerSubmission {
  worker_id: string;
  result_hash: string;
  timestamp: number;
}

export interface OnChainProposal {
  task_config: string;
  config_hash: string;
  timestamp: number;
  requester: string;
  state: ProposalState;
  worker_submissions: WorkerSubmission[];
  finalized_result?: string;
}

export interface OnChainState {
  owner: string;
  currentProposalId: number;
  proposals: Array<{ proposalId: number; proposal: OnChainProposal }>;
}

export async function getOnChainState(): Promise<OnChainState | null> {
  try {
    const [owner, proposalId, allProposals] = await Promise.all([
      nearViewCall<string>("get_owner"),
      nearViewCall<number>("get_current_proposal_id"),
      nearViewCall<Array<[number, OnChainProposal]>>("get_all_proposals"),
    ]);
    if (owner === null || proposalId === null) return null;
    return {
      owner,
      currentProposalId: proposalId,
      proposals: (allProposals ?? []).map(([id, proposal]) => ({
        proposalId: id,
        proposal,
      })),
    };
  } catch {
    return null;
  }
}
