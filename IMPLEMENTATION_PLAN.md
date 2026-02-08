# NEAR Shade Agent Coordination MVP - Implementation Plan

## Executive Summary

Build a multi-agent coordination system where 3 worker Shade Agents perform tasks and write status/results to Ensue shared memory, while a coordinator agent monitors all workers, performs aggregation (tallying), and resumes a NEAR smart contract with final results using the yield/resume pattern.

**Key Innovation**: Using Ensue as the coordination layer between stateless Shade Agents, with the coordinator agent having visibility into all agent memories, while final results are settled on-chain via NEAR's yield-resume pattern.

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│    NEAR Blockchain (Coordinator Smart Contract)     │
│    - Yield/resume pattern (AI DAO style)            │
│    - Verifies TEE attestations                      │
│    - Stores final tallied results                   │
└───────────────────────┬─────────────────────────────┘
                        │ yield ID / resume
┌───────────────────────▼─────────────────────────────┐
│         Coordinator Shade Agent (TEE)                │
│    - Monitors Ensue for all worker statuses         │
│    - Performs tallying/aggregation logic            │
│    - Resumes contract with results                  │
└───────────────────────┬─────────────────────────────┘
                        │ read all memories
┌───────────────────────▼─────────────────────────────┐
│           Ensue Memory Network (Shared)              │
│   coordination/                                      │
│   ├── tasks/worker1/{status, result, timestamp}     │
│   ├── tasks/worker2/{status, result, timestamp}     │
│   ├── tasks/worker3/{status, result, timestamp}     │
│   ├── coordinator/{tally, status, yield_id}         │
│   └── config/{task_definition, contract_address}    │
└────────┬──────────────┬──────────────┬──────────────┘
         │              │              │
    ┌────▼───┐     ┌───▼────┐    ┌───▼────┐
    │Worker  │     │Worker  │    │Worker  │
    │Agent 1 │     │Agent 2 │    │Agent 3 │
    │(TEE)   │     │(TEE)   │    │(TEE)   │
    └────────┘     └────────┘    └────────┘
```

## Project Structure

Location: `/Users/manza/Code/near-shade-coordination/`

```
near-shade-coordination/
├── coordinator-contract/           # Rust smart contract
│   ├── src/lib.rs                  # Yield/resume implementation
│   └── Cargo.toml
│
├── shared/                          # Shared TypeScript utilities
│   └── src/
│       ├── ensue-client.ts         # Ensue API wrapper
│       ├── types.ts                # Shared types
│       └── constants.ts            # Memory key paths
│
├── worker-agent-1/                  # Worker agent (3001)
│   ├── src/
│   │   ├── index.ts                # Hono server
│   │   ├── routes/task.ts          # Task endpoint
│   │   └── workers/task-handler.ts # Ensue writes
│   ├── Dockerfile
│   └── docker-compose.yaml
│
├── worker-agent-2/                  # Worker agent (3002)
├── worker-agent-3/                  # Worker agent (3003)
│
├── coordinator-agent/               # Coordinator agent (3000)
│   └── src/
│       ├── index.ts                # Hono server
│       ├── monitor/memory-monitor.ts  # Polls Ensue
│       └── contract/resume-handler.ts # Resumes contract
│
├── frontend/                        # Next.js dashboard
│   └── src/app/
│       └── components/AgentStatus.tsx
│
└── scripts/
    ├── deploy-contract.sh
    └── setup-ensue-permissions.sh
