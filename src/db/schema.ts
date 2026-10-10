import { pgTable, varchar, integer, timestamp, text, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// System Health Table (from Phase 0)
export const systemChecks = pgTable('system_checks', {
  id: varchar('id', { length: 64 }).primaryKey(),
  component: varchar('component', { length: 64 }).notNull(),
  status: varchar('status', { length: 32 }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow().notNull(),
});

// 1. Subscription Plans Catalog (Trusted authoritative pricing & entitlement duration)
export const subscriptionPlans = pgTable('subscription_plans', {
  id: varchar('id', { length: 64 }).primaryKey(), // e.g. 'plan_starter', 'plan_pro'
  name: varchar('name', { length: 128 }).notNull(),
  description: text('description'),
  amount: integer('amount').notNull(), // Minor units / kobo (e.g., 500000 = 5,000 NGN)
  currency: varchar('currency', { length: 3 }).notNull().default('NGN'),
  durationDays: integer('duration_days').notNull().default(30),
  isActive: varchar('is_active', { length: 16 }).notNull().default('true'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// 2. Customers
export const customers = pgTable('customers', {
  id: varchar('id', { length: 64 }).primaryKey(), // e.g. 'cus_...'
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 3. Orders (Immutable server-created source of truth for transactions)
export const orders = pgTable('orders', {
  id: varchar('id', { length: 64 }).primaryKey(), // e.g. 'ord_...'
  customerId: varchar('customer_id', { length: 64 }).notNull().references(() => customers.id),
  planId: varchar('plan_id', { length: 64 }).notNull().references(() => subscriptionPlans.id),
  paymentReference: varchar('payment_reference', { length: 128 }).notNull().unique(),
  expectedAmount: integer('expected_amount').notNull(), // Minor units (kobo)
  currency: varchar('currency', { length: 3 }).notNull().default('NGN'),
  // Explicit finite states: 'PENDING' | 'PAID' | 'FULFILLED' | 'FAILED' | 'CANCELLED'
  status: varchar('status', { length: 32 }).notNull().default('PENDING'),
  paystackAccessCode: varchar('paystack_access_code', { length: 128 }),
  paystackAuthorizationUrl: text('paystack_authorization_url'),
  paidAt: timestamp('paid_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('orders_status_created_idx').on(table.status, table.createdAt),
]);

// 4. Payment Events (Immutable log of webhook & verification events)
export const paymentEvents = pgTable('payment_events', {
  id: varchar('id', { length: 64 }).primaryKey(), // e.g. 'evt_...'
  orderId: varchar('order_id', { length: 64 }).references(() => orders.id),
  paymentReference: varchar('payment_reference', { length: 128 }).notNull(),
  eventType: varchar('event_type', { length: 64 }).notNull(), // e.g. 'charge.success'
  status: varchar('status', { length: 32 }).notNull(), // 'success' | 'failed'
  amount: integer('amount').notNull(), // Minor units
  currency: varchar('currency', { length: 3 }).notNull(),
  customerEmail: varchar('customer_email', { length: 255 }).notNull(),
  channel: varchar('channel', { length: 32 }),
  gatewayResponse: text('gateway_response'),
  payloadHash: varchar('payload_hash', { length: 64 }).notNull(), // SHA-256 hash (never store unredacted secrets)
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('payment_events_ref_event_idx').on(table.paymentReference, table.eventType),
]);

// 5. Entitlements (Authoritative active customer SaaS access)
export const entitlements = pgTable('entitlements', {
  id: varchar('id', { length: 64 }).primaryKey(), // e.g. 'ent_...'
  orderId: varchar('order_id', { length: 64 }).notNull().unique().references(() => orders.id),
  customerId: varchar('customer_id', { length: 64 }).notNull().references(() => customers.id),
  planId: varchar('plan_id', { length: 64 }).notNull().references(() => subscriptionPlans.id),
  sourceReference: varchar('source_reference', { length: 128 }).notNull().unique(),
  // Status: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
  status: varchar('status', { length: 32 }).notNull().default('ACTIVE'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 6. Recovery Incidents (Identified discrepancies requiring investigation/recovery)
export const incidents = pgTable('incidents', {
  id: varchar('id', { length: 64 }).primaryKey(), // e.g. 'inc_...'
  orderId: varchar('order_id', { length: 64 }).notNull().unique().references(() => orders.id),
  paymentReference: varchar('payment_reference', { length: 128 }).notNull().references(() => orders.paymentReference),
  customerId: varchar('customer_id', { length: 64 }).notNull().references(() => customers.id),
  // Finite states: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'ESCALATED' | 'DISMISSED'
  status: varchar('status', { length: 32 }).notNull().default('OPEN'),
  reason: varchar('reason', { length: 64 }).notNull(), // 'PAID_BUT_UNFULFILLED' | 'FULFILLMENT_FAILED' | 'VERIFICATION_MISMATCH'
  fencingToken: integer('fencing_token').notNull().default(0),
  leaseOwner: varchar('lease_owner', { length: 128 }),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  retryCount: integer('retry_count').notNull().default(0),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
  lastDecision: varchar('last_decision', { length: 64 }), // 'PROPOSE_RECOVERY' | 'RECONCILE_EXISTING' | 'RETRY_LATER' | 'ESCALATE'
  decisionSummary: text('decision_summary'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  errorDetail: text('error_detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('incidents_status_retry_idx').on(table.status, table.nextRetryAt),
]);

// 7. Audit Logs (Immutable trail of state changes and recovery actions)
export const auditLogs = pgTable('audit_logs', {
  id: varchar('id', { length: 64 }).primaryKey(), // e.g. 'aud_...'
  orderId: varchar('order_id', { length: 64 }),
  incidentId: varchar('incident_id', { length: 64 }),
  action: varchar('action', { length: 64 }).notNull(),
  actor: varchar('actor', { length: 64 }).notNull(), // 'SYSTEM' | 'WEBHOOK' | 'RECOVERY_WORKER'
  details: text('details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Drizzle Relations
export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
  entitlements: many(entitlements),
  incidents: many(incidents),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [orders.planId],
    references: [subscriptionPlans.id],
  }),
  entitlement: one(entitlements, {
    fields: [orders.id],
    references: [entitlements.orderId],
  }),
  incident: one(incidents, {
    fields: [orders.id],
    references: [incidents.orderId],
  }),
  paymentEvents: many(paymentEvents),
}));

export const entitlementsRelations = relations(entitlements, ({ one }) => ({
  order: one(orders, {
    fields: [entitlements.orderId],
    references: [orders.id],
  }),
  customer: one(customers, {
    fields: [entitlements.customerId],
    references: [customers.id],
  }),
  plan: one(subscriptionPlans, {
    fields: [entitlements.planId],
    references: [subscriptionPlans.id],
  }),
}));

export const incidentsRelations = relations(incidents, ({ one }) => ({
  order: one(orders, {
    fields: [incidents.orderId],
    references: [orders.id],
  }),
  customer: one(customers, {
    fields: [incidents.customerId],
    references: [customers.id],
  }),
}));
