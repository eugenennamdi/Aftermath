import { config } from 'dotenv';
// Load environment variables (.env.local has precedence over .env)
config({ path: '.env.local' });
config({ path: '.env' });

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgresql://apple@localhost:5432/aftermath';

// Connection client for queries
export const queryClient = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 5, // 5-second bounded connection timeout
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
    return `${isLocal ? 'LOCAL' : 'REMOTE'} (${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname})`;
  } catch {
    return 'UNKNOWN_TARGET';
  }
}
