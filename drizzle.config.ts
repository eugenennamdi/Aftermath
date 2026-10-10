import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// Load local environment overrides in non-production
if (process.env.NODE_ENV !== 'production') {
  config({ path: '.env.local' });
  config({ path: '.env' });
}

// Prefer direct migration connection (unpooled) for DDL operations on Neon
const baseDbUrl = process.env.MIGRATION_DATABASE_URL || process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
const migrationUrl = baseDbUrl && baseDbUrl.includes('-pooler.')
  ? baseDbUrl.replace('-pooler.', '.')
  : (baseDbUrl || 'postgresql://postgres:password@localhost:5432/aftermath_db');

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: migrationUrl,
  },
});
