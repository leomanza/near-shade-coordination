// ── Protocol API (central, always-running) ──
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://protocol-api-production.up.railway.app";

// ── Coordinator URL (dynamic, resolved from Ensue or env fallback) ──
let _coordinatorUrl = process.env.NEXT_PUBLIC_COORDINATOR_URL || "https://coordinator-agent-production-49b6.up.railway.app";

export function setActiveCoordinatorUrl(url: string) { _coordinatorUrl = url; }
export function getCoordinatorUrl(): string { return _coordinatorUrl; }

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
  workers: Record<string, string>; // keyed by DID (or legacy worker name)
  /** DID → display name map (only present with registry source) */
  workerNames?: Record<string, string>;
  timestamp: string;
  source?: "registry" | "env_fallback";
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
  const raw = await safeFetch<any>(`${getCoordinatorUrl()}/api/coordinate/workers`);
  if (!raw) return null;

  // Registry-based response: workers is an array with DID + ensue_status + display_name
  if (raw.source === "registry" && Array.isArray(raw.workers)) {
    const workers: Record<string, string> = {};
    const workerNames: Record<string, string> = {};
    for (const w of raw.workers) {
      workers[w.did] = w.ensue_status || (w.is_active ? "idle" : "offline");
      if (w.display_name) workerNames[w.did] = w.display_name;
    }
    return { workers, workerNames, timestamp: raw.timestamp, source: "registry" };
  }

  // Env-fallback: coordinator has no registry data — return empty.
  // The fallback workers (worker1/2/3) are hardcoded placeholders, not real agents.
  return { workers: {}, timestamp: raw.timestamp, source: "env_fallback" };
}

export async function getPendingCoordinations(): Promise<PendingCoordinations | null> {
  return safeFetch<PendingCoordinations>(`${getCoordinatorUrl()}/api/coordinate/pending`);
}

export async function getCoordinatorHealth(): Promise<{ status: string; contractId?: string; mode?: string } | null> {
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

export async function getProposalHistory(workerDid?: string): Promise<{ proposals: ProposalSummary[]; total: number } | null> {
  const params = workerDid ? `?workerDid=${encodeURIComponent(workerDid)}` : '';
  return safeFetch(`${getCoordinatorUrl()}/api/coordinate/proposals${params}`);
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
  worker_id: string;   // DID (did:key:z6Mk...) in permissionless mode, legacy name in fallback
  account_id: string | null;
  registered_at: number;
  registered_by: string;
  active: boolean;
}

/**
 * Get registered workers — queries coordinator's /api/coordinate/workers (registry-backed).
 * Falls back to env-based discovery if registry is unavailable.
 */
export async function getRegisteredWorkers(): Promise<{ workers: RegisteredWorker[]; activeCount: number } | null> {
  const raw = await safeFetch<any>(`${getCoordinatorUrl()}/api/coordinate/workers`);
  if (!raw) return null;

  // Registry-based response
  if (raw.source === "registry" && Array.isArray(raw.workers)) {
    const workers: RegisteredWorker[] = raw.workers.map((w: any) => ({
      worker_id: w.did,
      account_id: null,
      registered_at: w.registered_at ?? 0,
      registered_by: "",
      active: w.is_active,
    }));
    return { workers, activeCount: workers.filter((w) => w.active).length };
  }

  // Env-fallback: coordinator has no registry data — return empty.
  // The fallback workers (worker1/2/3) are hardcoded placeholders, not real agents.
  return { workers: [], activeCount: 0 };
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

const DEFAULT_CONTRACT_ID = process.env.NEXT_PUBLIC_contractId
  || (NEAR_NETWORK === "mainnet" ? "coordinator.agents-coordinator.near" : "coordinator.agents-coordinator.testnet");

// Active coordinator contract — updated when a coordinator is selected in the dashboard
let _contractId = DEFAULT_CONTRACT_ID;
export function setActiveContractId(id: string) { _contractId = id; }
export function getActiveContractId(): string { return _contractId; }
export { DEFAULT_CONTRACT_ID };

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
          account_id: _contractId,
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
  account_id: string;
  coordinator_did: string;
  endpoint_url: string;
  cvm_id: string;
  min_workers: number;
  max_workers: number;
  registered_at: number;
  is_active: boolean;
}

export interface RegistryWorker {
  account_id: string;
  coordinator_did: string;
  worker_did: string;
  endpoint_url: string;
  cvm_id: string;
  registered_at: number;
  is_active: boolean;
}

export async function getActiveCoordinators(): Promise<RegistryCoordinator[] | null> {
  return registryViewCall<RegistryCoordinator[]>("list_active_coordinators");
}

export async function getActiveWorkers(): Promise<RegistryWorker[] | null> {
  return registryViewCall<RegistryWorker[]>("list_active_workers");
}

/** Get workers registered by a specific NEAR account */
export async function getWorkersForAccount(accountId: string): Promise<RegistryWorker[]> {
  const all = await getActiveWorkers();
  if (!all) return [];
  return all.filter(w => w.account_id === accountId);
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
  storachaAgentPrivateKey?: string;
  storachaDelegationProof?: string;
  storachaSpaceDid?: string;
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

// ── Worker Display Names ──

export async function setWorkerDisplayName(did: string, name: string): Promise<{ status: string } | null> {
  return safeFetch<{ status: string }>(
    `${getCoordinatorUrl()}/api/coordinate/workers/${encodeURIComponent(did)}/name`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );
}

// ── Provisioning API (one-click worker deploy) ──

export interface ProvisionRequest {
  coordinatorDid: string;
  displayName: string;
  nearAccount: string;
}

export interface ProvisionJobStatus {
  jobId: string;
  status: string;
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

export async function startProvisionJob(params: ProvisionRequest): Promise<{ jobId: string } | null> {
  return safeFetch<{ jobId: string }>(`${API_URL}/api/provision/worker`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }, 15000);
}

export async function getProvisionStatus(jobId: string): Promise<ProvisionJobStatus | null> {
  return safeFetch<ProvisionJobStatus>(`${API_URL}/api/provision/status/${jobId}`, undefined, 10000);
}

export async function completeProvisionRegistration(jobId: string, txHash?: string): Promise<{ status: string } | null> {
  return safeFetch<{ status: string }>(`${API_URL}/api/provision/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, txHash }),
  }, 10000);
}

// ── Storacha / Agent Identity API (direct to worker) ──

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
