// ── Protocol API (central, always-running) ──
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://protocol-api-production.up.railway.app";

// ── Coordinator URL (dynamic, resolved from Ensue or env fallback) ──
let _coordinatorUrl = process.env.NEXT_PUBLIC_COORDINATOR_URL || "https://coordinator-agent-production-49b6.up.railway.app";

export function setActiveCoordinatorUrl(url: string) { _coordinatorUrl = url; }
function getCoordinatorUrl(): string { return _coordinatorUrl; }

/** In-memory cache of agent endpoints (fetched from registry contract via protocol API) */
let _agentEndpointsCache: Record<string, string> = {};
let _agentEndpointsFetchedAt = 0;
const CACHE_TTL = 30_000; // 30s

/** Fetch all agent endpoints from protocol API (registry contract-backed) */
export async function fetchAgentEndpoints(): Promise<Record<string, { endpoint: string | null; type: string; cvmId: string | null }>> {
  const res = await safeFetch<{ agents: Record<string, { endpoint: string | null; type: string; cvmId: string | null }> }>(
    `${API_URL}/api/agents/endpoints`
  );
  if (res?.agents) {
    _agentEndpointsCache = {};
    for (const [id, info] of Object.entries(res.agents)) {
      if (info.endpoint) _agentEndpointsCache[id] = info.endpoint;
    }
    _agentEndpointsFetchedAt = Date.now();
    return res.agents;
  }
  return {};
}

/** Update a specific agent's endpoint URL (persisted on-chain via protocol API) */
export async function updateAgentEndpoint(agentId: string, endpoint: string, cvmId?: string, dashboardUrl?: string): Promise<boolean> {
  const res = await safeFetch<{ success: boolean }>(
    `${API_URL}/api/agents/${agentId}/endpoint`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint, cvmId, dashboardUrl }) },
    10000,
  );
  if (res?.success) {
    _agentEndpointsCache[agentId] = endpoint;
  }
  return !!res?.success;
}

/** Dynamic worker URLs - checks registry-backed endpoints, falls back to localhost */
function getWorkerUrl(workerId: string): string {
  if (_agentEndpointsCache[workerId]) return _agentEndpointsCache[workerId];
  const envKey = `NEXT_PUBLIC_${workerId.toUpperCase()}_URL`;
  if (typeof window === "undefined") {
    return process.env[envKey] || `http://localhost:${3000 + parseInt(workerId.replace("worker", "")) || 1}`;
  }
  const num = parseInt(workerId.replace("worker", ""));
  return `http://localhost:${3000 + (num || 1)}`;
}

