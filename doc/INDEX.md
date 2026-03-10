# Documentation Index

## Quick Navigation

### 📚 Core Reference
- **[CLAUDE.md](reference/CLAUDE.md)** — Project instructions, architecture, environment setup, deployment
- **[ARCHITECTURE.md](reference/ARCHITECTURE.md)** — System design, data flow, smart contracts

### 📋 Plans & Implementation
- **[IMPLEMENTATION_PLAN.md](plans/IMPLEMENTATION_PLAN.md)** — V2 migration milestones and progress tracking
- **[delibera-v2-claude-code-plan.md](plans/delibera-v2-claude-code-plan.md)** — Detailed V2 features and timelines
- **[permissionless-protocol-plan.md](plans/permissionless-protocol-plan.md)** — Model A: registry-based worker discovery
- **[stabilization-and-one-click-worker-plan.md](plans/stabilization-and-one-click-worker-plan.md)** — Phase 2.5 audit fixes and provisioning API
- **[static-worker-profile-migration-to-storacha-plan.md](plans/static-worker-profile-migration-to-storacha-plan.md)** — Worker identity persistence architecture
- **[IMPLEMENTATION_SUMMARY.md](plans/IMPLEMENTATION_SUMMARY.md)** — High-level summary of completed work

### 🔐 Storacha Integration
- **[STORACHA_QUICK_REFERENCE.md](storacha/STORACHA_QUICK_REFERENCE.md)** — **START HERE** for storage reading solutions
- **[STORACHA_RESEARCH_INDEX.md](storacha/STORACHA_RESEARCH_INDEX.md)** — Navigation hub for all Storacha research
- **[STORACHA_RETRIEVAL_FIXES.md](storacha/STORACHA_RETRIEVAL_FIXES.md)** — 5 production-ready fixes for gateway timeouts
- **[STORACHA_RETRIEVAL_RESEARCH.md](storacha/STORACHA_RETRIEVAL_RESEARCH.md)** — Deep technical analysis (20K+ words)
- **[STORACHA_RESEARCH_SUMMARY.txt](storacha/STORACHA_RESEARCH_SUMMARY.txt)** — Executive brief & recommendations
- **[STORACHA_RESEARCH_COMPLETE.txt](storacha/STORACHA_RESEARCH_COMPLETE.txt)** — Visual summary of findings

### 📦 Archive
- **[archive/CLAUDE_v1.md](archive/CLAUDE_v1.md)** — Previous CLAUDE.md version (v1, archived)
- **[archive/ARCHITECTURE_v1.md](archive/ARCHITECTURE_v1.md)** — Previous ARCHITECTURE.md version (v1, archived)

---

## By Task

### 🚀 Getting Started
1. Read [CLAUDE.md](reference/CLAUDE.md) — project setup, env vars, running locally
2. Check [ARCHITECTURE.md](reference/ARCHITECTURE.md) — understand the system design
3. Review [Storacha docs](storacha/) — storage integration details

### 🔧 Implementing Features
- Start with [IMPLEMENTATION_PLAN.md](plans/IMPLEMENTATION_PLAN.md)
- Check phase-specific plans in `plans/` folder
- Reference [ARCHITECTURE.md](reference/ARCHITECTURE.md) for design patterns

### 🔐 Working with Storacha
1. Start with [STORACHA_QUICK_REFERENCE.md](storacha/STORACHA_QUICK_REFERENCE.md)
2. For implementation fixes: [STORACHA_RETRIEVAL_FIXES.md](storacha/STORACHA_RETRIEVAL_FIXES.md)
3. For deep research: [STORACHA_RETRIEVAL_RESEARCH.md](storacha/STORACHA_RETRIEVAL_RESEARCH.md)

### 📦 Deploying Workers
- See [CLAUDE.md § One-Click Worker Buy Flow](reference/CLAUDE.md#one-click-worker-buy-flow-v25)
- Phase 2.5 details: [stabilization-and-one-click-worker-plan.md](plans/stabilization-and-one-click-worker-plan.md)

### 🎯 Understanding V2 Migration
- Overview: [delibera-v2-claude-code-plan.md](plans/delibera-v2-claude-code-plan.md)
- Status: [IMPLEMENTATION_PLAN.md § V2 Progress](plans/IMPLEMENTATION_PLAN.md)
- Archive changes: [static-worker-profile-migration-to-storacha-plan.md](plans/static-worker-profile-migration-to-storacha-plan.md)

---

## Document Organization

```
doc/
├── INDEX.md                          ← You are here
├── FIXES.md                          ← Bug tracker & known issues
├── storacha/                         ← Storage solutions research
│   ├── STORACHA_QUICK_REFERENCE.md
│   ├── STORACHA_RETRIEVAL_FIXES.md
│   ├── STORACHA_RETRIEVAL_RESEARCH.md
│   └── STORACHA_RESEARCH_INDEX.md
├── plans/                            ← Implementation roadmaps
│   ├── IMPLEMENTATION_PLAN.md        ← Master tracking
│   ├── delibera-v2-claude-code-plan.md
│   ├── permissionless-protocol-plan.md
│   ├── stabilization-and-one-click-worker-plan.md
│   ├── static-worker-profile-migration-to-storacha-plan.md
│   └── IMPLEMENTATION_SUMMARY.md
├── reference/                        ← Core docs (current versions)
│   ├── CLAUDE.md                     ← Project instructions & setup
│   └── ARCHITECTURE.md               ← System design & patterns
└── archive/                          ← Old versions
    ├── CLAUDE_v1.md
    └── ARCHITECTURE_v1.md
```

---

## Quick Links

- **GitHub**: https://github.com/storacha
- **Storacha Docs**: https://docs.storacha.network/
- **NEAR Testnet RPC**: https://test.rpc.fastnear.com
- **Phala Dashboard**: https://dashboard.phala.network/
- **Lit Protocol Docs**: https://developer.litprotocol.com/

---

*Last updated: March 10, 2026*
