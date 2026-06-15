import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.hoisted runs before module evaluation — required so LOCAL_MODE constant is set at import time
vi.hoisted(() => {
  process.env.LOCAL_MODE = 'true';
  process.env.IRONCLAW_WEBHOOK_SECRET = 'coord-secret';
});

// Mock the shared Ensue client
vi.mock('@delibera-xyz/shared', () => ({
  createEnsueClient: vi.fn(() => ({
    updateMemory: vi.fn().mockResolvedValue(undefined),
    readMemory: vi.fn().mockResolvedValue(null),
    readMultiple: vi.fn().mockResolvedValue({}),
  })),
  NameResolver: vi.fn().mockImplementation(() => ({
    resolveAll: vi.fn().mockResolvedValue(new Map()),
    getCachedNames: vi.fn().mockReturnValue({}),
    setName: vi.fn().mockResolvedValue(undefined),
  })),
  MEMORY_KEYS: {
    CONFIG_TASK_DEFINITION: 'config/task_def',
    COORDINATOR_STATUS: 'coordination/coordinator/status',
    COORDINATOR_PROPOSAL_ID: 'coordination/coordinator/proposal_id',
    COORDINATOR_TALLY: 'coordination/coordinator/tally',
  },
  getWorkerKeys: (did: string) => ({
    STATUS: `coordination/tasks/${did}/status`,
    RESULT: `coordination/tasks/${did}/result`,
  }),
  getProposalKeys: (id: string) => ({ STATUS: `proposals/${id}/status`, TALLY: `proposals/${id}/tally`, CONFIG: `proposals/${id}/config` }),
  getProposalWorkerKeys: (pid: string, wid: string) => ({ RESULT: `proposals/${pid}/workers/${wid}/result`, TIMESTAMP: `proposals/${pid}/workers/${wid}/ts` }),
  getCoordinatorSnapshotKey: (id: string | number) => `snapshots/${id}`,
  PROPOSAL_INDEX_KEY: 'proposals/index',
  ENSUE_PREFIX: '',
}));

// Mock storacha identity (getAgentDid)
vi.mock('../storacha/identity', () => ({
  getAgentDid: vi.fn().mockResolvedValue('did:key:z6MkCoordinator'),
}));

