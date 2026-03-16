# Ensue Memory Network — Delibera Skill

## What is Ensue

Ensue is a persistent memory network for AI agents. It provides a shared
key-value store with semantic search, access control, cross-org collaboration,
and real-time subscriptions. In Delibera, Ensue is the coordination backbone —
the shared memory layer that lets worker agents (running in isolated Phala TEEs)
communicate state with the coordinator agent.

**Base URL:** `https://api.ensue-network.ai/`
**Public URL (no auth):** `https://api.ensue-network.ai/public`
**Auth:** `Authorization: Bearer $ENSUE_API_KEY` on all private requests

All requests use JSON-RPC 2.0:
```typescript
const response = await fetch('https://api.ensue-network.ai/', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.ENSUE_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'TOOL_NAME', arguments: { ...args } },
    id: 1,
  }),
})
```

---

## Delibera Memory Layout

All keys follow a hierarchical namespace convention using forward slashes.

### Coordinator namespace
```
coordination/
  coordinator/
    status                          # coordinator agent status
    tally                           # latest vote tally result
    proposal_id                     # current proposal being processed
    worker_snapshot_{proposalId}    # registry snapshot taken at vote start
  tasks/
    {workerDID}/
      status                        # pending | completed | failed
      result                        # worker's vote and reasoning
      timestamp                     # when completed
      error                         # error message if failed
  config/
    task_definition                 # current task config
```

### Worker namespace (per worker, in their own Ensue org)
```
worker/
  identity/
    did                             # worker's DID
    display_name                    # human-readable name
  reasoning/
    {proposalId}                    # vote + reasoning for each proposal
  knowledge/
    {topic}                         # accumulated knowledge entries
  state/
    current                         # current working state
```

### Public namespace (no API key needed to read)
```
public/
  proposals/
    {proposalId}/
      config                        # proposal parameters
      tally                         # final vote result (after finalization)
      rationale                     # aggregated reasoning (public)
```

---

## Core Operations

### TypeScript client wrapper

```typescript
// shared/src/ensue-client.ts

const ENSUE_BASE = 'https://api.ensue-network.ai/'

async function ensueCall(tool: string, args: Record<string, unknown>) {
  const res = await fetch(ENSUE_BASE, {
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
  set: (key: string, value: string) =>
    ensueCall('create_memory', {
      items: [{ key_name: key, description: key, value }],
    }),

  get: (key: string) =>
    ensueCall('get_memory', { key_names: [key] })
      .then((r: any) => r?.content?.[0]?.text),

  update: (key: string, value: string) =>
    ensueCall('update_memory', { key_name: key, value }),

  delete: (key: string) =>
    ensueCall('delete_memory', { key_names: [key] }),

  list: (prefix: string) =>
    ensueCall('list_keys', { prefix }),

  search: (query: string, prefix?: string) =>
    ensueCall('search_memories', { query, prefix, limit: 20 }),
}
```

### Create / write a memory
```typescript
await ensue.set('coordination/coordinator/status', 'idle')

// Batch create (up to 100 items)
await ensueCall('create_memory', {
  items: [
    { key_name: 'coordination/tasks/did:key:z6Mk.../status', description: 'Worker task status', value: 'pending' },
    { key_name: 'coordination/tasks/did:key:z6Mk.../timestamp', description: 'Worker task timestamp', value: Date.now().toString() },
  ]
})
```

### Read a memory
```typescript
const status = await ensue.get('coordination/coordinator/status')
// Returns the value string, or undefined if not found
```

### Update a memory
```typescript
await ensue.update('coordination/coordinator/status', 'coordinating')
// Note: update only changes the value, not the description
```

### List keys by prefix
```typescript
const result = await ensue.list('coordination/tasks/')
// Returns list of key metadata objects
```

### Search memories semantically
```typescript
const results = await ensue.search('worker vote reasoning', 'coordination/')
// Useful for retrieving relevant prior reasoning for AI context
```

---

## Key Patterns for Delibera

### Check all workers complete
```typescript
async function checkAllWorkersComplete(
  snapshot: string[],  // array of worker DIDs from registry snapshot
): Promise<boolean> {
  const keys = snapshot.map(did => `coordination/tasks/${did}/status`)
  const result = await ensueCall('get_memory', { key_names: keys })
  // parse result and check all values === 'completed'
  const memories = JSON.parse(result?.content?.[0]?.text ?? '[]')
  return memories.every((m: any) => m.value === 'completed')
}
```