```

## Reference Implementation: Verifiable AI DAO

**Location**: `/Users/manza/Code/AGENTS/verifiable-ai-dao/`

This is the OFFICIAL reference implementation of the NEAR AI DAO pattern with yield/resume. Key insights:

### Architecture Patterns from Reference

1. **Yield-Resume Flow** ([dao.rs](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/dao.rs)):
   - Contract uses `env::promise_yield_create()` with callback
   - Stores pending requests with proposal_id as key
   - Agent polls `get_pending_proposals()` view call
   - Agent resumes with `agent_vote(proposal_id, response, hashes)`
   - Callback `return_external_response()` finalizes on resume

2. **Hash Validation** ([dao.rs:133-142](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/dao.rs#L133-L142)):
   - **Critical security pattern**: Manifesto hash and proposal hash validated
   - Prevents tampering with data while agent is processing
   - Our MVP needs: `config_hash` and `result_hash` validation

3. **Agent Registration** ([collateral.rs](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/collateral.rs)):
   - TEE verification via DCAP quote
   - Codehash extraction from TCB info
   - Only registered agents can resume contracts
   - Our coordinator needs same registration

4. **Polling Pattern** ([responder.ts](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/src/responder.ts)):
   - 5-second polling interval
   - Processes oldest request first
   - Waits for registration before starting
   - Uses `agentView()` for reads, `agentCall()` for writes

5. **Docker TDX Setup** ([docker-compose.yaml](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/docker-compose.yaml)):
   - Two services: `shade-agent-api` + custom agent
   - Both mount `/var/run/tappd.sock`
   - Platform: `linux/amd64` for TDX compatibility
   - Environment variables injected from `.env.development.local`

### Key Differences for Our MVP

| Aspect | Verifiable AI DAO | Our Coordination MVP |
|--------|-------------------|----------------------|
| **Agents** | Single agent polls contract | 3 workers + 1 coordinator |
| **Coordination** | Direct contract polling | Ensue shared memory between workers |
| **Processing** | One proposal at a time | Parallel worker execution |
| **AI Integration** | NEAR AI (OpenAI-compatible) | Worker tasks (flexible) |
| **Result** | Vote decision | Aggregated tally |

### Files to Study Before Implementation

Must read before coding:
1. [dao.rs](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/dao.rs) - Yield/resume pattern (lines 83-148)
2. [responder.ts](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/src/responder.ts) - Polling loop (lines 27-72)
3. [collateral.rs](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/collateral.rs) - Registration verification
4. [lib.rs](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/lib.rs) - Contract state structure

## Existing Code to Reference

Your workspace has proven patterns to build upon:

1. **Shade Agent Pattern**: `/Users/manza/Code/AGENTS/shade-agents/shade-agent/`
   - Uses `@neardefi/shade-agent-js` (^1.0.0)
   - Hono server setup
   - Docker compose with shade-agent-api

2. **AI Agent Integration**: `/Users/manza/Code/near-intents-zcash/agent/`
   - Agent endpoints with smart contract integration
   - Next.js frontend
   - Environment configuration

3. **Ensue Setup**: `/Users/manza/Code/ensue/`
   - Empty directory ready for new project
   - API key file exists: `/Users/manza/Code/ensue api key`

4. **NEAR Credentials**: `/Users/manza/.near-credentials/`
   - Already configured for `agents-coordinator.testnet`

## Implementation Phases

### Phase 1: Project Setup & Shared Library

**Directory**: `/Users/manza/Code/near-shade-coordination/`

**Tasks**:
1. Create project structure with subdirectories
2. Initialize shared library with npm package
3. Build Ensue client wrapper (`shared/src/ensue-client.ts`)
4. Define memory schema and constants (`shared/src/constants.ts`)
5. Set up TypeScript configuration
6. Create `.env.example` with all required variables

**Deliverables**:
- Ensue client with read/write methods
- Memory key constants for all agents
- TypeScript types for status and results

**Reference Pattern**: Use the existing Shade Agent TypeScript setup from `/Users/manza/Code/AGENTS/shade-agents/shade-agent/`

---

### Phase 2: Smart Contract Development

**Directory**: `coordinator-contract/`

**Reference Files to Study First**:
- [verifiable-ai-dao/contract/src/dao.rs](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/dao.rs) - Complete yield/resume implementation
- [verifiable-ai-dao/contract/src/lib.rs](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/lib.rs) - Storage structures and state
- [verifiable-ai-dao/contract/Cargo.toml](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/Cargo.toml) - Dependencies

**Tasks**:
1. Initialize Rust project with NEAR SDK dependencies
2. Implement yield/resume pattern (based on AI DAO tutorial)
3. Add storage structures:
   - `pending_tasks: LookupMap<u64, CoordinationTask>`
   - `completed_tasks: LookupMap<u64, String>`
   - `coordinator_agent: Option<AccountId>`
4. Implement functions (following [dao.rs](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/dao.rs) pattern):

   **Public Functions**:
   - `start_coordination(task_config: String) -> Promise` - User initiates, creates yield
   - `coordinator_resume(proposal_id, result, config_hash, result_hash)` - Agent resumes
   - `get_pending_coordinations() -> Vec<(u64, CoordinationRequest)>` - Agent polling
   - `get_finalized_coordinations(proposal_id) -> Option<String>` - Get results

   **Private Functions**:
   - `return_coordination_result(proposal_id)` - Callback when resumed

   **Owner Functions** (registration from [lib.rs](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/src/lib.rs)):
   - `register_coordinator(quote_hex, collateral, checksum, tcb_info)`
   - `approve_codehash(codehash: String)`

5. Add hash verification (SHA256, like [responder.ts:46-47](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/src/responder.ts#L46-L47)):
   - `config_hash` validates task_config unchanged
   - `result_hash` validates aggregated_result integrity

6. Deploy to testnet with `shade-agent-cli`

**Key Contract Logic** (following verifiable-ai-dao pattern):
```rust
#[payable]
pub fn start_coordination(&mut self, task_config: String) -> Promise {
    let proposal_id = self.current_proposal_id;
    self.current_proposal_id += 1;

    // Create yielded promise with callback
    let yielded_promise = env::promise_yield_create(
        "return_coordination_result",
        &json!({ "proposal_id": proposal_id, "task_config": task_config })
            .to_string()
            .into_bytes(),
        RETURN_RESULT_GAS,
        GasWeight::default(),
        YIELD_REGISTER,
    );

    // Store pending coordination request
    self.pending_coordinations.insert(proposal_id, CoordinationRequest {
        task_config: task_config.clone(),
        config_hash: hash_string(&task_config),
        timestamp: env::block_timestamp(),
    });

    env::promise_return(yielded_promise)
}