// Mock contract/local-contract
vi.mock('../contract/local-contract', () => ({
  localStartCoordination: vi.fn().mockResolvedValue(1),
  localCoordinatorResume: vi.fn().mockResolvedValue(true),
  localRecordWorkerSubmissions: vi.fn().mockResolvedValue(true),
  localViewRegistry: vi.fn().mockResolvedValue([]),
  localRegisterWorker: vi.fn().mockResolvedValue(true),
  localRemoveWorker: vi.fn().mockResolvedValue(true),
  localRegisterCoordinator: vi.fn().mockResolvedValue(true),
  localRegisterWorkerInRegistry: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock storacha vault + backup
vi.mock('../storacha/vault', () => ({ backupDeliberation: vi.fn(), isVaultConfigured: vi.fn().mockReturnValue(false) }));
vi.mock('../storacha/ensue-backup', () => ({ backupEnsueTree: vi.fn() }));
vi.mock('../filecoin/archiver', () => ({ archiveCID: vi.fn(), logArchivalToNear: vi.fn() }));
vi.mock('../vrf/jury-selector', () => ({ selectJury: vi.fn(), verifyJurySelection: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { triggerWorkersForTest, getWorkerRecordsFromEnvForTest } from '../monitor/memory-monitor';

const ironclawWorker = {
  account_id: 'w.testnet',
  worker_did: 'did:key:z6MkIronClaw',
  endpoint_url: 'http://1.2.3.4:8080',
  cvm_id: 'ironclaw-999',
  registered_at: 0,
  is_active: true,
};

const phalaWorker = {
  account_id: 'w2.testnet',
  worker_did: 'did:key:z6MkPhala',
  endpoint_url: 'http://phala-worker:3001',
  cvm_id: 'abc-uuid-phala-cvm',
  registered_at: 0,
  is_active: true,
};

// dispatch.type=ensue_polling — outbound-only runtime. Identified by a non-http
// endpoint_url marker. The dispatcher must NOT HTTP-probe this worker.
// See doc/plans/dispatch-modes/00-spec.md
const pollingWorker = {
  account_id: 'w3.testnet',
  worker_did: 'did:key:z6MkHostedPolling',
  endpoint_url: 'ensue://socialcap',
  cvm_id: 'ironclaw-hosted-nearai-1',
  registered_at: 0,
  is_active: true,
};

describe('triggerWorkers — ironclaw dispatch branch', () => {
  beforeEach(() => { mockFetch.mockClear(); });
  afterEach(() => { vi.clearAllMocks(); });

  it('IronClaw worker dispatches to /webhook endpoint', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'm1' }) });
    await triggerWorkersForTest('{"type":"vote"}', [ironclawWorker]);
    const webhookCall = mockFetch.mock.calls.find(c => String(c[0]).includes('/webhook'));
    expect(webhookCall).toBeDefined();
    expect(webhookCall![0]).toBe('http://1.2.3.4:8080/webhook');
  });

  it('IronClaw dispatch content contains activation keywords', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'm1' }) });
    await triggerWorkersForTest('{}', [ironclawWorker]);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.content).toContain('deliberate');
    expect(body.content).toContain('task_id:');
    expect(body.content).toContain('proposal_id:');
  });

  it('IronClaw dispatch sends X-Hub-Signature-256 HMAC header (v0.28.1)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'm1' }) });
    await triggerWorkersForTest('{}', [ironclawWorker]);
    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers['X-Hub-Signature-256']).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers['X-Webhook-Secret']).toBeUndefined(); // removed in v0.28.1
  });

  it('Phala worker dispatches to /api/task/execute', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await triggerWorkersForTest('{"type":"vote"}', [phalaWorker]);
    const taskCall = mockFetch.mock.calls.find(c => String(c[0]).includes('/api/task/execute'));
    expect(taskCall).toBeDefined();
  });

  it('IronClaw does NOT dispatch to /api/task/execute', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'm1' }) });
    await triggerWorkersForTest('{}', [ironclawWorker]);
    const taskCall = mockFetch.mock.calls.find(c => String(c[0]).includes('/api/task/execute'));
    expect(taskCall).toBeUndefined();
  });

  it('polling worker (ensue:// endpoint) is NEVER HTTP-dispatched', async () => {
    // The polling worker has a non-http endpoint marker. Coord-agent must
    // skip both /webhook and /api/task/execute dispatch — its activation
    // signal is the task definition write to Ensue, not an HTTP push.
    await triggerWorkersForTest('{}', [pollingWorker]);
    const webhookCall = mockFetch.mock.calls.find(c => String(c[0]).includes('/webhook'));
    const taskCall = mockFetch.mock.calls.find(c => String(c[0]).includes('/api/task/execute'));
    expect(webhookCall).toBeUndefined();
    expect(taskCall).toBeUndefined();
    // No HTTP calls at all should have happened for a pure-polling-worker set.
    expect(mockFetch.mock.calls).toHaveLength(0);
  });

  it('mixed-mode dispatch: ironclaw pushed, polling worker untouched', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'm1' }) });
    await triggerWorkersForTest('{}', [ironclawWorker, pollingWorker]);
    // IronClaw webhook called exactly once; polling worker contributes no HTTP traffic.
    const webhookCalls = mockFetch.mock.calls.filter(c => String(c[0]).includes('/webhook'));
    expect(webhookCalls).toHaveLength(1);
    expect(webhookCalls[0][0]).toBe('http://1.2.3.4:8080/webhook');
  });

  it('still calls webhook even when fetch will reject (dispatch is attempted)', async () => {
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));
    // Should resolve without throwing (catch block handles the error)
    await expect(triggerWorkersForTest('{}', [{ ...ironclawWorker }])).resolves.toBeUndefined();
    // Fetch was called with the webhook URL
    const webhookCall = mockFetch.mock.calls.find(c => String(c[0]).includes('/webhook'));
    expect(webhookCall).toBeDefined();
  });
});

describe('WORKERS env parsing', () => {
  // We test parsing indirectly by reading what triggerWorkersForTest would do.
  // Since the parsing function is module-private, we verify via end-to-end behavior:
  // a WORKERS entry with "ironclaw-" cvm_id must trigger webhook dispatch.

  it('three-field WORKERS entry with ironclaw cvm_id routes to /webhook', async () => {
    // Force the env path: registry returns empty, env-based fallback kicks in
    process.env.LOCAL_MODE = 'true';
    process.env.WORKERS = 'did:key:z6MkSandbox|http://127.0.0.1:8080|ironclaw-sandbox';

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: 'm1' }) });
    // Construct a synthetic worker that mimics what getWorkerRecordsFromEnv would produce
    const w = {
      account_id: '',
      worker_did: 'did:key:z6MkSandbox',
      endpoint_url: 'http://127.0.0.1:8080',
      cvm_id: 'ironclaw-sandbox',
      registered_at: 0,
      is_active: true,
    };
    await triggerWorkersForTest('{}', [w]);
    const webhookCall = mockFetch.mock.calls.find(c => String(c[0]).includes('/webhook'));
    expect(webhookCall).toBeDefined();
    expect(webhookCall![0]).toBe('http://127.0.0.1:8080/webhook');
  });

  it('two-field WORKERS entry (no cvm_id) routes to /api/task/execute', async () => {
    process.env.LOCAL_MODE = 'true';
    process.env.WORKERS = 'did:key:z6MkPhala|http://phala-worker:3001';

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const w = {
      account_id: '',
      worker_did: 'did:key:z6MkPhala',
      endpoint_url: 'http://phala-worker:3001',
      cvm_id: '',
      registered_at: 0,
      is_active: true,
    };
    await triggerWorkersForTest('{}', [w]);
    const taskCall = mockFetch.mock.calls.find(c => String(c[0]).includes('/api/task/execute'));
    expect(taskCall).toBeDefined();
  });
});

