const COORDINATOR_URL = process.env.NEXT_PUBLIC_COORDINATOR_URL || "http://localhost:3000";

/** Dynamic worker URLs - supports any number of workers */
function getWorkerUrl(workerId: string): string {
  // Check for env override: NEXT_PUBLIC_WORKER1_URL, etc.
  const envKey = `NEXT_PUBLIC_${workerId.toUpperCase()}_URL`;
  if (typeof window === "undefined") {
    return process.env[envKey] || `http://localhost:${3000 + parseInt(workerId.replace("worker", "")) || 1}`;
  }
  // Client-side: default port mapping
  const num = parseInt(workerId.replace("worker", ""));
  return `http://localhost:${3000 + (num || 1)}`;
}

export interface WorkerStatuses {
  workers: Record<string, string>;
  timestamp: string;
}

export interface CoordinatorStatus {
  status: string;
  proposalId: number | null;
  tally: {
    aggregatedValue: number;
    approved: number;
    rejected: number;
    decision: string;
    workerCount: number;
    workers: Array<{
      workerId: string;
      taskType: string;
      output: { value: number; vote?: string; reasoning?: string; data?: unknown; computedAt: string };
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
  return safeFetch<WorkerHealth>(`${getWorkerUrl(workerId)}/api/task/health`);
}

export async function triggerWorkerTask(
  workerId: string,
  taskType: string = "random",
  parameters?: Record<string, unknown>
): Promise<TaskExecuteResponse | null> {
  return safeFetch<TaskExecuteResponse>(`${getWorkerUrl(workerId)}/api/task/execute`, {
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

export async function triggerVote(
  proposal: string
): Promise<{ message: string } | null> {
  return safeFetch(`${COORDINATOR_URL}/api/coordinate/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskConfig: { type: "vote", parameters: { proposal }, timeout: 30000 },
    }),
  });
}

// ── Proposal History ──

export interface ProposalSummary {
  proposalId: string;
  status: string;
  decision: string | null;
  approved: number | null;
  rejected: number | null;
  workerCount: number | null;
  timestamp: string | null;
}

export interface ProposalDetail {
  proposalId: string;
  status: string;
  config: unknown;
  tally: CoordinatorStatus["tally"];
  workers: Record<string, { result: unknown; timestamp: string }>;
}

export async function getProposalHistory(): Promise<{ proposals: ProposalSummary[]; total: number } | null> {
  return safeFetch(`${COORDINATOR_URL}/api/coordinate/proposals`);
}

export async function getProposalDetail(proposalId: string): Promise<ProposalDetail | null> {
  return safeFetch(`${COORDINATOR_URL}/api/coordinate/proposals/${proposalId}`);
}

// ── Worker Registration (on-chain) ──

export interface RegisteredWorker {
  worker_id: string;
  account_id: string | null;
  registered_at: number;
  registered_by: string;
  active: boolean;
}

export async function getRegisteredWorkers(): Promise<{ workers: RegisteredWorker[]; activeCount: number } | null> {
  return safeFetch(`${COORDINATOR_URL}/api/coordinate/workers/registered`);
}

export async function registerWorker(
  workerId: string,
  accountId?: string
): Promise<{ message: string } | null> {
  return safeFetch(`${COORDINATOR_URL}/api/coordinate/workers/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerId, accountId }),
  });
}

export async function removeWorker(workerId: string): Promise<{ message: string } | null> {
  return safeFetch(`${COORDINATOR_URL}/api/coordinate/workers/${workerId}`, {
    method: "DELETE",
  });
}

// ── On-chain reads (directly from NEAR RPC) ──

const NEAR_NETWORK = process.env.NEXT_PUBLIC_NEAR_NETWORK || "testnet";
const NEAR_RPC = NEAR_NETWORK === "mainnet"
  ? "https://rpc.fastnear.com"
  : "https://test.rpc.fastnear.com";
const CONTRACT_ID = process.env.NEXT_PUBLIC_contractId
  || (NEAR_NETWORK === "mainnet" ? "coordinator.delibera.near" : "ac-proxy.agents-coordinator.testnet");

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

export interface Manifesto {
  text: string;
  hash: string;
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
  manifesto: Manifesto | null;
  registeredWorkers: RegisteredWorker[];
}

export async function getOnChainState(): Promise<OnChainState | null> {
  try {
    const [owner, proposalId, allProposals, manifesto, workers] = await Promise.all([
      nearViewCall<string>("get_owner"),
      nearViewCall<number>("get_current_proposal_id"),
      nearViewCall<Array<[number, OnChainProposal]>>("get_all_proposals"),
      nearViewCall<Manifesto>("get_manifesto"),
      nearViewCall<RegisteredWorker[]>("get_registered_workers"),
    ]);
    if (owner === null || proposalId === null) return null;
    return {
      owner,
      currentProposalId: proposalId,
      proposals: (allProposals ?? []).map(([id, proposal]) => ({
        proposalId: id,
        proposal,
      })),
      manifesto: manifesto ?? null,
      registeredWorkers: workers ?? [],
    };
  } catch {
    return null;
  }
}

// ── Nova / Agent Identity API ──

export interface AgentManifesto {
  agentId: string;
  name: string;
  role: string;
  values: string[];
  guidelines: string;
}

export interface AgentPreferences {
  agentId: string;
  votingWeights: Record<string, number>;
  knowledgeNotes: string[];
  updatedAt: string;
}

export interface DecisionRecord {
  proposalId: string;
  proposal: string;
  vote: "Approved" | "Rejected";
  reasoning: string;
  timestamp: string;
}

export interface AgentIdentity {
  manifesto: AgentManifesto;
  preferences: AgentPreferences;
  recentDecisions: DecisionRecord[];
  formatted: string;
}

export async function getAgentIdentity(workerId: string): Promise<AgentIdentity | null> {
  return safeFetch<AgentIdentity>(`${getWorkerUrl(workerId)}/api/knowledge/identity`);
}

export async function feedKnowledge(
  workerId: string,
  notes?: string[],
  votingWeights?: Record<string, number>,
): Promise<{ message: string; preferences: AgentPreferences } | null> {
  return safeFetch(`${getWorkerUrl(workerId)}/api/knowledge/feed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes, votingWeights }),
  });
}

export async function updateAgentManifesto(
  workerId: string,
  updates: Partial<Omit<AgentManifesto, "agentId">>,
): Promise<{ message: string; manifesto: AgentManifesto } | null> {
  return safeFetch(`${getWorkerUrl(workerId)}/api/knowledge/manifesto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}