pub fn coordinator_resume(&mut self, proposal_id: u64,
    aggregated_result: String, config_hash: String, result_hash: String) {
    // Verify caller is registered coordinator
    self.assert_coordinator();

    // Validate hashes (prevent config tampering)
    let request = self.pending_coordinations.get(&proposal_id)
        .expect("No pending coordination");
    require!(request.config_hash == config_hash, "Config hash mismatch");

    let computed_hash = hash_string(&aggregated_result);
    require!(computed_hash == result_hash, "Result hash mismatch");

    // Resume the yielded promise
    env::promise_yield_resume(
        &aggregated_result.as_bytes(),
        YIELD_REGISTER,
    );
}

#[private]
pub fn return_coordination_result(&mut self, proposal_id: u64) {
    match env::promise_result(0) {
        PromiseResult::Successful(data) => {
            let result = String::from_utf8(data).unwrap();
            self.finalized_coordinations.insert(proposal_id, result.clone());
            self.pending_coordinations.remove(&proposal_id);
        }
        PromiseResult::Failed => {
            env::panic_str("Coordination timed out");
        }
    }
}
```

**Dependencies** ([Cargo.toml](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/contract/Cargo.toml) from reference):
```toml
[package]
name = "coordinator_contract"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
near-sdk = { version = "5.7.0", features = ["schemars"]}
schemars = { version = "0.8" }
serde_json = "1.0.135"
base64 = "0.22.1"
hex = { version = "0.4", default-features = false, features = ["alloc"] }
dcap-qvl = { git = "https://github.com/mattlockyer/dcap-qvl" }  # For TEE verification
sha2 = "0.10.8"  # For hash validation
serde = "1.0.217"

[dev-dependencies]
near-sdk = { version = "5.7.0", features = ["unit-testing"] }

[profile.release]
codegen-units = 1
opt-level = "z"
lto = true
debug = false
panic = "abort"
overflow-checks = true
```

**Deployment**:
```bash
cd coordinator-contract

# Build with cargo-near
cargo near build

# Deploy to testnet (creates ac-proxy.{account}.testnet)
shade-agent-cli --wasm target/near/coordinator_contract.wasm --funding 7

