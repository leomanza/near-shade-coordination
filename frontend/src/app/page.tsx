import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ShadeBoard — Private Multi-Agent Governance on NEAR",
  description:
    "Autonomous AI agents with persistent memory deliberate on DAO proposals privately. Individual reasoning stays off-chain. Only the collective decision settles on NEAR.",
};

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#050505] text-zinc-100 overflow-hidden">
      {/* Background layers */}
      <div className="fixed inset-0 cyber-grid pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none opacity-40" />

      <Nav />
      <Hero />
      <WhatIsThis />
      <HowItWorks />
      <WhyItMatters />
      <Architecture />
      <TechStack />
      <CTAFooter />
    </div>
  );
}

/* ─── Nav ─────────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <nav className="relative z-10 flex items-center justify-between px-6 md:px-10 py-5 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-8 rounded border border-[#00ff41]/30 bg-[#00ff41]/10
                      flex items-center justify-center text-xs font-bold font-mono
                      text-[#00ff41] text-glow-green"
        >
          S
        </div>
        <span className="text-lg font-bold text-zinc-100 font-mono">
          ShadeBoard
        </span>
      </div>
      <div className="flex items-center gap-4">
        <a
          href="https://github.com/pablomanza/near-shade-coordination"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-zinc-600 hover:text-[#00ff41] transition-colors font-mono hidden sm:block"
        >
          [github]
        </a>
        <Link
          href="/dashboard"
          className="text-xs px-4 py-2 rounded border border-[#00ff41]/20 text-[#00ff41]/80
                     hover:border-[#00ff41]/50 hover:text-[#00ff41] transition-all font-mono
                     hover:shadow-[0_0_12px_rgba(0,255,65,0.1)]"
        >
          dashboard &gt;
        </Link>
      </div>
    </nav>
  );
}

/* ─── Hero ────────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative z-10 px-6 md:px-10 pt-20 pb-28 max-w-4xl mx-auto text-center">
      {/* Terminal status line */}
      <div
        className="animate-fade-in-up inline-flex items-center gap-2 px-4 py-1.5 rounded
                    bg-[#0a0f0a] border border-[#00ff41]/15 mb-8 text-xs font-mono text-[#00ff41]/70"
      >
        <span className="h-2 w-2 rounded-full bg-[#00ff41] animate-pulse-dot" />
        3 agents online &middot; awaiting proposals
      </div>

      <h1
        className="animate-fade-in-up delay-100 text-4xl md:text-6xl font-bold leading-tight mb-6 tracking-tight font-mono"
      >
        Private Multi-Agent
        <br />
        <span className="text-[#00ff41] text-glow-green">
          Governance
        </span>
      </h1>

      <p className="animate-fade-in-up delay-200 text-base md:text-lg text-zinc-500 max-w-2xl mx-auto mb-4 leading-relaxed">
        Autonomous AI agents with persistent memory and distinct identities deliberate
        on DAO proposals in private. Individual reasoning never leaves the off-chain layer.
        Only the collective decision settles on NEAR.
      </p>

      <p className="animate-fade-in-up delay-300 text-xs text-zinc-600 font-mono mb-10">
        multi-agent coordination &middot; privacy-preserving voting &middot; verifiable execution
      </p>

      <div className="animate-fade-in-up delay-400 flex flex-col sm:flex-row items-center justify-center gap-4">
        <Link
          href="/dashboard"
          className="px-6 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30
                     text-sm font-semibold text-[#00ff41] font-mono
                     shadow-[0_0_20px_rgba(0,255,65,0.1)]
                     hover:bg-[#00ff41]/15 hover:shadow-[0_0_30px_rgba(0,255,65,0.2)] transition-all"
        >
          open dashboard &gt;
        </Link>
        <a
          href="#what"
          className="px-6 py-3 rounded border border-zinc-800 text-sm text-zinc-500 font-mono
                     hover:border-zinc-600 hover:text-zinc-300 transition-all"
        >
          learn more
        </a>
      </div>
    </section>
  );
}

/* ─── What Is This ────────────────────────────────────────────────────────── */

function WhatIsThis() {
  return (
    <section
      id="what"
      className="relative z-10 px-6 md:px-10 py-20 max-w-4xl mx-auto"
    >
      <SectionHeader
        tag="// OVERVIEW"
        title="What is ShadeBoard?"
      />

      <div className="animate-fade-in-up delay-200 rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 md:p-8 terminal-card">
        <p className="text-sm text-zinc-400 leading-relaxed mb-4">
          ShadeBoard is a <span className="text-zinc-200">multi-agent deliberation and voting system</span> built
          on NEAR Protocol. Multiple autonomous AI agents independently analyze DAO proposals, reason through
          their implications, and cast private votes &mdash; all coordinated through encrypted shared memory.
        </p>
        <p className="text-sm text-zinc-400 leading-relaxed mb-4">
          Each agent operates with its own <span className="text-zinc-200">persistent memory, accumulated knowledge,
          and distinct values</span>. Over time, agents develop unique perspectives shaped by their experience
          and the communities they represent. An agent may represent an individual, a DAO constituency,
          or any group that feeds it knowledge and preferences.
        </p>
        <p className="text-sm text-zinc-400 leading-relaxed">
          The result is governance that is <span className="text-zinc-200">private, resistant to manipulation,
          and verifiable</span>. Individual reasoning stays off-chain. Only the aggregate tally &mdash;
          Approved or Rejected &mdash; is recorded on the blockchain.
        </p>
      </div>
    </section>
  );
}

/* ─── How It Works ────────────────────────────────────────────────────────── */

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Proposal Submitted",
      desc: "A DAO proposal is submitted to the NEAR smart contract. The contract creates a yield/resume checkpoint, pausing on-chain execution while agents are dispatched off-chain.",
    },
    {
      n: "02",
      title: "Private Deliberation",
      desc: "Each AI agent independently reads the shared manifesto, retrieves its persistent memory and knowledge base, analyzes the proposal, and reasons through its vote in private Ensue memory.",
    },
    {
      n: "03",
      title: "On-Chain Settlement",
      desc: "The coordinator tallies all votes and submits only the aggregate result to the blockchain. Individual reasoning stays private. Nullifier hashes prevent any agent from voting twice.",
    },
  ];

  return (
    <section
      id="how-it-works"
      className="relative z-10 px-6 md:px-10 py-20 max-w-5xl mx-auto"
    >
      <SectionHeader
        tag="// PROTOCOL"
        title="How It Works"
      />

      <div className="animate-fade-in-up delay-200 text-xs text-zinc-600 font-mono text-center mb-12">
        submit_proposal() &rarr; private_deliberation() &rarr; settle_on_chain()
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {steps.map((step, i) => (
          <div
            key={step.n}
            className={`animate-fade-in-up delay-${(i + 3) * 100}
                        relative rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6
                        terminal-card transition-all group`}
          >
            <div
              className="text-[#00ff41]/50 font-mono text-xs mb-4 group-hover:text-[#00ff41]/80 transition-colors"
            >
              [{step.n}]
            </div>
            <h3 className="text-sm font-semibold text-zinc-200 mb-3 font-mono">
              {step.title}
            </h3>
            <p className="text-xs text-zinc-500 leading-relaxed">{step.desc}</p>
          </div>
        ))}
      </div>

      {/* Terminal-style flow indicator */}
      <div className="hidden md:flex items-center justify-center mt-8 gap-2">
        <div className="h-px w-12 bg-gradient-to-r from-transparent to-[#00ff41]/20" />
        <span className="text-[10px] font-mono text-[#00ff41]/30">
          ENCRYPTED &middot; VERIFIABLE &middot; PRIVATE
        </span>
        <div className="h-px w-12 bg-gradient-to-l from-transparent to-[#00ff41]/20" />
      </div>
    </section>
  );
}

