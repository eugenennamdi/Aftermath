import { pgTable, varchar, timestamp } from 'drizzle-orm/pg-core';

// Phase 0 System Health / Verification Table
// Full business schema (orders, entitlements, incidents) is deferred to Phase 1 per acceptance contract.
export const systemChecks = pgTable('system_checks', {
  id: varchar('id', { length: 64 }).primaryKey(),
  component: varchar('component', { length: 64 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
});
