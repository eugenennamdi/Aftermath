export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 bg-zinc-950 text-zinc-100">
      <div className="max-w-2xl w-full p-8 rounded-lg border border-zinc-800 bg-zinc-900/50 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center space-x-3">
            <span className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
            <h1 className="text-xl font-semibold tracking-tight">Aftermath</h1>
          </div>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
            Phase 0 Foundation
          </span>
        </div>

        <p className="text-sm text-zinc-400 leading-relaxed">
          Autonomous recovery for broken business operations. Aftermath reconciles and resolves
          payment-to-entitlement inconsistencies with deterministic safety guarantees.
        </p>

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="p-4 rounded border border-zinc-800 bg-zinc-950/60">
            <div className="text-xs font-mono text-zinc-500">ENGINE RUNTIME</div>
            <div className="text-sm font-medium text-zinc-200 mt-1">Railway Web + Node Worker</div>
          </div>
          <div className="p-4 rounded border border-zinc-800 bg-zinc-950/60">
            <div className="text-xs font-mono text-zinc-500">OBSERVABILITY</div>
            <div className="text-sm font-medium text-zinc-200 mt-1">neatlogs TS SDK</div>
          </div>
        </div>

        <div className="pt-4 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-500 font-mono">
          <span>neatHack 2026</span>
          <span>Awaiting Phase 1 Authorization</span>
        </div>
      </div>
    </main>
  );
}
