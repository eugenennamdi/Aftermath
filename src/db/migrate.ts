import path from 'node:path';
import { config } from 'dotenv';

// Load environment variables in non-production
if (process.env.NODE_ENV !== 'production') {
  config({ path: '.env.local' });
  config({ path: '.env' });
}

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

/**
 * Resolves the appropriate unpooled direct connection URL for Neon migrations.
 * In Neon, PgBouncer pooler URLs contain '-pooler.'; direct migration connections
 * connect directly to the compute instance without transaction pooling.
 */
export function resolveMigrationUrl(): string {
  const directOverride = process.env.MIGRATION_DATABASE_URL || process.env.DIRECT_DATABASE_URL;
  if (directOverride) {
    return directOverride;
  }

  const baseDbUrl = process.env.DATABASE_URL;
  if (!baseDbUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[Migration Error] DATABASE_URL or MIGRATION_DATABASE_URL is required in production.'
      );
    }
    return 'postgresql://apple@localhost:5432/aftermath';
  }

  // Automatically derive unpooled direct connection for Neon
  if (baseDbUrl.includes('-pooler.')) {
    return baseDbUrl.replace('-pooler.', '.');
  }

  return baseDbUrl;
}

function sanitizeUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const isNeon = parsed.hostname.includes('neon.tech');
    const type = isNeon ? 'REMOTE NEON DIRECT' : isLocal ? 'LOCAL' : 'REMOTE';
    return `${type} (${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname})`;
  } catch {
    return 'UNKNOWN_TARGET';
  }
}

export async function runMigrations() {
  const migrationUrl = resolveMigrationUrl();
  console.log('================================================================================');
  console.log('AFTERMATH DATABASE MIGRATION RUNNER');
  console.log(`Target: ${sanitizeUrl(migrationUrl)}`);
  console.log('================================================================================');

  // Single dedicated connection for DDL execution
  const migrationClient = postgres(migrationUrl, {
    max: 1,
    connect_timeout: 10,
    ssl: migrationUrl.includes('sslmode=require') || migrationUrl.includes('neon.tech') ? 'require' : undefined,
  });

  try {
    const migrationDb = drizzle(migrationClient);
    const migrationsFolder = path.resolve(process.cwd(), './drizzle');

    console.log(`[Migrate] Applying migrations from: ${migrationsFolder}`);
    await migrate(migrationDb, { migrationsFolder });
    console.log('✓ [Migrate] All migrations applied successfully.');
  } finally {
    await migrationClient.end();
  }
}

// Auto-run if executed directly via CLI
if (process.argv[1]?.includes('migrate')) {
  runMigrations()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Migration Failed]:', err);
      process.exit(1);
    });
}
