---
name: ensue
description: "Ensue Memory Network — the shared state and coordination backbone for Delibera. Use this skill for ANY of these situations: coordinator or worker agent can't read/write shared state; debugging why coordination/coordinator/status is stuck or workers aren't completing; implementing or fixing ensueCall, create_memory, update_memory, get_memory, list_keys, or subscribe_to_memory; provisioning a new coordinator org in the buy flow (agent-register endpoint); setting up cross-org access with the @org-name/ prefix; making proposal tallies publicly readable without an API key; ENSUE_API_KEY not working or agent key not yet claimed; setting up worker group permissions on a fresh coordinator org; saving or searching worker reasoning in Ensue; any question about the coordination/ or worker/ key namespace layout. This is the primary reference for coordinator-agent, worker-agent, and buy-flow backend — if you're working on Delibera agent memory or coordination state, load this skill."
license: MIT
metadata:
  author: delibera
  version: "1.0.0"
---

# Ensue Memory Network — Delibera Integration

Ensue is a persistent memory network for AI agents — the coordination backbone of Delibera. Workers running in isolated Phala TEEs use it to share state with the coordinator. This skill covers every Ensue integration point in the project.

**Base URL:** `https://api.ensue-network.ai/`
**Public URL (unauthenticated reads):** `https://api.ensue-network.ai/public`
**Auth:** `Authorization: Bearer $ENSUE_API_KEY` on all private requests
**Protocol:** JSON-RPC 2.0 via `tools/call`

---

## Core Client Wrapper

All Ensue calls go through this pattern (`shared/src/ensue-client.ts`):

```typescript
async function ensueCall(tool: string, args: Record<string, unknown>) {
  const res = await fetch('https://api.ensue-network.ai/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.ENSUE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: tool, arguments: args },
      id: Date.now(),
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Ensue error: ${data.error.message}`)
  return data.result
}

export const ensue = {
  set:    (key: string, value: string) =>
    ensueCall('create_memory', { items: [{ key_name: key, description: key, value }] }),
  get:    (key: string) =>
    ensueCall('get_memory', { key_names: [key] })
      .then((r: any) => r?.content?.[0]?.text),
  update: (key: string, value: string) =>
    ensueCall('update_memory', { key_name: key, value }),
  delete: (key: string) =>
    ensueCall('delete_memory', { key_names: [key] }),
  list:   (prefix: string) =>
    ensueCall('list_keys', { prefix }),
  search: (query: string, prefix?: string) =>
    ensueCall('search_memories', { query, prefix, limit: 20 }),
}
```

---

## Memory Key Layout (Delibera Namespace Conventions)

All keys use forward-slash hierarchy. Never deviate from these namespaces — both coordinator and worker code depend on exact key paths.

### Coordinator org namespace
```
coordination/
  coordinator/
    status                          # 'idle' | 'coordinating' | ...
    tally                           # JSON: { approved, rejected, decision, workers[] }
    proposal_id                     # current proposal being processed
    worker_snapshot_{proposalId}    # JSON array of worker DIDs (registry snapshot)
  tasks/
    {workerDID}/
      status                        # 'pending' | 'completed' | 'failed'
      result                        # JSON: worker vote + reasoning
      timestamp                     # Unix ms string
      error                         # error message if failed
  config/
    task_definition                 # JSON: current task config
```

### Worker org namespace (each worker's own org)
```
worker/
  identity/
    did                             # worker's DID string
    display_name                    # human-readable name
  reasoning/
    {proposalId}                    # JSON: { vote, reasoning, timestamp }
  knowledge/
    {topic}                         # accumulated knowledge entries
  state/
    current                         # current working state
```

### Public namespace (no API key to read)
```
public/
  proposals/
    {proposalId}/
      config                        # proposal parameters
      tally                         # final vote result (after finalization)
      rationale                     # aggregated reasoning
```

---

## Core Operations

### Write a memory (new key)
```typescript
await ensue.set('coordination/coordinator/status', 'idle')

