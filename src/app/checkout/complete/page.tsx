import Link from 'next/link';

interface CheckoutCompletePageProps {
  searchParams: Promise<{ reference?: string; trxref?: string }>;
}

export default async function CheckoutCompletePage({ searchParams }: CheckoutCompletePageProps) {
  const params = await searchParams;
  const reference = params.reference || params.trxref || 'N/A';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl text-center space-y-6">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 mx-auto">
          <svg
            className="w-8 h-8"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-white">Payment Received</h1>
          <p className="text-sm text-slate-400">
            Paystack test-mode transaction completed. Aftermath fulfillment and verification are processing.
          </p>
        </div>

        <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-3 text-left space-y-1">
          <div className="text-xs text-slate-500 font-mono uppercase tracking-wider">Payment Reference</div>
          <div className="text-sm font-mono text-emerald-400 break-all select-all font-semibold">
            {reference}
          </div>
        </div>

        <div className="pt-2">
          <Link
            href="/"
            className="inline-flex items-center justify-center w-full px-4 py-2.5 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors duration-150 shadow-sm"
          >
            Return to Operator Console
          </Link>
        </div>
      </div>
    </div>
  );
}
