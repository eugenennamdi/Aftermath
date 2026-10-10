import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/db';
import { customers, orders, entitlements } from '@/db/schema';
import { entitlementService } from '@/services/entitlement';
import { eq } from 'drizzle-orm';

describe('PostgreSQL Database Concurrency & Engine-Level Idempotency (Requirement 8)', () => {
  let customerId: string;
  let orderId: string;
  let reference: string;

  beforeEach(async () => {
    customerId = `cus_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord_concurrent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    reference = `ref_concurrent_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    await db.insert(customers).values({
      id: customerId,
      email: `concurrent_${Date.now()}@example.com`,
      name: 'Concurrency Test User',
    });

    await db.insert(orders).values({
      id: orderId,
      customerId,
      planId: 'plan_starter_monthly',
      paymentReference: reference,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PAID',
      paidAt: new Date(),
    });
  });

  it('guarantees that 10 simultaneous concurrent fulfillment attempts create exactly 1 entitlement and reject 9 with ALREADY_FULFILLED', async () => {
    const concurrentAttempts = 10;

    // Launch 10 simultaneous concurrent provisioning calls against live PostgreSQL
    const results = await Promise.all(
      Array.from({ length: concurrentAttempts }, () =>
        entitlementService.provisionEntitlement(orderId, reference)
      )
    );

    const successfulAttempts = results.filter((r) => r.success === true);
    const rejectedAttempts = results.filter(
      (r) => r.success === false && r.code === 'ALREADY_FULFILLED'
    );

    // Assert that strictly ONE call succeeded
    expect(successfulAttempts.length).toBe(1);

    // Assert that all other 9 calls were cleanly rejected as already fulfilled
    expect(rejectedAttempts.length).toBe(concurrentAttempts - 1);

    // Confirm at PostgreSQL engine level that exactly one row exists in entitlements
    const persistedEntitlements = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, orderId));

    expect(persistedEntitlements.length).toBe(1);
    expect(persistedEntitlements[0].sourceReference).toBe(reference);
    expect(persistedEntitlements[0].status).toBe('ACTIVE');
  });
});