// Batch write (up to 100 items per request)
await ensueCall('create_memory', {
  items: [
    { key_name: `coordination/tasks/${did}/status`,    description: 'Worker task status', value: 'pending' },
    { key_name: `coordination/tasks/${did}/timestamp`, description: 'Worker task timestamp', value: Date.now().toString() },
  ]
})
```

### Read a memory
```typescript
const status = await ensue.get('coordination/coordinator/status')
// Returns the value string, or undefined if not found
```

### Update an existing key
```typescript
await ensue.update('coordination/coordinator/status', 'coordinating')
// Only changes value — description is unchanged
```

### List keys by prefix
```typescript
const result = await ensue.list('coordination/tasks/')
```

### Semantic search
```typescript
const results = await ensue.search('worker vote reasoning', 'coordination/')
// Useful for retrieving relevant prior reasoning for AI context injection
```

### Delete a key
```typescript
await ensue.delete('coordination/tasks/did:key:z6Mk.../status')
```

---

## Delibera-Specific Patterns

### Initialize worker task (coordinator writes, worker reads)
```typescript
// Coordinator initializes at vote start
await ensueCall('create_memory', {
  items: [
    { key_name: `coordination/tasks/${workerDID}/status`,    description: 'Task status', value: 'pending' },
    { key_name: `coordination/tasks/${workerDID}/timestamp`, description: 'Assigned at', value: Date.now().toString() },
  ]
})
```

### Worker reads its own task
```typescript
// DID is derived from WORKER_STORACHA_PRIVATE_KEY
const workerDID = deriveDidFromPrivateKey(process.env.WORKER_STORACHA_PRIVATE_KEY!)
const status = await ensue.get(`coordination/tasks/${workerDID}/status`)
```

### Check all workers complete
```typescript
async function checkAllWorkersComplete(snapshot: string[]): Promise<boolean> {
  const keys = snapshot.map(did => `coordination/tasks/${did}/status`)
  const result = await ensueCall('get_memory', { key_names: keys })
  const memories = JSON.parse(result?.content?.[0]?.text ?? '[]')
  return memories.every((m: any) => m.value === 'completed')
}
```

### Worker saves reasoning after vote
```typescript
async function saveReasoning(proposalId: string, vote: string, reasoning: string) {
  await ensue.set(
    `worker/reasoning/${proposalId}`,
    JSON.stringify({ vote, reasoning, timestamp: Date.now() })
  )
}
```

### Write finalized tally
```typescript
await ensue.update('coordination/coordinator/tally', JSON.stringify({
  approved: 2, rejected: 1, decision: 'approved',
  workers: [{ did, name, vote }]
}))
```

---

## Agent-Register: New Coordinator Provisioning

Used in the **buy flow backend** to provision a new coordinator org automatically. No human is needed for step 1, but a human must complete step 2 to activate the API key.

### Step 1 — Agent self-registers (no auth required)
```typescript
async function registerCoordinatorEnsueOrg(coordinatorDid: string) {
  const res = await fetch('https://api.ensue-network.ai/auth/agent-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `delibera-coord-${coordinatorDid.slice(-8)}`,  // max 64 chars, alphanumeric + hyphens/underscores
    }),
  })
  const data = await res.json()
  return {
    apiKey:           data.agent.api_key,          // store immediately — shown only once
    claimUrl:         data.agent.claim_url,
    verificationCode: data.agent.verification_code,
  }
}
```

### Step 2 — Inject key into Phala env, surface claim to operator
```typescript
const ensueOrg = await registerCoordinatorEnsueOrg(coordinatorDid)

// Store apiKey as env var for Phala deployment — key is inactive until claimed
const envVars = { ENSUE_API_KEY: ensueOrg.apiKey, /* ...other vars */ }