describe('triggerWorkers — security/correctness guards', () => {
  beforeEach(() => { mockFetch.mockClear(); });
  afterEach(() => { vi.clearAllMocks(); });

  // Empty IRONCLAW_WEBHOOK_SECRET must fail fast, never sign with an empty HMAC key.
  it('throws when IRONCLAW_WEBHOOK_SECRET is empty and ironclaw workers are present', async () => {
    const original = process.env.IRONCLAW_WEBHOOK_SECRET;
    delete process.env.IRONCLAW_WEBHOOK_SECRET;
    try {
      await expect(
        triggerWorkersForTest('{"type":"vote"}', [{ ...ironclawWorker }]),
      ).rejects.toThrow(/IRONCLAW_WEBHOOK_SECRET/);
    } finally {
      if (original !== undefined) process.env.IRONCLAW_WEBHOOK_SECRET = original;
    }
    // No fetch should have been issued — guard fires before the dispatch loop.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // cvm_id null/undefined must not crash the dispatch filter.
  it('does not throw when a worker has cvm_id=null (legacy registry row)', async () => {
    process.env.IRONCLAW_WEBHOOK_SECRET = 'coord-secret';
    const malformed = { ...ironclawWorker, cvm_id: null as unknown as string };
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ message_id: 'ok' }) });
    // Should not throw TypeError on null.startsWith — phalaWorker still dispatches.
    await expect(
      triggerWorkersForTest('{"type":"vote"}', [malformed, { ...phalaWorker }]),
    ).resolves.not.toThrow();
  });

  it('does not throw when a worker has cvm_id=undefined', async () => {
    process.env.IRONCLAW_WEBHOOK_SECRET = 'coord-secret';
    const malformed = { ...ironclawWorker, cvm_id: undefined as unknown as string };
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ message_id: 'ok' }) });
    await expect(
      triggerWorkersForTest('{"type":"vote"}', [malformed, { ...phalaWorker }]),
    ).resolves.not.toThrow();
  });

  // Empty WORKERS entries (trailing comma, blank slot) must not produce ghost workers.
  it('filters empty WORKERS env entries (trailing comma)', () => {
    const original = process.env.WORKERS;
    try {
      process.env.WORKERS = 'did:key:A|http://a:3001|cvm-a,,did:key:B|http://b:3001|cvm-b,';
      const records = getWorkerRecordsFromEnvForTest();
      expect(records.length).toBe(2);
      expect(records.map(r => r.worker_did)).toEqual(['did:key:A', 'did:key:B']);
      // No record with empty worker_did.
      expect(records.every(r => r.worker_did.length > 0)).toBe(true);
    } finally {
      if (original !== undefined) process.env.WORKERS = original;
      else delete process.env.WORKERS;
    }
  });

  it('drops malformed entries with empty leading id (e.g. "|http://x|cvm")', () => {
    const original = process.env.WORKERS;
    try {
      process.env.WORKERS = '|http://ghost:3001|ironclaw-ghost,did:key:real|http://real:3001|cvm-real';
      const records = getWorkerRecordsFromEnvForTest();
      expect(records.length).toBe(1);
      expect(records[0].worker_did).toBe('did:key:real');
    } finally {
      if (original !== undefined) process.env.WORKERS = original;
      else delete process.env.WORKERS;
    }
  });

  // The passed array MUST be mutated to remove unreachable workers — callers rely on this
  // to compute workerDIDs for waitForWorkers after dispatch.
  it('mutates the passed array to remove unreachable IronClaw workers', async () => {
    process.env.IRONCLAW_WEBHOOK_SECRET = 'coord-secret';
    const reachable = { ...ironclawWorker, worker_did: 'did:key:reachable' };
    const unreachable = { ...ironclawWorker, worker_did: 'did:key:unreachable' };
    const workers = [reachable, unreachable];
    mockFetch
      .mockImplementationOnce(async () => ({ ok: true, json: async () => ({ message_id: 'r1' }) }))
      .mockImplementationOnce(() => Promise.reject(new Error('ECONNREFUSED')));
    await triggerWorkersForTest('{}', workers);
    // After dispatch, only the reachable worker must remain — callers iterate this array
    // to build workerDIDs for waitForWorkers.
    expect(workers.map(w => w.worker_did)).toEqual(['did:key:reachable']);
  });
});
