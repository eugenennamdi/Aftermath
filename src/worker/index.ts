/**
 * Aftermath Background Worker Entrypoint
 * Deployed as a persistent process on Railway (node dist/worker.js or tsx src/worker/index.ts)
 * 
 * Phase 2: Active autonomous recovery worker loop, SKIP LOCKED claiming,
 * and continuous incident reconciliation.
 */

import { config } from 'dotenv';
// Load environment variables (.env.local has precedence over .env)
config({ path: '.env.local' });
config({ path: '.env' });

import { recoveryWorker } from './recovery-worker';

let isRunning = true;
let heartbeatTimer: NodeJS.Timeout | null = null;

export async function startWorker() {
  console.log('[Aftermath Worker] Starting background recovery worker...');
  console.log(`[Aftermath Worker] Process ID: ${process.pid}`);
  console.log(`[Aftermath Worker] Node version: ${process.version}`);
  console.log(`[Aftermath Worker] Worker ID: ${recoveryWorker.workerId}`);
  console.log('[Aftermath Worker] Environment:', process.env.NODE_ENV || 'development');

  // Start continuous recovery loop
  await recoveryWorker.start();

  // Register graceful shutdown handlers
  const shutdown = async (signal: string) => {
    console.log(`[Aftermath Worker] Received ${signal}. Initiating graceful shutdown...`);
    isRunning = false;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await recoveryWorker.stop();

    setTimeout(() => {
      console.log('[Aftermath Worker] Shutdown complete. Exiting cleanly.');
      process.exit(0);
    }, 500);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log('[Aftermath Worker] Worker initialized and actively claiming recovery jobs.');

  // Heartbeat loop for health reporting
  heartbeatTimer = setInterval(() => {
    if (!isRunning) return;
    const status = recoveryWorker.getStatus();
    console.log(
      `[Aftermath Worker] Heartbeat tick - ${new Date().toISOString()} (Worker: ${status.workerId}, Processing: ${status.isProcessing})`
    );
  }, 15000);

  return { isRunning: () => isRunning, shutdown, worker: recoveryWorker };
}

// Auto-start if invoked directly via CLI
if (process.argv[1]?.includes('worker')) {
  startWorker().catch((err) => {
    console.error('[Aftermath Worker] Fatal error starting worker:', err);
    process.exit(1);
  });
}
