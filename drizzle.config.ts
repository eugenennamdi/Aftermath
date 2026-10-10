import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// Load local environment overrides
config({ path: '.env.local' });
config({ path: '.env' });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/aftermath_db',
  },
});
