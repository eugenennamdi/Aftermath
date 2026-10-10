import crypto from 'node:crypto';
import { eq, and, sql, lt, isNull } from 'drizzle-orm';
import { db } from '../db';
import { incidents, orders, entitlements, auditLogs } from '../db/schema';

export interface CreateIncidentParams {
  orderId: string;
  paymentReference: string;
  customerId: string;
  reason: 'PAID_BUT_UNFULFILLED' | 'FULFILLMENT_FAILED' | 'VERIFICATION_MISMATCH';
  errorDetail?: string;
}

/**
 * Creates or retrieves an existing durable incident for a discrepant order.
 * Guarantees that one logical order never creates multiple competing incidents.
 */
export async function createOrGetIncident(params: CreateIncidentParams) {
  // 1. Check if incident already exists for this order
  const [existing] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.orderId, params.orderId))
    .limit(1);

  if (existing) {
    // If already exists and open/investigating, return existing
    return {
      incident: existing,
      isNew: false,
    };
  }

  const incidentId = `inc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  try {
    const [created] = await db
      .insert(incidents)
      .values({
        id: incidentId,
        orderId: params.orderId,
        paymentReference: params.paymentReference,
        customerId: params.customerId,
        status: 'OPEN',
        reason: params.reason,
        errorDetail: params.errorDetail || null,
      })
      .returning();

    // Record audit event
    await db.insert(auditLogs).values({
      id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      orderId: params.orderId,
      incidentId: created.id,
      action: 'INCIDENT_CREATED',
      actor: 'SYSTEM',
      details: `Incident opened: reason=${params.reason}, details=${params.errorDetail || 'none'}`,
    });

    return {
      incident: created,
      isNew: true,
    };
  } catch (err) {
    const msg = (err as Error).message || String(err);
    // If race condition hit unique constraint on order_id, re-fetch existing
    if (msg.includes('unique') || msg.includes('duplicate')) {
      const [raced] = await db
        .select()
        .from(incidents)
        .where(eq(incidents.orderId, params.orderId))
        .limit(1);

      if (raced) {
        return {
          incident: raced,
          isNew: false,
        };
      }
    }

    throw err;
  }
}

/**
 * 1. Bounded pending-order reconciliation query.
 * Detects orders created in the past that have remained in PENDING status
 * (e.g. dropped webhooks, closed checkout tabs where payment succeeded).
 * A webhook is NOT necessary for eventual discovery: sweeping these orders
 * with Paystack transaction verification discovers completed payments directly.
 */
export async function getPendingOrdersForReconciliation(
  olderThanMinutes: number = 5,
  limit: number = 50
) {
  const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000);

  const pendingList = await db
    .select()
    .from(orders)
    .where(
      and(
        eq(orders.status, 'PENDING'),
        lt(orders.createdAt, cutoffTime)
      )
    )
    .orderBy(orders.createdAt)
    .limit(limit);

  return pendingList;
}

/**
 * 2. Paid-but-unfulfilled orders query.
 * Discovers orders marked PAID whose fulfillment was interrupted, crashed,
 * or never executed, having NO active entitlement row in entitlements.
 */
export async function getPaidUnfulfilledOrders(limit: number = 50) {
  const unfulfilled = await db
    .select({
      order: orders,
    })
    .from(orders)
    .leftJoin(entitlements, eq(orders.id, entitlements.orderId))
    .where(
      and(
        eq(orders.status, 'PAID'),
        isNull(entitlements.id)
      )
    )
    .orderBy(orders.updatedAt)
    .limit(limit);

  return unfulfilled.map((r) => r.order);
}

/**
 * 3. Retrieves open recovery incidents awaiting worker investigation.
 */
export async function getOpenIncidents(limit: number = 50) {
  return db
    .select()
    .from(incidents)
    .where(eq(incidents.status, 'OPEN'))
    .orderBy(incidents.createdAt)
    .limit(limit);
}
