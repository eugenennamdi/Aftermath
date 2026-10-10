/**
 * Aftermath Single-Service Process Supervisor
 * 
 * Manages both the Next.js web console and the autonomous background recovery worker
 * within a single Railway container, respecting Railway Free Trial's 512 MB RAM limit.
 * 
 * Invariants:
 * - Pure Node.js standard library (YAGNI: no heavy third-party process managers).
 * - Process isolation: web crashes trigger container restarts; worker crashes are restarted with backoff.
 * - Memory bounds: sets V8 --max-old-space-size to keep combined RSS comfortably under 512 MB.
 * - Graceful shutdown: traps SIGTERM/SIGINT, cleanly terminates children, flushes telemetry.
 */

import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';

const PORT = process.env.PORT || '3000';
const DISABLE_WORKER = process.env.DISABLE_WORKER === 'true';

const MAX_WORKER_RESTARTS = 5;
const WORKER_RESTART_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const WORKER_RESTART_BACKOFF_MS = 2000; // 2 seconds

let webProcess: ChildProcess | null = null;
let workerProcess: ChildProcess | null = null;
let isShuttingDown = false;

const workerRestartTimestamps: number[] = [];

console.log('================================================================================');
console.log('AFTERMATH SINGLE-SERVICE SUPERVISOR');
console.log(`Port:             ${PORT}`);
console.log(`Node Version:     ${process.version}`);
console.log(`Worker Enabled:   ${!DISABLE_WORKER}`);
console.log(`Environment:      ${process.env.NODE_ENV || 'development'}`);
console.log('================================================================================');

// Validate critical production requirements early
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  console.error('[Supervisor FATAL] DATABASE_URL is not set in production. Refusing to start.');
  process.exit(1);
}

/**
 * Spawns the Next.js production web server with memory bounding.
 */
function startWeb(): ChildProcess {
  console.log('[Supervisor] Spawning Next.js web application server...');

  const nextBinPath = path.resolve(process.cwd(), 'node_modules/next/dist/bin/next');

  const child = spawn(
    process.execPath,
    ['--max-old-space-size=200', nextBinPath, 'start', '-p', PORT],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT,
      },
      stdio: 'inherit',
    }
  );

  console.log(`[Supervisor] Web server started (PID: ${child.pid}) on port ${PORT}.`);

  child.on('exit', (code, signal) => {
    if (isShuttingDown) {
      console.log(`[Supervisor] Web process exited cleanly (code: ${code}, signal: ${signal}).`);
      return;
    }

    console.error(`[Supervisor CRITICAL] Web process terminated unexpectedly (code: ${code}, signal: ${signal}).`);
    // Web is primary ingress; if it crashes, shut down container to let Railway restart fresh
    gracefulShutdown('WEB_CRASH', 1);
  });

  child.on('error', (err) => {
    console.error('[Supervisor] Failed to spawn web process:', err);
    if (!isShuttingDown) {
      gracefulShutdown('WEB_SPAWN_ERROR', 1);
    }
  });

  return child;
}

/**
 * Spawns the persistent background recovery worker with memory bounding.
 */
function startWorker(): ChildProcess {
  console.log('[Supervisor] Spawning autonomous recovery worker...');

  const workerScript = path.resolve(process.cwd(), 'src/worker/index.ts');

  const child = spawn(
    process.execPath,
    ['--max-old-space-size=160', '--import', 'tsx', workerScript],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
      stdio: 'inherit',
    }
  );

  console.log(`[Supervisor] Recovery worker started (PID: ${child.pid}).`);

  child.on('exit', (code, signal) => {
    if (isShuttingDown) {
      console.log(`[Supervisor] Worker process exited cleanly (code: ${code}, signal: ${signal}).`);
      return;
    }

    console.warn(`[Supervisor WARNING] Worker process exited (code: ${code}, signal: ${signal}).`);

    // Prune old restart timestamps outside sliding window
    const now = Date.now();
    while (
      workerRestartTimestamps.length > 0 &&
      now - workerRestartTimestamps[0] > WORKER_RESTART_WINDOW_MS
    ) {
      workerRestartTimestamps.shift();
    }

    workerRestartTimestamps.push(now);

    if (workerRestartTimestamps.length > MAX_WORKER_RESTARTS) {
      console.error(
        `[Supervisor CRITICAL] Worker crashed ${workerRestartTimestamps.length} times within ${WORKER_RESTART_WINDOW_MS / 60000}m. Triggering container restart.`
      );
      gracefulShutdown('WORKER_CRASH_LOOP', 1);
      return;
    }

    console.log(
      `[Supervisor] Restarting worker in ${WORKER_RESTART_BACKOFF_MS}ms (attempt ${workerRestartTimestamps.length}/${MAX_WORKER_RESTARTS})...`
    );

    setTimeout(() => {
      if (!isShuttingDown) {
        workerProcess = startWorker();
      }
    }, WORKER_RESTART_BACKOFF_MS);
  });

  child.on('error', (err) => {
    console.error('[Supervisor] Worker spawn error:', err);
  });

  return child;
}

/**
 * Handles graceful termination of both children upon SIGTERM/SIGINT or fatal child crash.
 */
function gracefulShutdown(reason: string, exitCode = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Supervisor] Initiating graceful shutdown (Reason: ${reason})...`);

  const processesToKill = [
    { name: 'Worker', proc: workerProcess },
    { name: 'Web', proc: webProcess },
  ];

  // Send SIGTERM to children
  for (const { name, proc } of processesToKill) {
    if (proc && !proc.killed) {
      console.log(`[Supervisor] Sending SIGTERM to ${name} (PID: ${proc.pid})...`);
      try {
        proc.kill('SIGTERM');
      } catch (err) {
        console.error(`[Supervisor] Error sending SIGTERM to ${name}:`, err);
      }
    }
  }

  // Safety fallback: if children do not exit within 8 seconds, send SIGKILL
  const forceKillTimer = setTimeout(() => {
    console.warn('[Supervisor WARNING] Children did not terminate within 8s. Force killing with SIGKILL...');
    for (const { name, proc } of processesToKill) {
      if (proc && !proc.killed) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // Ignore
        }
      }
    }
    process.exit(exitCode);
  }, 8000);

  // Poll for child termination
  const checkTerminationInterval = setInterval(() => {
    const allTerminated = processesToKill.every(
      ({ proc }) => !proc || proc.killed || proc.exitCode !== null
    );

    if (allTerminated) {
      clearInterval(checkTerminationInterval);
      clearTimeout(forceKillTimer);
      console.log('[Supervisor] All child processes terminated. Supervisor exiting cleanly.');
      process.exit(exitCode);
    }
  }, 250);
}

// Trap signals from Railway orchestrator
process.on('SIGTERM', () => gracefulShutdown('SIGTERM (Railway Container Stop)', 0));
process.on('SIGINT', () => gracefulShutdown('SIGINT', 0));

// Start services
webProcess = startWeb();

if (!DISABLE_WORKER) {
  workerProcess = startWorker();
} else {
  console.log('[Supervisor] Background recovery worker disabled via DISABLE_WORKER=true.');
}

// Periodic supervisor heartbeat
setInterval(() => {
  if (isShuttingDown) return;
  const memory = process.memoryUsage();
  console.log(
    `[Supervisor Heartbeat] Running | Web PID: ${webProcess?.pid || 'none'} | Worker PID: ${workerProcess?.pid || 'none'} | Supervisor RSS: ${Math.round(memory.rss / 1024 / 1024)}MB`
  );
}, 60000);
