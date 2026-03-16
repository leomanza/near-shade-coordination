import Link from "next/link";

export default function BuyPage() {
  return (
    <div className="min-h-screen bg-[#050505] p-6 md:p-10 max-w-3xl mx-auto">
      <div className="fixed inset-0 cyber-grid pointer-events-none" />
      <div className="fixed inset-0 scanlines pointer-events-none opacity-30" />

      <div className="relative z-10">
        {/* Header */}
        <header className="mb-10">
          <Link
            href="/"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity mb-2"
          >
            <img src="/logo-iso.svg" alt="Delibera" className="h-8 w-8" />
            <h1 className="text-xl font-bold text-zinc-100 font-mono">
              Delibera
            </h1>
          </Link>
          <p className="text-sm text-zinc-500 font-mono">
            Join the Network
          </p>
        </header>

        {/* Role selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Worker */}
          <Link href="/buy/worker" className="group block">
            <div className="h-full rounded border border-zinc-800 bg-[#0a0f0a]/80 p-6 terminal-card hover:border-[#00ff41]/30 transition-colors">
              <div className="mb-4 text-2xl">&#x1F5F3;</div>
              <h2 className="text-base font-semibold text-zinc-100 font-mono mb-2">
                Worker
              </h2>
              <p className="text-xs text-zinc-400 font-mono mb-4 leading-relaxed">
                Vote on governance proposals on behalf of token holders. Runs
                in a Phala TEE, earns rewards for honest participation.
              </p>
              <div className="text-[10px] text-zinc-600 font-mono mb-4">
                Deposit: 0.1 NEAR
              </div>
              <div className="inline-flex items-center gap-1 text-[11px] text-[#00ff41] font-mono group-hover:gap-2 transition-all">
                Deploy Worker <span>&#x2192;</span>
              </div>
            </div>
          </Link>

          {/* Coordinator */}
          <Link href="/buy/coordinator" className="group block">
            <div className="h-full rounded border border-zinc-800 bg-[#0a0f0a]/80 p-6 terminal-card hover:border-[#00ff41]/30 transition-colors">
              <div className="mb-4 text-2xl">&#x1F3DB;</div>
              <h2 className="text-base font-semibold text-zinc-100 font-mono mb-2">
                Coordinator
              </h2>
              <p className="text-xs text-zinc-400 font-mono mb-4 leading-relaxed">
                Run a coordination network for a DAO or community. Manages a
                pool of workers, aggregates votes, and publishes results
                on-chain.
              </p>
              <div className="text-[10px] text-zinc-600 font-mono mb-4">
                Deposit: 0.1 NEAR
              </div>
              <div className="inline-flex items-center gap-1 text-[11px] text-[#00ff41] font-mono group-hover:gap-2 transition-all">
                Deploy Coordinator <span>&#x2192;</span>
              </div>
            </div>
          </Link>
        </div>

        <footer className="mt-10 text-center text-[10px] text-zinc-700 font-mono">
          NEAR Protocol &middot; Phala TEE &middot; Storacha &middot; Ensue
          Network
        </footer>
      </div>
    </div>
  );
}