# For production Phala deployment (creates ac-sandbox.{account}.testnet)
# Build reproducible WASM first, then deploy
```

---

### Phase 3: Worker Agents

**Directory**: `worker-agent-1/`, `worker-agent-2/`, `worker-agent-3/`

**Tasks**:
1. Set up Hono server (ports 3001, 3002, 3003)
2. Create task execution endpoint: `POST /api/task/execute`
3. Implement task handler that:
   - Updates status to "processing"
   - Performs work (simulated or real task)
   - Writes result to Ensue
   - Updates status to "completed"
   - Handles errors and writes to error key
4. Add health check endpoint: `GET /`
5. Add status endpoint: `GET /api/task/status`
6. Create Dockerfile and docker-compose.yaml

**Memory Write Pattern** (example for worker 1):
```typescript
// Write status
await ensueClient.updateMemory(
  'coordination/tasks/worker1/status',
  'processing'
);

// Write result
await ensueClient.updateMemory(
  'coordination/tasks/worker1/result',
  JSON.stringify({ workerId: 'worker1', value: 42 })
);

// Write timestamp
await ensueClient.updateMemory(
  'coordination/tasks/worker1/timestamp',
  Date.now().toString()
);
```

**Reference Pattern**: Follow the Hono server structure from `/Users/manza/Code/AGENTS/shade-agents/shade-agent/src/index.ts`

---

### Phase 4: Coordinator Agent

**Directory**: `coordinator-agent/`

**Reference Files to Study First**:
- [verifiable-ai-dao/src/responder.ts](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/src/responder.ts) - Polling and response pattern
- [verifiable-ai-dao/src/index.ts](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/src/index.ts) - Registration wait logic
- [verifiable-ai-dao/src/shade-agent-js.d.ts](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/src/shade-agent-js.d.ts) - SDK type definitions

**Critical**: Coordinator must be registered on contract before it can resume yields!

**Registration Flow** (following verifiable-ai-dao pattern):
1. Agent starts and waits for TEE registration (checksum appears)
2. Owner calls `register_coordinator(quote_hex, collateral, checksum, tcb_info)` on contract
3. Contract verifies TEE attestation and extracts codehash
4. Codehash must be in approved_codehashes set
5. Only then can coordinator call `coordinator_resume()`

**Tasks**:
1. Set up Hono server (port 3000)
2. Implement memory monitoring loop (`monitor/memory-monitor.ts`):
   - Poll Ensue every 5 seconds
   - Check all worker statuses
   - Detect when all completed
3. Implement aggregation logic:
   - Read all worker results
   - Perform tallying (e.g., sum values)
   - Write tally to `coordination/coordinator/tally`
4. Implement contract resume handler (`contract/resume-handler.ts`):
   - Calculate result hash
   - Call `resume_coordination` on contract
   - Handle errors and retries
5. Add coordination start endpoint: `POST /api/start-coordination`

**Monitoring Loop** (following verifiable-ai-dao responder.ts pattern):
```typescript
export async function startCoordinationLoop() {
  console.log('Starting coordination loop...');

  while (true) {
    try {
      // Poll contract for pending coordinations (like verifiable-ai-dao)
      const pendingRequests = await agentView({
        methodName: "get_pending_coordinations",
        args: {}
      });

      if (pendingRequests.length > 0) {
        // Process oldest pending coordination
        const request = pendingRequests[0];
        await processCoordination(request);
      }

      // 5-second polling interval
      await new Promise(resolve => setTimeout(resolve, 5000));
    } catch (error) {
      console.error('Coordination loop error:', error);
    }
  }
}

async function processCoordination(request: CoordinationRequest) {
  const { proposal_id, task_config, config_hash } = request;

  // Trigger all workers via Ensue
  await triggerWorkers(task_config);

  // Monitor Ensue for all worker completions
  const allCompleted = await waitForWorkers(10000); // 10s timeout

  if (allCompleted) {
    // Read results from Ensue
    const statuses = await ensueClient.readMultiple([
      'coordination/tasks/worker1/status',
      'coordination/tasks/worker2/status',
      'coordination/tasks/worker3/status'
    ]);

    const results = await readAllResults();
    const tally = aggregateResults(results);

    // Hash for validation (like verifiable-ai-dao)
    const result_hash = createHash('sha256')
      .update(JSON.stringify(tally))
      .digest('hex');

    // Resume contract with validated hashes
    await agentCall({
      methodName: "coordinator_resume",
      args: {
        proposal_id,
        aggregated_result: JSON.stringify(tally),
        config_hash,
        result_hash
      },
      gas: "300000000000000"
    });
  }
}
```

**Shade Agent JS SDK Usage** (^1.0.1 from [package.json](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/package.json)):

```typescript
import { agentCall, agentView, agentInfo } from '@neardefi/shade-agent-js';
import crypto from 'crypto';

