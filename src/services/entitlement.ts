import crypto from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { entitlements, orders, subscriptionPlans, customers, auditLogs } from '../db/schema';
import { faultInjector } from './fault-injector';

export type ProvisionOutcome =
  | {
      success: true;
      entitlement: typeof entitlements.$inferSelect;
    }
  | {
      success: false;
      code: 'ORDER_NOT_FOUND' | 'ORDER_NOT_PAID' | 'ALREADY_FULFILLED' | 'PROVISIONING_FAILED' | 'INJECTED_FAILURE';
      error: string;
    };

export interface ProvisionOptions {
  // Phase 2 hook seam: enables deterministic transient failure injection without rewriting domain logic
  _injectFailure?: (stage: 'PRE_INSERT' | 'POST_INSERT') => void;
}

/**
 * Legitimate SaaS Entitlement Service
 * Provisions entitlement strictly against verified orders, guaranteed idempotent at DB level.
 */
export class EntitlementService {
  /**
   * Provisions a SaaS entitlement for a paid order.
   */
  public async provisionEntitlement(
    orderId: string,
    sourceReference: string,
    options?: ProvisionOptions
  ): Promise<ProvisionOutcome> {
    // 1. Authoritative order lookup
    const [orderData] = await db
      .select({
        order: orders,
        plan: subscriptionPlans,
        customer: customers,
      })
      .from(orders)
      .innerJoin(subscriptionPlans, eq(orders.planId, subscriptionPlans.id))
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!orderData) {
      return {
        success: false,
        code: 'ORDER_NOT_FOUND',
        error: `Order "${orderId}" not found.`,
      };
    }

    const { order, plan, customer } = orderData;

    // Order must be marked PAID or FULFILLED
    if (order.status !== 'PAID' && order.status !== 'FULFILLED') {
      return {
        success: false,
        code: 'ORDER_NOT_PAID',
        error: `Order "${orderId}" is not in PAID state (current: "${order.status}").`,
      };
    }

    // 2. Existing entitlement check (fast-path idempotency)
    const [existing] = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, order.id))
      .limit(1);

    if (existing) {
      return {
        success: false,
        code: 'ALREADY_FULFILLED',
        error: `Order "${orderId}" already has an active entitlement (${existing.id}).`,
      };
    }

    // Server-side fault injection check (Pre-mutation)
    faultInjector.checkPreMutation(order.id);

    // Optional custom seam for deterministic failure injection
    if (options?._injectFailure) {
      try {
        options._injectFailure('PRE_INSERT');
      } catch (injectionError) {
        await db.insert(auditLogs).values({
          id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
          orderId: order.id,
          action: 'FULFILLMENT_FAILED_SIMULATED',
          actor: 'SYSTEM',
          details: (injectionError as Error).message,
        });

        return {
          success: false,
          code: 'INJECTED_FAILURE',
          error: (injectionError as Error).message,
        };
      }
    }

    // 3. Calculate fixed duration
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
    const entitlementId = `ent_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    try {
      // Execute entitlement creation and order status update
      const [createdEntitlement] = await db
        .insert(entitlements)
        .values({
          id: entitlementId,
          orderId: order.id,
          customerId: customer.id,
          planId: plan.id,
          sourceReference,
          status: 'ACTIVE',
          startedAt,
          expiresAt,
        })
        .returning();

      // Update order to FULFILLED
      await db
        .update(orders)
        .set({
          status: 'FULFILLED',
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      // Server-side fault injection check (Post-commit ambiguous drop)
      faultInjector.checkPostCommit(order.id);

      // Record audit log
      await db.insert(auditLogs).values({
        id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        orderId: order.id,
        action: 'FULFILLMENT_SUCCEEDED',
        actor: 'SYSTEM',
        details: `Entitlement ${createdEntitlement.id} provisioned until ${expiresAt.toISOString()}`,
      });

      return {
        success: true,
        entitlement: createdEntitlement,
      };
    } catch (err) {
      const errorMsg = (err as Error).message || String(err);

      // Handle duplicate key error at database level
      if (errorMsg.includes('unique') || errorMsg.includes('duplicate')) {
        return {
          success: false,
          code: 'ALREADY_FULFILLED',
          error: 'Unique constraint conflict: entitlement already created for order or reference.',
        };
      }

      await db.insert(auditLogs).values({
        id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        orderId: order.id,
        action: 'FULFILLMENT_FAILED',
        actor: 'SYSTEM',
        details: errorMsg,
      });

      return {
        success: false,
        code: 'PROVISIONING_FAILED',
        error: errorMsg,
      };
    }
  }

  /**
   * Fresh, independent read of authoritative entitlement status.
   * Incidents transition to RESOLVED only when this query confirms active access.
   */
  public async getAuthoritativeEntitlement(orderId: string) {
    const [record] = await db
      .select({
        entitlement: entitlements,
        plan: subscriptionPlans,
        customer: customers,
        order: orders,
      })
      .from(entitlements)
      .innerJoin(orders, eq(entitlements.orderId, orders.id))
      .innerJoin(subscriptionPlans, eq(entitlements.planId, subscriptionPlans.id))
      .innerJoin(customers, eq(entitlements.customerId, customers.id))
      .where(eq(entitlements.orderId, orderId))
      .limit(1);

    return record || null;
  }

  /**
   * Checks whether an entitlement record is currently active and within valid duration.
   */
  public isEntitlementActive(entitlement: typeof entitlements.$inferSelect): boolean {
    if (entitlement.status !== 'ACTIVE') {
      return false;
    }
    const now = new Date();
    return new Date(entitlement.expiresAt).getTime() > now.getTime();
  }
}

export const entitlementService = new EntitlementService();