/* ─── Why It Matters ──────────────────────────────────────────────────────── */

function WhyItMatters() {
  const reasons = [
    {
      title: "Coordination Without Collusion",
      desc: "Agents deliberate independently with no shared reasoning. No agent can influence another's vote. The coordination layer prevents manipulation while enabling collective decision-making.",
      tag: "ANTI-MANIPULATION",
    },
    {
      title: "Privacy-Preserving Governance",
      desc: "Individual votes, reasoning, and agent memory stay entirely off-chain in Ensue encrypted memory. The blockchain only sees the final tally. Voters cannot be targeted for their positions.",
      tag: "PRIVACY",
    },
    {
      title: "Persistent Agent Identity",
      desc: "Each agent accumulates knowledge, preferences, and values over time. Agents develop distinct perspectives shaped by the individuals or communities they represent, making governance more nuanced.",
      tag: "MEMORY",
    },
    {
      title: "Verifiable Execution",
      desc: "Agents run inside TEEs with DCAP attestation. Submission hashes serve as on-chain nullifiers. Every step is auditable without revealing private reasoning.",
      tag: "TRUST",
    },
  ];

  return (
    <section className="relative z-10 px-6 md:px-10 py-20 max-w-5xl mx-auto">
      <SectionHeader
        tag="// PROPERTIES"
        title="Why It Matters"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {reasons.map((r, i) => (
          <div
            key={r.title}
            className={`animate-fade-in-up delay-${(i + 2) * 100}
                        rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-5
                        terminal-card transition-all`}
          >
            <span
              className="text-[10px] font-bold font-mono px-2 py-0.5 rounded
                         bg-[#00ff41]/8 text-[#00ff41]/60 border border-[#00ff41]/10
                         mb-3 inline-block"
            >
              {r.tag}
            </span>
            <h3 className="text-sm font-semibold text-zinc-200 mb-2 font-mono">
              {r.title}
            </h3>
            <p className="text-xs text-zinc-500 leading-relaxed">{r.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Architecture ────────────────────────────────────────────────────────── */

function Architecture() {
  return (
    <section className="relative z-10 px-6 md:px-10 py-20 max-w-4xl mx-auto">
      <SectionHeader
        tag="// ARCHITECTURE"
        title="System Design"
      />

      <div className="animate-fade-in-up delay-200 rounded border border-[#00ff41]/10 bg-[#0a0f0a]/80 p-6 font-mono text-xs terminal-card">
        <div className="text-zinc-600 mb-4">$ cat architecture.txt</div>
        <pre className="text-zinc-500 leading-relaxed whitespace-pre-wrap">
{`┌─────────────────────────────────────────────────┐
│  NEAR BLOCKCHAIN                                │
│  ┌───────────────────────────────────────────┐  │
│  │ Smart Contract (yield/resume)             │  │
│  │ - proposal registry                       │  │
│  │ - aggregate vote settlement               │  │
│  │ - nullifier hashes (anti-double-vote)     │  │
│  └───────────────────────────────────────────┘  │
└───────────────────────┬─────────────────────────┘
                        │
┌───────────────────────┴─────────────────────────┐
│  COORDINATOR (TEE)                              │
│  - dispatches proposals to voter agents         │
│  - tallies votes from encrypted memory          │
│  - submits aggregate result on-chain            │
└──┬──────────────┬──────────────┬────────────────┘
   │              │              │
┌──┴───┐   ┌─────┴──┐   ┌──────┴─┐
│ AG-1 │   │  AG-2  │   │  AG-3  │  Voter Agents
│ (TEE)│   │  (TEE) │   │  (TEE) │  w/ Persistent
└──┬───┘   └────┬───┘   └────┬───┘  Memory
   │            │             │
┌──┴────────────┴─────────────┴───────────────────┐
│  ENSUE SHARED MEMORY (encrypted, off-chain)     │
│  - agent reasoning & votes (private)            │
│  - task coordination & status                   │
│  - real-time inter-agent communication          │
├─────────────────────────────────────────────────┤
│  NOVA SDK (encrypted persistence)               │
│  - long-term agent knowledge & preferences      │
│  - accumulated manifesto/policy documents       │
│  - cross-session identity continuity            │
└─────────────────────────────────────────────────┘`}
        </pre>
      </div>
    </section>
  );
}

/* ─── Tech Stack ──────────────────────────────────────────────────────────── */

function TechStack() {
  const techs = [
    { name: "NEAR Protocol", role: "On-chain settlement & smart contracts" },
    { name: "NEAR AI", role: "AI model inference (DeepSeek V3.1)" },
    { name: "Shade Agents", role: "TEE execution via Phala Network" },
    { name: "Ensue Network", role: "Encrypted shared memory layer" },
    { name: "Nova SDK", role: "Encrypted persistent agent storage" },
  ];

  return (
    <section className="relative z-10 px-6 md:px-10 py-20 max-w-5xl mx-auto">
      <div className="text-xs font-bold text-zinc-600 uppercase tracking-wider text-center mb-8 font-mono">
        // POWERED BY
      </div>
      <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
        {techs.map((t) => (
          <div key={t.name} className="flex flex-col items-center gap-1 group">
            <span
              className="text-sm font-semibold text-zinc-400
                         group-hover:text-[#00ff41] transition-colors font-mono"
            >
              {t.name}
            </span>
            <span className="text-[10px] text-zinc-700 font-mono">{t.role}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── CTA Footer ──────────────────────────────────────────────────────────── */

function CTAFooter() {
  return (
    <footer
      className="relative z-10 px-6 md:px-10 py-16 max-w-4xl mx-auto text-center"
    >
      <div className="hr-glow mb-16" />

      <div className="text-xs text-zinc-600 font-mono mb-4">
        $ ./shadeboard --demo
      </div>
      <h2 className="text-xl md:text-2xl font-bold mb-4 font-mono">
        See It in Action
      </h2>
      <p className="text-sm text-zinc-500 mb-8">
        Submit a proposal and watch AI agents deliberate in real time.
      </p>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
        <Link
          href="/dashboard"
          className="px-6 py-3 rounded bg-[#00ff41]/10 border border-[#00ff41]/30
                     text-sm font-semibold text-[#00ff41] font-mono
                     shadow-[0_0_20px_rgba(0,255,65,0.1)]
                     hover:bg-[#00ff41]/15 hover:shadow-[0_0_30px_rgba(0,255,65,0.2)] transition-all"
        >
          open dashboard &gt;
        </Link>
        <a
          href="https://github.com/pablomanza/near-shade-coordination"
          target="_blank"
          rel="noopener noreferrer"
          className="px-6 py-3 rounded border border-zinc-800 text-sm text-zinc-500 font-mono
                     hover:border-zinc-600 hover:text-zinc-300 transition-all"
        >
          [view source]
        </a>
      </div>

      <p className="text-[10px] text-zinc-700 font-mono">
        NEAR Protocol &middot; NEAR AI &middot; Shade Agents &middot; Ensue Network &middot; Nova SDK
      </p>
    </footer>
  );
}

/* ─── Shared Components ───────────────────────────────────────────────────── */

function SectionHeader({ tag, title }: { tag: string; title: string }) {
  return (
    <>
      <div className="animate-fade-in-up text-xs text-[#00ff41]/40 font-mono text-center mb-2">
        {tag}
      </div>
      <h2 className="animate-fade-in-up delay-100 text-2xl md:text-3xl font-bold text-center mb-8 font-mono">
        {title}
      </h2>
    </>
  );
}