// 1. Wait for agent registration (from verifiable-ai-dao/src/index.ts:18-24)
async function waitForRegistration() {
  console.log('Waiting for agent registration...');
  while (true) {
    const res = await agentInfo();
    if (res.checksum) {
      console.log('Agent registered with checksum:', res.checksum);
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// 2. Read contract state (view call - from verifiable-ai-dao/src/responder.ts:16-19)
const pendingRequests: [number, CoordinationRequest][] = await agentView({
  methodName: "get_pending_coordinations",
  args: {}
});
// Returns: [[proposal_id, request], ...]

// 3. Hash data for validation (from verifiable-ai-dao/src/responder.ts:46-47)
const config_hash = crypto.createHash('sha256')
  .update(task_config)
  .digest('hex');

const result_hash = crypto.createHash('sha256')
  .update(JSON.stringify(tally))
  .digest('hex');

// 4. Resume contract (mutation call - from verifiable-ai-dao/src/responder.ts:58-64)
await agentCall({
  methodName: "coordinator_resume",
  args: {
    proposal_id: proposal_id,
    aggregated_result: JSON.stringify(tally),
    config_hash: config_hash,
    result_hash: result_hash
  }
  // Note: Gas defaults to sufficient amount, no need to specify
});
```

**Key SDK Patterns**:
- **No gas parameter needed**: SDK handles gas allocation automatically
- **Return types**: Functions return the actual contract response (typed based on contract)
- **Error handling**: SDK throws on contract errors, wrap in try-catch
- **Checksum**: `agentInfo()` returns `{ checksum: string | null }`, null until registered

---

### Phase 5: Docker & Local Testing

**Tasks**:
1. Create Dockerfiles for all agents (reference existing pattern)
2. Set up docker-compose.yaml with shade-agent-api
3. Build all images locally
4. Test full flow:
   - Start all workers and coordinator
   - Call contract's `start_coordination`
   - Monitor Ensue memory updates
   - Verify coordinator aggregation
   - Verify contract resume
5. Create testing scripts

**Docker Compose Pattern** (for each agent):
```yaml
services:
  shade-agent-api:
    image: mattdlockyer/shade-agent-api@sha256:a86e3a4300b069...
    volumes:
      - /var/run/tappd.sock:/var/run/tappd.sock
    environment:
      NEAR_ACCOUNT_ID: ${NEAR_ACCOUNT_ID}
      # ... other vars

  worker-agent-1:
    image: ${DOCKER_TAG_WORKER1}
    ports:
      - "3001:3001"
    volumes:
      - /var/run/tappd.sock:/var/run/tappd.sock
    environment:
      ENSUE_API_KEY: ${ENSUE_API_KEY}
```

**Reference**: Use docker-compose from `/Users/manza/Code/AGENTS/shade-agents/shade-agent/docker-compose.yaml`

---

### Phase 6: Phala TEE Deployment

**Reference Pattern**: [verifiable-ai-dao/package.json](file:///Users/manza/Code/AGENTS/verifiable-ai-dao/package.json) scripts (lines 10-14)

**Tasks**:

**1. Build Production Docker Images**

Following verifiable-ai-dao build pattern:
```bash
cd worker-agent-1

# Build for linux/amd64 (REQUIRED for Phala TDX)
sudo docker build --platform linux/amd64 -t yourusername/worker-agent-1:latest .

# Or with no-cache for clean build
sudo docker build --no-cache --platform linux/amd64 -t yourusername/worker-agent-1:latest .

# Push to Docker Hub
sudo docker push yourusername/worker-agent-1:latest

# Repeat for worker-agent-2, worker-agent-3, and coordinator-agent
```

**2. Deploy to Phala Cloud**

Following verifiable-ai-dao deployment pattern:
```bash
cd worker-agent-1

# Deploy with Phala CLI
phala cvms create \
  --name worker-agent-1 \
  --vcpu 1 \
  --compose ./docker-compose.yaml \
  --env-file ./.env.development.local

# Repeat for other agents
```

**3. Get APP_CODEHASH**

After building, extract the Docker image hash:
```bash
# Get image ID
docker images | grep worker-agent-1

# Inspect image
docker inspect yourusername/worker-agent-1:latest | grep Id

# Update .env.development.local with APP_CODEHASH
```

**4. Register Coordinator on Contract**

After Phala deployment, coordinator must be registered:
```bash
# Get coordinator checksum from Phala logs
# Then call contract (owner only)
near contract call-function as-transaction \
  $NEXT_PUBLIC_contractId \
  register_coordinator \
  json-args '{"quote_hex": "...", "collateral": "...", "checksum": "...", "tcb_info": "..."}' \
  prepaid-gas '300.0 Tgas' \
  attached-deposit '0 NEAR' \
  sign-as agents-coordinator.testnet \
  network-config testnet
```

**5. Approve Codehash**

Owner must approve coordinator's codehash:
```bash
near contract call-function as-transaction \
  $NEXT_PUBLIC_contractId \
  approve_codehash \
  json-args '{"codehash": "$APP_CODEHASH"}' \
  prepaid-gas '100.0 Tgas' \
  attached-deposit '0 NEAR' \
  sign-as agents-coordinator.testnet \
  network-config testnet
```

**Deployment URLs**: Each agent gets unique Phala URL (e.g., `worker1.phala.cloud`)

**Critical Notes**:
- Platform MUST be `linux/amd64` (not arm64) for TDX compatibility
- Push to Docker Hub BEFORE deploying to Phala
- Coordinator registration is required before it can resume contracts
- Codehash approval is required for verification

---

### Phase 7: Frontend Dashboard

**Directory**: `frontend/`

**Tasks**:
1. Create Next.js project (or Vite + React)
2. Build components:
   - `AgentStatus.tsx` - Shows worker statuses from Ensue
   - `CoordinatorView.tsx` - Shows tally and coordination status
   - `ContractView.tsx` - Shows on-chain state
3. Add wallet connection (NEAR Wallet Selector)
4. Create form to initiate coordination
5. Add real-time updates (poll Ensue every 2s)
6. Display transaction history

**UI Features**:
- Start coordination button → calls contract
- Live worker status indicators (pending/processing/completed)
- Coordinator tally display
- Contract state viewer
- Transaction links to NEAR Explorer

---

### Phase 8: Documentation & Scripts

**Tasks**:
1. Write comprehensive README with:
   - Architecture diagram
   - Setup instructions
   - Environment variable reference
   - Deployment guide
2. Create deployment scripts:
   - `deploy-contract.sh` - Deploys coordinator contract
   - `setup-ensue-permissions.sh` - Configures Ensue access
   - `docker-build-all.sh` - Builds all Docker images
   - `test-full-flow.sh` - Runs end-to-end test
3. Document memory schema
4. Add troubleshooting guide

---

## Critical Files to Create

These 10 files form the core of the system:

1. **`coordinator-contract/src/lib.rs`**
   - Smart contract with yield/resume pattern
   - Central coordination point

2. **`shared/src/ensue-client.ts`**
   - Ensue API wrapper used by all agents
   - Read/write/update memory operations

3. **`shared/src/constants.ts`**
   - Memory key paths for entire system
   - Shared types and interfaces

4. **`worker-agent-1/src/workers/task-handler.ts`**
   - Worker task execution logic
   - Template for workers 2 & 3
   - Ensue integration pattern

5. **`coordinator-agent/src/monitor/memory-monitor.ts`**
   - Polling loop for worker statuses
   - Aggregation logic
   - Core coordination orchestration

6. **`coordinator-agent/src/contract/resume-handler.ts`**
   - Contract resume with hash verification
   - Error handling and retries

7. **`worker-agent-1/docker-compose.yaml`**
   - Docker configuration with shade-agent-api
   - Template for all agents

8. **`coordinator-contract/Cargo.toml`**
   - Rust dependencies (near-sdk, near-contract-standards)
   - Build configuration

9. **`frontend/src/app/page.tsx`**
   - Main dashboard UI
   - Agent status visualization

10. **`.env.example`**
    - All environment variables documented
    - Setup reference for deployment

## Environment Variables

All components need:
```bash
# NEAR Configuration
NEAR_ACCOUNT_ID=agents-coordinator.testnet
NEAR_SEED_PHRASE="your 12 word seed phrase"
NEXT_PUBLIC_contractId=ac-proxy.agents-coordinator.testnet
NEAR_RPC_JSON=https://rpc.testnet.near.org

# Ensue Configuration
ENSUE_API_KEY=your-ensue-api-key

# Shade Agent Configuration
API_CODEHASH=a86e3a4300b069c08d629a38d61a3d780f7992eaf36aa505e4527e466553e2e5
APP_CODEHASH=generated-during-build

# Worker-Specific
PORT=3001  # 3002, 3003 for other workers
WORKER_ID=worker1  # worker2, worker3
```

**Setup**:
- NEAR credentials already exist at `/Users/manza/.near-credentials/`
- Ensue API key exists at `/Users/manza/Code/ensue api key`
- Use existing `agents-coordinator.testnet` account

## Integration Flow

1. **User → Contract**: Call `start_coordination(task_config)` → yields with ID
2. **Contract → Coordinator**: Coordinator detects yield, stores ID in Ensue
3. **Coordinator → Workers**: Writes task config to Ensue, workers poll and execute
4. **Workers → Ensue**: Each writes status/result to their memory space
5. **Coordinator ← Ensue**: Monitors all worker statuses, detects completion
6. **Coordinator → Coordinator**: Aggregates results, calculates tally
7. **Coordinator → Contract**: Calls `resume_coordination(yield_id, tally, hash)`
8. **Contract → User**: Promise resolves, user receives final result

## Verification Strategy

### Unit Tests
- Ensue client operations (shared library)
- Contract yield/resume logic (Rust tests)
- Worker task handler (TypeScript tests)
- Coordinator aggregation logic

### Integration Tests
- Worker → Ensue writes
- Coordinator monitoring loop
- Contract resume flow
- Full end-to-end coordination

### Manual Testing Checklist
1. ✅ Deploy contract to testnet
2. ✅ Start all agents locally
3. ✅ Call contract `start_coordination`
4. ✅ Monitor Ensue via dashboard
5. ✅ Verify worker status transitions
6. ✅ Verify coordinator aggregation
7. ✅ Verify contract resume success
8. ✅ Check final result on-chain

### Performance Metrics
- Time from yield to resume: ~10-15 seconds
- NEAR gas costs: ~0.05-0.1 NEAR per coordination
- Ensue API calls: ~20-30 per coordination cycle
- Docker resource usage: Monitor CPU/memory

## Deployment Sequence

1. **Setup** (5 minutes)
   ```bash
   mkdir /Users/manza/Code/near-shade-coordination
   cd /Users/manza/Code/near-shade-coordination
   export ENSUE_API_KEY=$(cat "/Users/manza/Code/ensue api key")
   ```

2. **Deploy Contract** (10 minutes)
   ```bash
   cd coordinator-contract
   cargo near build
   shade-agent-cli --wasm target/near/coordinator_contract.wasm --funding 7
   ```

3. **Start Workers Locally** (5 minutes)
   ```bash
   cd worker-agent-1 && npm run dev &
   cd worker-agent-2 && npm run dev &
   cd worker-agent-3 && npm run dev &
   ```

4. **Start Coordinator** (5 minutes)
   ```bash
   cd coordinator-agent && npm run dev
   ```

5. **Test Flow** (10 minutes)
   ```bash
   near contract call-function as-transaction \
     $NEXT_PUBLIC_contractId start_coordination \
     json-args '{"task_config": "{\"type\":\"test\"}"}' \
     prepaid-gas '100.0 Tgas' \
     attached-deposit '0 NEAR' \
     sign-as agents-coordinator.testnet \
     network-config testnet
   ```

6. **Deploy to Phala TEE** (30 minutes)
   - Build Docker images
   - Push to Docker Hub
   - Deploy via Phala Cloud CLI
   - Configure production environment

7. **Deploy Frontend** (15 minutes)
   ```bash
   cd frontend
   npm run build
   vercel deploy --prod
   ```

## Success Criteria

The MVP is complete when:
- ✅ 3 worker agents can execute tasks independently
- ✅ Each worker writes status/results to Ensue shared memory
- ✅ Coordinator monitors all workers via Ensue
- ✅ Coordinator aggregates results (tallying)
- ✅ Coordinator resumes contract with final tally
- ✅ Contract yield/resume works end-to-end
- ✅ All agents run in Phala TEE with verified code hash
- ✅ Frontend displays real-time agent status
- ✅ Full flow completes in <30 seconds
- ✅ System handles worker failures gracefully

## Critical Implementation Notes

### Adapting Verifiable AI DAO Patterns

Our coordination MVP differs from verifiable-ai-dao in these key ways:

| Aspect | Verifiable AI DAO | Our Coordination MVP |
|--------|-------------------|----------------------|
| **Agent Count** | 1 agent | 4 agents (3 workers + 1 coordinator) |
| **Agent Role** | Agent polls contract, processes, resumes | Coordinator polls contract, workers use Ensue |
| **Data Flow** | Contract → Agent → Contract | Contract → Coordinator → Ensue → Workers → Ensue → Coordinator → Contract |
| **Processing** | Sequential (one proposal at a time) | Parallel (3 workers execute simultaneously) |
| **External Service** | NEAR AI (LLM inference) | Ensue (shared memory network) |
| **Result** | Vote + reasoning | Aggregated tally from 3 workers |
| **Verification** | Manifesto + proposal hash | Config + result hash |

### Key Adaptations Needed

1. **Contract State**:
   - Replace `pending_proposals` with `pending_coordinations`
   - Replace `finalized_proposals` with `finalized_coordinations`
   - Replace `manifesto` with generic `task_config`

2. **Coordinator Agent**:
   - Add Ensue client integration (not in reference)
   - Add worker monitoring loop (new pattern)
   - Add aggregation logic (new pattern)
   - Keep contract polling pattern (same as reference)

3. **Worker Agents**:
   - Don't poll contract directly (different from reference)
   - Poll Ensue for task configs instead
   - Write results to Ensue (new pattern)
   - No contract calls needed (different from reference)

4. **Hash Validation**:
   - Replace `manifesto_hash` + `proposal_hash` with `config_hash` + `result_hash`
   - Same SHA256 crypto pattern

5. **Registration**:
   - Only coordinator needs registration (workers don't call contract)
   - Use same TEE verification flow
   - Same codehash approval process

### Testing Strategy Differences

**Verifiable AI DAO Testing**:
- Test single agent processing
- Test AI voting correctness
- Test manifesto enforcement

**Our MVP Testing**:
- Test parallel worker execution
- Test Ensue memory coordination
- Test aggregation logic correctness
- Test worker failure scenarios (1 or 2 workers fail)
- Test coordinator timeout handling

## Next Steps After MVP

Potential enhancements:
- Add Ensue subscriptions for event-driven coordination
- Implement worker auto-scaling based on task load
- Add semantic search for intelligent task routing
- Create plugin system for different tallying algorithms
- Add multi-chain support using NEAR Chain Signatures
- Implement advanced error recovery and retry logic

## Estimated Timeline

- **Phase 1-2**: 2 days (Setup + Contract)
- **Phase 3**: 1 day (Workers)
- **Phase 4**: 1 day (Coordinator)
- **Phase 5**: 1 day (Docker + Testing)
- **Phase 6**: 1 day (TEE Deployment)
- **Phase 7**: 1 day (Frontend)
- **Phase 8**: 0.5 days (Documentation)

**Total: ~7.5 days for complete MVP**

## Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Ensue API rate limits | Implement caching, reduce poll frequency |
| TEE deployment complexity | Test locally first, reference existing patterns |
| Worker synchronization issues | Add timeout handling, retry logic |
| Contract gas costs | Optimize storage, batch operations |
| Memory schema conflicts | Use strict key namespacing, version schema |

---

**Ready to implement**: This plan builds on proven patterns from your existing Shade Agent projects and follows the architecture established in your pre-research on NEAR AI DAO and Ensue memory networks.