/** Ensure agent endpoints are loaded (call once on page load) */
export async function ensureAgentEndpoints(): Promise<void> {
  if (Date.now() - _agentEndpointsFetchedAt < CACHE_TTL) return;
  await fetchAgentEndpoints();
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

async function safeFetch<T>(url: string, options?: RequestInit, timeoutMs = 5000): Promise<T | null> {
  try {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Coordinator-specific API (dynamic URL) ──

export async function getCoordinatorStatus(): Promise<CoordinatorStatus | null> {
  return safeFetch<CoordinatorStatus>(`${getCoordinatorUrl()}/api/coordinate/status`);
}

export async function getWorkerStatuses(): Promise<WorkerStatuses | null> {
  return safeFetch<WorkerStatuses>(`${getCoordinatorUrl()}/api/coordinate/workers`);
}

export async function getPendingCoordinations(): Promise<PendingCoordinations | null> {
  return safeFetch<PendingCoordinations>(`${getCoordinatorUrl()}/api/coordinate/pending`);
}

export async function getCoordinatorHealth(): Promise<{ status: string } | null> {
  return safeFetch(`${getCoordinatorUrl()}/`);
}

export async function resetMemory(): Promise<{ message: string } | null> {
  return safeFetch(`${getCoordinatorUrl()}/api/coordinate/reset`, { method: "POST" });
}

export async function triggerCoordination(
  taskType: string = "random"
): Promise<{ message: string } | null> {
  return safeFetch(`${getCoordinatorUrl()}/api/coordinate/trigger`, {
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
  return safeFetch(`${getCoordinatorUrl()}/api/coordinate/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      taskConfig: { type: "vote", parameters: { proposal }, timeout: 30000 },
    }),
  });
}

// ── Proposal History (coordinator-specific) ──

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
  return safeFetch(`${getCoordinatorUrl()}/api/coordinate/proposals`);
}

export async function getProposalDetail(proposalId: string): Promise<ProposalDetail | null> {
  return safeFetch(`${getCoordinatorUrl()}/api/coordinate/proposals/${proposalId}`);
}

// ── Worker-level API (direct to worker instance) ──

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

// ── Worker Registration (protocol API → on-chain) ──

export interface RegisteredWorker {
  worker_id: string;
  account_id: string | null;
  registered_at: number;
  registered_by: string;
  active: boolean;
}

export async function getRegisteredWorkers(): Promise<{ workers: RegisteredWorker[]; activeCount: number } | null> {
  return safeFetch(`${API_URL}/api/workers/registered`);
}

export async function registerWorker(
  workerId: string,
  accountId?: string
): Promise<{ message: string } | null> {
  return safeFetch(`${API_URL}/api/workers/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workerId, accountId }),
  });
}

export async function removeWorker(workerId: string): Promise<{ message: string } | null> {
  return safeFetch(`${API_URL}/api/workers/${workerId}`, {
    method: "DELETE",
  });
}

// ── PingPay Checkout (protocol API) ──

export interface CheckoutSessionResponse {
  sessionUrl: string;
  sessionId: string;
  expiresAt?: string;
}

export async function createCheckoutSession(params: {
  amount: string;
  chain?: string;
  symbol?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, unknown>;
}): Promise<CheckoutSessionResponse | null> {
  return safeFetch<CheckoutSessionResponse>(`${API_URL}/api/payments/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

// ── On-chain reads (directly from NEAR RPC) ──

const NEAR_NETWORK = process.env.NEXT_PUBLIC_NEAR_NETWORK || "testnet";
const NEAR_RPC = NEAR_NETWORK === "mainnet"
  ? "https://rpc.fastnear.com"
  : "https://test.rpc.fastnear.com";
const CONTRACT_ID = process.env.NEXT_PUBLIC_contractId
  || (NEAR_NETWORK === "mainnet" ? "coordinator.agents-coordinator.near" : "coordinator.agents-coordinator.testnet");

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

// ── Registry Contract (multi-coordinator/worker platform) ──

const REGISTRY_CONTRACT_ID = process.env.NEXT_PUBLIC_REGISTRY_CONTRACT_ID || "registry.agents-coordinator.testnet";

async function registryViewCall<T>(method: string, args: Record<string, unknown> = {}): Promise<T | null> {
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
          account_id: REGISTRY_CONTRACT_ID,
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

export interface RegistryCoordinator {
  coordinator_id: string;
  owner: string;
  contract_id: string | null;
  phala_cvm_id: string | null;
  ensue_configured: boolean;
  endpoint_url: string | null;
  created_at: number;
  active: boolean;
}

export interface RegistryWorker {
  worker_id: string;
  owner: string;
  coordinator_id: string | null;
  phala_cvm_id: string | null;
  nova_group_id: string | null;
  endpoint_url: string | null;
  created_at: number;
  active: boolean;
}

export async function getActiveCoordinators(): Promise<RegistryCoordinator[] | null> {
  return registryViewCall<RegistryCoordinator[]>("list_active_coordinators");
}

export async function getRegistryStats(): Promise<{
  total_coordinators: number;
  active_coordinators: number;
  total_workers: number;
  active_workers: number;
} | null> {
  return registryViewCall("get_stats");
}

// ── Phala Deployment (protocol API) ──

export interface DeployRequest {
  type: "coordinator" | "worker";
  name: string;
  phalaApiKey?: string;
  ensueApiKey?: string;
  ensueToken?: string;
  nearAiApiKey?: string;
  // Shade Agent v2 fields (coordinator)
  agentContractId?: string;
  sponsorAccountId?: string;
  sponsorPrivateKey?: string;
  nearNetwork?: string;
  // Worker fields
  novaApiKey?: string;
  novaAccountId?: string;
  novaGroupId?: string;
  coordinatorId?: string;
}

export interface DeployResponse {
  success: boolean;
  cvmId?: string;
  dashboardUrl?: string;
  endpointUrl?: string;
  name?: string;
  error?: string;
}

export async function deployToPhala(params: DeployRequest): Promise<DeployResponse | null> {
  return safeFetch<DeployResponse>(`${API_URL}/api/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }, 60000);
}

/**
 * Poll Phala CVM status to discover the public endpoint URL.
 * Returns the first app URL from public_urls, or null if not yet available.
 */
export async function pollDeployEndpoint(cvmId: string, phalaApiKey: string): Promise<string | null> {
  const data = await safeFetch<any>(
    `${API_URL}/api/deploy/status/${cvmId}`,
    { headers: { "x-phala-api-key": phalaApiKey } },
    10000,
  );
  const url = data?.public_urls?.find((u: any) => u.app && u.app.trim())?.app;
  return url ?? null;
}

// ── Nova / Agent Identity API (direct to worker) ──

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