// Show on buy-flow success screen:
// ⚠️ One more step to activate your coordinator memory:
// Claim URL: https://www.ensue-network.ai/claim?token=...
// Verification code: a1b2c3d4
// Visit the URL above, enter the code, and verify your email.
// Your coordinator will not store memory until this is complete.
```

**Critical:** The API key is returned exactly once. Persist it immediately to the job record before returning from the registration function.

---

## Permission Setup (setupCoordinatorEnsuePermissions)

Run once when a new coordinator org is activated. Creates the worker group, grants read access to coordination namespace, and generates the auto-approve invite link for workers.

```typescript
async function setupCoordinatorEnsuePermissions() {
  // 1. Create the workers group
  await ensueCall('share', {
    command: JSON.stringify({ command: 'create_group', group_name: 'workers' })
  })

  // 2. Grant read on coordination/ to the workers group
  await ensueCall('share', {
    command: JSON.stringify({
      command: 'grant',
      target: { type: 'group', group_name: 'workers' },
      action: 'read',
      key_pattern: 'coordination/',
    })
  })

  // 3. Set workers as the external group (new joiners auto-added)
  await ensueCall('share', {
    command: JSON.stringify({ command: 'set_external_group', group_name: 'workers' })
  })

  // 4. Generate auto-approve invite link for workers
  const invite = await ensueCall('create_invite', { auto_approve: true })
  return invite  // store COORDINATOR_ENSUE_INVITE_LINK in env

  // 5. Make proposals namespace public (so DAOs can read results without auth)
  await ensueCall('share', {
    command: JSON.stringify({ command: 'make_public', key_pattern: 'public/proposals/' })
  })
}
```

---

## Cross-Org Access (Worker ↔ Coordinator)

Workers in their own Ensue org read coordinator state using the `@org-name/` prefix. Requires: coordinator has set up `setupCoordinatorEnsuePermissions`, and worker has claimed the coordinator's invite.

```typescript
// Worker reads its task from the coordinator's org
const coordinatorOrgName = process.env.COORDINATOR_ENSUE_ORG!  // e.g. 'delibera-coord-x7k2'
const status = await ensueCall('get_memory', {
  key_names: [`@${coordinatorOrgName}/coordination/tasks/${workerDID}/status`]
})
```

**Current state:** All agents share one coordinator Ensue org. Cross-org is the target architecture for full isolation. Interim strategy: namespace-prefix keys with `{coordinatorDID}/coordination/...` until per-coordinator cross-org is set up.

---

## Public Memories — No API Key Required

Finalized deliberation results live in `public/proposals/` and are readable by anyone — DAO frontends, governance dashboards, external verifiers.

### Make namespace public (once at coordinator setup — included in setupCoordinatorEnsuePermissions)
```typescript
await ensueCall('share', {
  command: JSON.stringify({ command: 'make_public', key_pattern: 'public/proposals/' })
})
```

### Write a public result (with API key)
```typescript
await ensue.set(`public/proposals/${proposalId}/tally`, JSON.stringify(tally))
```

### Read public memory (no API key)
```typescript
const result = await fetch('https://api.ensue-network.ai/public', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'public_get_memory',
      arguments: { path: '@coordinator-org-name/public/proposals/42/tally' }
    },
    id: 1,
  }),
})
```

Writing to `public/` does NOT automatically make it public — you must call `make_public` for the namespace first.

---

## Subscriptions — Real-Time Task Assignment

Workers can subscribe to their task key and react immediately rather than polling. Important for latency in Phala TEE workers.

```typescript
// Subscribe to task status
await ensueCall('subscribe_to_memory', {
  key_name: `coordination/tasks/${workerDID}/status`,
})

// Listen via SSE
const eventSource = new EventSource(
  `https://events.ensue-network.ai/mcp`,
  { headers: { Authorization: `Bearer ${process.env.ENSUE_API_KEY}` } }
)
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data)
  if (data.key_name === `coordination/tasks/${workerDID}/status`) {
    handleNewTask(data.value)
  }
}
```

**Free tier subscriptions expire after 3 hours.** Long-running Phala workers must re-subscribe on startup and implement reconnection logic. Polling is the fallback for production stability.

---

## Error Handling

```typescript
async function safeEnsueGet(key: string): Promise<string | null> {
  try {
    return await ensue.get(key) ?? null
  } catch (err) {
    console.warn(`Ensue key not found or error: ${key}`)
    return null
  }
}
```

| Error | Cause | Fix |
|-------|-------|-----|
| Key not found | Normal in coordination polling — key may not exist yet | Handle null gracefully |
| Inactive API key | Agent-registered key not yet claimed by human | Surface claim URL to operator |
| Permission denied | Cross-org access not configured, or wrong key pattern | Run setupCoordinatorEnsuePermissions |
| Rate limit | Too many individual requests | Batch with up to 100 keys per call |

---

## 7 Critical Gotchas

1. **`update_memory` only changes value, not description.** To update description, delete and recreate the key.

2. **Keys must exist before `update_memory`.** Use `create_memory` for new keys; `update_memory` for existing ones. Coordination flow: `create_memory` at task init, `update_memory` on status changes.

3. **Agent-registered API keys are inactive until the human claims them.** The buy flow must surface the claim URL + verification code prominently. Until claimed, all coordinator Ensue writes silently fail.

4. **Subscriptions expire after 3 hours on the free tier.** Re-subscribe on worker startup; implement reconnection. Polling is the safe fallback.

5. **`make_public` is required before public reads work.** Writing to `public/proposals/` namespace does NOT make it publicly readable. You must explicitly call `share --command make_public` for that key pattern.

6. **Cross-org `@org-name/` reads require an approved membership.** Worker org must have claimed the coordinator's invite link before `@coordinator-org-name/...` key reads work. Auto-approve invite (`create_invite { auto_approve: true }`) prevents manual bottlenecks.

7. **`key_name` in `create_memory` must be unique.** Calling `create_memory` on an existing key errors. Check first with `get_memory` or `list_keys`, or use `update_memory` if the key already exists. The safe pattern: `create_memory` once at task start, then always `update_memory`.

---

## Environment Variables

```bash
ENSUE_API_KEY=your-api-key-here           # required for all private operations
COORDINATOR_ENSUE_ORG=delibera-coord-x7k2 # coordinator's org name (for cross-org worker reads)
```
