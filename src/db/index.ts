import { config } from 'dotenv';
// Load environment variables (.env.local has precedence over .env)
// Strictly skipped in production to prevent local files from overriding container environment
if (process.env.NODE_ENV !== 'production') {
  config({ path: '.env.local' });
  config({ path: '.env' });
}

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Require explicit DATABASE_URL in production; never silently fall back to localhost
if (process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
  throw new Error(
    '[Database Configuration Error] DATABASE_URL environment variable is required in production. Silent fallback to localhost is forbidden.'
  );
}

// Safety guard: refuse to run test suite against live remote Neon or Railway databases
if (
  process.env.NODE_ENV === 'test' &&
  process.env.DATABASE_URL &&
  (process.env.DATABASE_URL.includes('neon.tech') ||
    process.env.DATABASE_URL.includes('rlwy.net') ||
    process.env.DATABASE_URL.includes('railway'))
) {
  throw new Error(
    '[Safety Guard] Refusing to run tests against remote production database (Neon/Railway). Tests must run only against local or isolated test environments.'
  );
}

const connectionString = process.env.DATABASE_URL || 'postgresql://apple@localhost:5432/aftermath';

// Reduced connection pool size for Neon Free tier & single-container Railway memory constraints
const maxConnections = Number(
  process.env.DB_MAX_CONNECTIONS || (process.env.NODE_ENV === 'production' ? 4 : 10)
);

// Connection client for queries
export const queryClient = postgres(connectionString, {
  max: maxConnections,
  idle_timeout: 20,
  connect_timeout: 5, // 5-second bounded connection timeout
  ssl: connectionString.includes('sslmode=require') || connectionString.includes('neon.tech') ? 'require' : undefined,
});

export const db = drizzle(queryClient, { schema });

/**
 * Bounded PostgreSQL connection test
 * Resolves with true if connection succeeds, throws if failed or timed out.
 */
export async function verifyDatabaseConnection(timeoutMs: number = 5000): Promise<{ connected: boolean; error?: string }> {
  try {
    const testClient = postgres(connectionString, {
      max: 1,
      connect_timeout: Math.ceil(timeoutMs / 1000),
      ssl: connectionString.includes('sslmode=require') || connectionString.includes('neon.tech') ? 'require' : undefined,
    });

    // Execute simple ping query
    await testClient`SELECT 1 as ping`;
    await testClient.end();
    return { connected: true };
  } catch (err) {
    return {
      connected: false,
      error: (err as Error).message,
    };
  }
}

/**
 * Returns a sanitized descriptor of the target database host and name.
 * Safe for logging; never includes credentials or passwords.
 */
export function getSanitizedDatabaseTarget(): string {
  try {
    const raw = process.env.DATABASE_URL || 'postgresql://apple@localhost:5432/aftermath';
    const parsed = new URL(raw);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const isNeon = parsed.hostname.includes('neon.tech');
    const type = isNeon ? 'REMOTE NEON' : isLocal ? 'LOCAL' : 'REMOTE';
    return `${type} (${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname})`;
  } catch {
    return 'UNKNOWN_TARGET';
  }
}
