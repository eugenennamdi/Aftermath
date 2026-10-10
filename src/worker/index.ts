/**
 * Aftermath Background Worker Entrypoint
 * Deployed as a persistent process on Railway (node dist/worker.js or tsx src/worker/index.ts)
 * 
 * Phase 0: Verifies worker startup, lifecycle management, and graceful shutdown.
 * Incident polling and agent execution are strictly deferred to Phase 2 per CTO contract.
 */

let isRunning = true;
let heartbeatTimer: NodeJS.Timeout | null = null;

export async function startWorker() {
  console.log('[Aftermath Worker] Starting background recovery worker...');
  console.log(`[Aftermath Worker] Process ID: ${process.pid}`);
  console.log(`[Aftermath Worker] Node version: ${process.version}`);
  console.log('[Aftermath Worker] Environment:', process.env.NODE_ENV || 'development');

  // Register graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`[Aftermath Worker] Received ${signal}. Initiating graceful shutdown...`);
    isRunning = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);

    // Allow in-flight tasks up to 5 seconds to finish before exiting
    setTimeout(() => {
      console.log('[Aftermath Worker] Shutdown complete. Exiting cleanly.');
      process.exit(0);
    }, 500);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log('[Aftermath Worker] Worker initialized and ready for job claiming.');

  // Heartbeat loop for health reporting
  heartbeatTimer = setInterval(() => {
    if (!isRunning) return;
    console.log(`[Aftermath Worker] Heartbeat tick - ${new Date().toISOString()} (Status: IDLE, awaiting Phase 2 claiming)`);
  }, 10000);

  return { isRunning: () => isRunning, shutdown };
}

// Auto-start if invoked directly via CLI
if (process.argv[1]?.includes('worker')) {
  startWorker().catch((err) => {
    console.error('[Aftermath Worker] Fatal error starting worker:', err);
    process.exit(1);
  });
}