### Write tally with worker names
```typescript
async function writeTally(tally: {
  approved: number,
  rejected: number,
  decision: string,
  workers: Array<{ did: string, name: string, vote: string }>
}) {
  await ensue.update(
    'coordination/coordinator/tally',
    JSON.stringify(tally)
  )
}
```

### Worker reads its own task
```typescript
// In worker-agent, the worker DID is derived from WORKER_STORACHA_PRIVATE_KEY
const workerDID = deriveDidFromPrivateKey(process.env.WORKER_STORACHA_PRIVATE_KEY!)
const status = await ensue.get(`coordination/tasks/${workerDID}/status`)
```

### Save worker reasoning after vote
```typescript
async function saveReasoning(proposalId: string, vote: string, reasoning: string) {
  await ensue.set(
    `worker/reasoning/${proposalId}`,
    JSON.stringify({ vote, reasoning, timestamp: Date.now() })
  )
}
```

### Publish proposal result publicly (no API key needed to read)
```typescript
async function publishProposalResult(proposalId: string, tally: object) {
  // Write to public namespace — readable without auth
  await ensue.set(
    `public/proposals/${proposalId}/tally`,
    JSON.stringify(tally)
  )
  // Must also grant public read on this namespace (once, at setup):
  // ensue share --command '{"command":"make_public","key_pattern":"public/proposals/"}'
}
```

---

## Agent Self-Registration (New Coordinator Provisioning)

Each coordinator needs its own Ensue org for isolated memory namespaces.
There is no "create org via API" endpoint, but agents can self-register:

### Step 1 — Agent registers (no human needed)
```typescript
async function registerCoordinatorEnsueOrg(coordinatorDid: string): Promise<{
  apiKey: string,
  claimUrl: string,
  verificationCode: string,
}> {
  const res = await fetch('https://api.ensue-network.ai/auth/agent-register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `delibera-coord-${coordinatorDid.slice(-8)}`,
    }),
  })
  const data = await res.json()
  return {
    apiKey: data.agent.api_key,       // inactive until claimed
    claimUrl: data.agent.claim_url,
    verificationCode: data.agent.verification_code,
  }
}
```

### Step 2 — Human claims (required to activate API key)
The claim URL and verification code must be shown to the coordinator operator.
The operator visits the claim URL, enters the verification code, provides
their email, and verifies it. The API key then becomes active.

**In the buy flow:** Show claim URL and verification code on the success screen
alongside the recovery file. Label it clearly:

```
⚠️ One more step to activate your coordinator memory:

Claim URL: https://www.ensue-network.ai/claim?token=...
Verification code: a1b2c3d4

Visit the URL above, enter the code, and verify your email.
Your coordinator will not store memory until this is complete.
```

### Step 3 — API key injected into Phala env
```typescript
// coordinator-agent/src/lib/provision.ts
const ensueOrg = await registerCoordinatorEnsueOrg(coordinatorDid)

// Store apiKey in job — will go into Phala env vars
// Store claimUrl + verificationCode — will be shown on success screen

const envVars = {
  ENSUE_API_KEY: ensueOrg.apiKey,  // inactive until claimed, but injected now
  // ... other vars
}
```

### Important caveats
- The API key is shown only once in the registration response — store it immediately
- The key is inactive until the human claims it — coordinator memory won't work until then
- `name` must be alphanumeric, hyphens, underscores, max 64 chars
- This is an alpha-state flow — confirm behavior with Ensue team before shipping

---

## Cross-Org Access (Worker ↔ Coordinator)

Workers registered to a coordinator can read coordinator state using
the `@org-name/` prefix pattern. This requires:
1. Coordinator org invites worker org (or sets auto-approve on invite link)
2. Worker org claims invite
3. Coordinator grants read permission to worker's proxy user or group

### Coordinator grants read to workers group
```typescript
// Run once when coordinator is set up
await ensueCall('share', {
  command: JSON.stringify({
    command: 'create_group',
    group_name: 'workers',
  })
})

await ensueCall('share', {
  command: JSON.stringify({
    command: 'grant',
    target: { type: 'group', group_name: 'workers' },
    action: 'read',
    key_pattern: 'coordination/',
  })
})

// Set workers as the external group so new workers auto-join it
await ensueCall('share', {
  command: JSON.stringify({
    command: 'set_external_group',
    group_name: 'workers',
  })
})

// Generate invite link for workers to claim
await ensueCall('create_invite', { auto_approve: true })
```

