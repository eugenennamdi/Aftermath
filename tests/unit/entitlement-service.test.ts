import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/db';
import { subscriptionPlans, customers, orders, entitlements, incidents } from '@/db/schema';
import { entitlementService } from '@/services/entitlement';
import { createOrGetIncident, getPendingOrdersForReconciliation } from '@/services/incident';
import { eq } from 'drizzle-orm';

describe('SaaS Entitlement Service & Incident Foundations', () => {
  let testCustomerId: string;
  let testOrderId: string;
  let testReference: string;

  beforeEach(async () => {
    // Seed prerequisite customer and plan
    testCustomerId = `cus_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    testOrderId = `ord_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    testReference = `ref_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    await db.insert(customers).values({
      id: testCustomerId,
      email: `user_${Date.now()}@example.com`,
      name: 'Entitlement Test User',
    });

    await db.insert(orders).values({
      id: testOrderId,
      customerId: testCustomerId,
      planId: 'plan_starter_monthly',
      paymentReference: testReference,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PAID', // Order already marked PAID
      paidAt: new Date(),
    });
  });

  it('normal successful fulfillment provisions active entitlement and marks order FULFILLED (Requirement 9)', async () => {
    const result = await entitlementService.provisionEntitlement(testOrderId, testReference);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entitlement.orderId).toBe(testOrderId);
      expect(result.entitlement.customerId).toBe(testCustomerId);
      expect(result.entitlement.status).toBe('ACTIVE');
      expect(entitlementService.isEntitlementActive(result.entitlement)).toBe(true);

      // Verify order status transitioned to FULFILLED
      const [updatedOrder] = await db.select().from(orders).where(eq(orders.id, testOrderId));
      expect(updatedOrder.status).toBe('FULFILLED');

      // Verify authoritative read
      const authoritative = await entitlementService.getAuthoritativeEntitlement(testOrderId);
      expect(authoritative).not.toBeNull();
      expect(authoritative?.entitlement.id).toBe(result.entitlement.id);
      expect(authoritative?.plan.id).toBe('plan_starter_monthly');
    }
  });

  it('prevents double-fulfillment of already fulfilled orders', async () => {
    // First fulfillment
    const first = await entitlementService.provisionEntitlement(testOrderId, testReference);
    expect(first.success).toBe(true);

    // Second fulfillment attempt
    const second = await entitlementService.provisionEntitlement(testOrderId, testReference);
    expect(second.success).toBe(false);
    if (!second.success) {
      expect(second.code).toBe('ALREADY_FULFILLED');
    }
  });

  it('rejects fulfillment for orders that are not PAID', async () => {
    const unpaidOrderId = `ord_unpaid_${Date.now()}`;
    await db.insert(orders).values({
      id: unpaidOrderId,
      customerId: testCustomerId,
      planId: 'plan_starter_monthly',
      paymentReference: `ref_unpaid_${Date.now()}`,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PENDING',
    });

    const result = await entitlementService.provisionEntitlement(unpaidOrderId, 'ref_unpaid');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('ORDER_NOT_PAID');
    }
  });

  it('failed normal fulfillment leaves a durable recoverable incident state (Requirement 10)', async () => {
    // Simulate failure during provisioning via the injected seam
    const failedResult = await entitlementService.provisionEntitlement(
      testOrderId,
      testReference,
      {
        _injectFailure: () => {
          throw new Error('Downstream provisioning timeout: Redis cache partition');
        },
      }
    );

    expect(failedResult.success).toBe(false);
    if (!failedResult.success) {
      expect(failedResult.code).toBe('INJECTED_FAILURE');

      // Record recovery incident as webhook handler would do
      const { incident, isNew } = await createOrGetIncident({
        orderId: testOrderId,
        paymentReference: testReference,
        customerId: testCustomerId,
        reason: 'FULFILLMENT_FAILED',
        errorDetail: failedResult.error,
      });

      expect(isNew).toBe(true);
      expect(incident.orderId).toBe(testOrderId);
      expect(incident.status).toBe('OPEN');
      expect(incident.reason).toBe('FULFILLMENT_FAILED');

      // Re-triggering incident creation for the same order returns the existing incident
      const duplicateAttempt = await createOrGetIncident({
        orderId: testOrderId,
        paymentReference: testReference,
        customerId: testCustomerId,
        reason: 'FULFILLMENT_FAILED',
      });
      expect(duplicateAttempt.isNew).toBe(false);
      expect(duplicateAttempt.incident.id).toBe(incident.id);
    }
  });

  it('retrieves pending orders for reconciliation sweep', async () => {
    // Insert old pending order
    const oldPendingOrderId = `ord_old_${Date.now()}`;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    await db.insert(orders).values({
      id: oldPendingOrderId,
      customerId: testCustomerId,
      planId: 'plan_starter_monthly',
      paymentReference: `ref_old_${Date.now()}`,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PENDING',
      createdAt: tenMinutesAgo,
    });

    const pendingOrders = await getPendingOrdersForReconciliation(5, 200);
    const found = pendingOrders.some((o) => o.id === oldPendingOrderId);
    expect(found).toBe(true);
  });
});