### Worker reads coordinator state cross-org
```typescript
// Worker reads task status from coordinator's org
const coordinatorOrgName = process.env.COORDINATOR_ENSUE_ORG!
const status = await ensueCall('get_memory', {
  key_names: [`@${coordinatorOrgName}/coordination/tasks/${workerDID}/status`]
})
```

**Note:** In the current Delibera implementation, all agents share one Ensue
org (the coordinator's). Cross-org is the target architecture for full
isolation. Use namespace prefixes (`{coordinatorDID}/coordination/...`) as
an interim isolation strategy until cross-org is set up per coordinator.

---

## Public Memories — Proposals Without API Key

Finalized deliberation results should be publicly readable. Any client
(DAO frontend, governance dashboard, etc.) can read them without auth.

### Make proposals namespace public (run once at coordinator setup)
```typescript
await ensueCall('share', {
  command: JSON.stringify({
    command: 'make_public',
    key_pattern: 'public/proposals/',
  })
})
```

### Read public memory (no API key — anyone can call this)
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

**Delibera use case:** After a proposal is finalized on-chain, write the
tally and rationale to `public/proposals/{proposalId}/`. DAOs can verify
the deliberation result without needing an Ensue account or API key.

---

## Subscriptions — Real-Time Updates

Workers can subscribe to their task key and react immediately when the
coordinator assigns them a new proposal, instead of polling.

```typescript
// Worker subscribes to its own task status key
await ensueCall('subscribe_to_memory', {
  key_name: `coordination/tasks/${workerDID}/status`,
})

// Listen via SSE stream
const eventSource = new EventSource(
  `https://events.ensue-network.ai/mcp`,
  { headers: { Authorization: `Bearer ${process.env.ENSUE_API_KEY}` } }
)
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data)
  if (data.key_name === `coordination/tasks/${workerDID}/status`) {
    // React to new task assignment
    handleNewTask(data.value)
  }
}
```

**Note:** Subscription duration is limited by org tier (free tier: 3 hours).
For long-running agents, re-subscribe periodically or fall back to polling.

---

## Environment Variables

```bash
# Required for all agents
ENSUE_API_KEY=your-api-key-here

# Required for cross-org worker access
COORDINATOR_ENSUE_ORG=delibera-coord-x7k2   # coordinator's org name

# Used by coordinator buy flow provisioning
# (no additional vars needed — agent-register uses no auth)
```

---

## Error Handling

```typescript
async function safeEnsueGet(key: string): Promise<string | null> {
  try {
    const result = await ensue.get(key)
    return result ?? null
  } catch (err) {
    // Key may not exist yet — not always an error in coordination flows
    console.warn(`Ensue key not found: ${key}`)
    return null
  }
}
```

Common errors:
- **Key not found:** Returns null/empty — handle gracefully in coordination polling
- **Inactive API key:** Agent-registered key not yet claimed — coordinator memory won't work
- **Permission denied:** Cross-org access not set up, or wrong key pattern granted
- **Rate limit:** Batch operations (up to 100 keys) to reduce request count

---

## Gotchas

1. **`update_memory` only changes the value, not the description.** If you need
   to update the description, delete and recreate the key.

2. **Keys must be created before they can be updated.** Use `create_memory`
   for new keys, `update_memory` for existing ones. The coordination flow
   should `create_memory` when initializing a task, then `update_memory`
   when status changes.

3. **Agent-registered API keys are inactive until claimed.** The coordinator
   buy flow must surface the claim URL to the operator. Without claiming,
   the coordinator's Ensue org is unusable.

4. **Subscriptions expire.** Free tier subscriptions last 3 hours. Long-running
   agents should re-subscribe on startup and handle reconnection.

5. **Public memories require an explicit `make_public` grant.** Writing to
   `public/` namespace does NOT automatically make it public. You must call
   `share --command make_public` for the namespace once at setup.

6. **Cross-org `@org-name/` prefix requires approved membership.** The worker
   org must have claimed the coordinator's invite link and been approved
   (or auto-approved) before cross-org reads work.

7. **`key_name` in `create_memory` must be unique.** Calling `create_memory`
   with an existing key will error. Check with `list_keys` or `get_memory`
   first, or use `update_memory` if the key already exists.