import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/db';
import { customers, orders, entitlements, incidents } from '@/db/schema';
import {
  processNormalFulfillment,
  validateFulfillmentInvariants,
} from '@/services/fulfillment';
import { PaystackClient, generatePaystackReference } from '@/lib/paystack';
import {
  getPendingOrdersForReconciliation,
  getPaidUnfulfilledOrders,
} from '@/services/incident';
import { eq } from 'drizzle-orm';

describe('Normal SaaS Fulfillment & Reconciliation Engine (Regression Checks 4, 5, 6, 7, 8, 11)', () => {
  let customerId: string;
  let customerEmail: string;
  let orderId: string;
  let reference: string;

  beforeEach(async () => {
    customerEmail = `fulfill-${Date.now()}@example.com`;
    customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = generatePaystackReference();

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Fulfillment Test User',
    });

    await db.insert(orders).values({
      id: orderId,
      customerId,
      planId: 'plan_starter_monthly',
      paymentReference: reference,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PAID', // Marked paid by webhook signal
      paidAt: new Date(),
    });
  });

  it('independent verification: queries Paystack verification API before granting entitlement (Regression Check 4)', async () => {
    const mockVerify = vi.fn().mockResolvedValue({
      outcome: 'SUCCESS',
      reference,
      amount: 500000,
      currency: 'NGN',
      customerEmail,
      paidAt: new Date(),
    });

    const mockClient = {
      verifyTransaction: mockVerify,
      hasSecretKey: () => true,
    } as unknown as PaystackClient;

    const result = await processNormalFulfillment(orderId, { client: mockClient });

    expect(mockVerify).toHaveBeenCalledWith(reference);
    expect(result.status).toBe('FULFILLED');
    if (result.status === 'FULFILLED') {
      expect(result.orderId).toBe(orderId);
      expect(result.entitlementId).toBeDefined();

      const [entitlement] = await db
        .select()
        .from(entitlements)
        .where(eq(entitlements.orderId, orderId));
      expect(entitlement.status).toBe('ACTIVE');
    }
  });

  it('signed success event with failed/pending provider verification does not grant access (Regression Check 5)', async () => {
    // Scenario: Webhook arrived or client claimed success, but Paystack API returns PENDING or FAILED
    const mockPendingClient = {
      verifyTransaction: vi.fn().mockResolvedValue({
        outcome: 'PENDING',
        reference,
        gatewayResponse: 'Waiting for OTP',
      }),
      hasSecretKey: () => true,
    } as unknown as PaystackClient;

    const pendingResult = await processNormalFulfillment(orderId, { client: mockPendingClient });
    expect(pendingResult.status).toBe('PAYMENT_PENDING');

    // Confirm no entitlement was granted
    const activeEntitlements = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, orderId));
    expect(activeEntitlements.length).toBe(0);

    // Scenario: Provider verification returns FAILED
    const mockFailedClient = {
      verifyTransaction: vi.fn().mockResolvedValue({
        outcome: 'FAILED',
        reference,
        gatewayResponse: 'Declined: insufficient funds',
      }),
      hasSecretKey: () => true,
    } as unknown as PaystackClient;

    const failedResult = await processNormalFulfillment(orderId, { client: mockFailedClient });
    expect(failedResult.status).toBe('PAYMENT_FAILED');

    // Confirm order marked FAILED and incident opened
    const [failedOrder] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(failedOrder.status).toBe('FAILED');
    const [incident] = await db.select().from(incidents).where(eq(incidents.orderId, orderId));
    expect(incident).toBeDefined();
  });

  it('provider outage (HTTP 503) preserves retryability without marking order failed (Regression Check 6)', async () => {
    const mockOutageClient = {
      verifyTransaction: vi.fn().mockResolvedValue({
        outcome: 'API_ERROR',
        reference,
        error: 'HTTP 503: Service Unavailable',
        retryable: true,
      }),
      hasSecretKey: () => true,
    } as unknown as PaystackClient;

    const result = await processNormalFulfillment(orderId, { client: mockOutageClient });
    expect(result.status).toBe('RETRYABLE_PROVIDER_ERROR');

    // Confirm order remains in PAID state and NOT marked FAILED
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order.status).toBe('PAID');

    // Confirm no premature incident was created for a transient network glitch
    const userIncidents = await db.select().from(incidents).where(eq(incidents.orderId, orderId));
    expect(userIncidents.length).toBe(0);
  });

  it('reconciliation query detects missing webhooks and fulfills them via independent verification (Regression Check 7)', async () => {
    // Simulate order created 10 minutes ago where webhook was dropped / never arrived
    const missingWebhookOrderId = `ord-nowebhook-${Date.now()}`;
    const missingWebhookRef = generatePaystackReference();
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    await db.insert(orders).values({
      id: missingWebhookOrderId,
      customerId,
      planId: 'plan_starter_monthly',
      paymentReference: missingWebhookRef,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PENDING', // Webhook never arrived, still PENDING
      createdAt: tenMinutesAgo,
    });

    // 1. Reconciliation query detects it
    const pendingOrders = await getPendingOrdersForReconciliation(5, 50);
    const candidate = pendingOrders.find((o) => o.id === missingWebhookOrderId);
    expect(candidate).toBeDefined();

    // 2. Worker sweeps candidate and independently verifies with Paystack
    const mockSuccessClient = {
      verifyTransaction: vi.fn().mockResolvedValue({
        outcome: 'SUCCESS',
        reference: missingWebhookRef,
        amount: 500000,
        currency: 'NGN',
        customerEmail,
        paidAt: new Date(),
      }),
      hasSecretKey: () => true,
    } as unknown as PaystackClient;

    const fulfillmentResult = await processNormalFulfillment(missingWebhookOrderId, {
      client: mockSuccessClient,
    });

    expect(fulfillmentResult.status).toBe('FULFILLED');

    // Confirm access granted without webhook assistance
    const [granted] = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, missingWebhookOrderId));
    expect(granted.status).toBe('ACTIVE');
  });

  it('paid-but-unfulfilled orders remain discoverable by reconciliation query (Regression Check 8)', async () => {
    // Order marked PAID, but no entitlement row exists
    const paidUnfulfilled = await getPaidUnfulfilledOrders(50);
    const found = paidUnfulfilled.find((o) => o.id === orderId);
    expect(found).toBeDefined();
    expect(found?.status).toBe('PAID');
  });

  it('normal fulfillment and eventual Aftermath recovery maintain separate execution boundaries (Regression Check 11)', async () => {
    // Normal fulfillment is deterministic and never invokes an LLM agent
    // When downstream fulfillment fails, it leaves an OPEN incident for the recovery loop
    const mockClient = {
      verifyTransaction: vi.fn().mockResolvedValue({
        outcome: 'SUCCESS',
        reference,
        amount: 500000,
        currency: 'NGN',
        customerEmail,
        paidAt: new Date(),
      }),
      hasSecretKey: () => true,
    } as unknown as PaystackClient;

    const failedResult = await processNormalFulfillment(orderId, {
      client: mockClient,
      _injectFailure: () => {
        throw new Error('Downstream provisioning timeout: relational pool exhausted');
      },
    });

    expect(failedResult.status).toBe('FULFILLMENT_FAILED');

    // Confirm durable incident opened for Aftermath recovery loop
    const [incident] = await db.select().from(incidents).where(eq(incidents.orderId, orderId));
    expect(incident).toBeDefined();
    expect(incident.status).toBe('OPEN');
    expect(incident.reason).toBe('FULFILLMENT_FAILED');
  });

  it('successful fulfillment: transitions order to FULFILLED with valid paidAt and exactly 1 active entitlement (Case 1 Acceptance Invariant)', async () => {
    const paidTimestamp = new Date();
    const mockClient = {
      verifyTransaction: vi.fn().mockResolvedValue({
        outcome: 'SUCCESS',
        reference,
        amount: 500000,
        currency: 'NGN',
        customerEmail,
        paidAt: paidTimestamp,
      }),
      hasSecretKey: () => true,
    } as unknown as PaystackClient;

    const result = await processNormalFulfillment(orderId, { client: mockClient });
    expect(result.status).toBe('FULFILLED');

    const check = await validateFulfillmentInvariants(orderId);
    expect(check.isValid).toBe(true);
    expect(check.error).toBeUndefined();
    expect(check.order?.status).toBe('FULFILLED');
    expect(check.order?.paidAt).toBeInstanceOf(Date);
    expect(check.entitlement?.status).toBe('ACTIVE');
    expect(check.entitlement?.orderId).toBe(orderId);
    expect(check.entitlement?.customerId).toBe(customerId);
    expect(check.entitlement?.planId).toBe('plan_starter_monthly');
    expect(check.entitlement?.sourceReference).toBe(reference);
  });

  it('idempotent rerun: returns ALREADY_FULFILLED and preserves single active entitlement without duplication (Case 1 Acceptance Invariant)', async () => {
    const mockClient = {
      verifyTransaction: vi.fn().mockResolvedValue({
        outcome: 'SUCCESS',
        reference,
        amount: 500000,
        currency: 'NGN',
        customerEmail,
        paidAt: new Date(),
      }),
      hasSecretKey: () => true,
    } as unknown as PaystackClient;

    // First fulfillment
    const initialResult = await processNormalFulfillment(orderId, { client: mockClient });
    expect(initialResult.status).toBe('FULFILLED');

    // Second execution (rerun)
    const rerunResult = await processNormalFulfillment(orderId, { client: mockClient });
    expect(rerunResult.status).toBe('ALREADY_FULFILLED');

    // Invariants must still hold true
    const check = await validateFulfillmentInvariants(orderId);
    expect(check.isValid).toBe(true);
    expect(check.order?.status).toBe('FULFILLED');

    // Confirm strictly exactly 1 entitlement in database
    const allEntitlements = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, orderId));
    expect(allEntitlements.length).toBe(1);
  });

  it('invalid final state rejection: validateFulfillmentInvariants rejects unfulfilled orders, missing paidAt, and expired access (Case 1 Acceptance Invariant)', async () => {
    const mockClient = {
      verifyTransaction: vi.fn().mockResolvedValue({
        outcome: 'SUCCESS',
        reference,
        amount: 500000,
        currency: 'NGN',
        customerEmail,
        paidAt: new Date(),
      }),
      hasSecretKey: () => true,
    } as unknown as PaystackClient;

    await processNormalFulfillment(orderId, { client: mockClient });

    // Sub-case A: Order status not FULFILLED (e.g. prematurely PAID)
    await db.update(orders).set({ status: 'PAID' }).where(eq(orders.id, orderId));
    const checkA = await validateFulfillmentInvariants(orderId);
    expect(checkA.isValid).toBe(false);
    expect(checkA.error).toContain('expected "FULFILLED"');

    // Restore to FULFILLED, but test Sub-case B: missing paidAt
    await db.update(orders).set({ status: 'FULFILLED', paidAt: null }).where(eq(orders.id, orderId));
    const checkB = await validateFulfillmentInvariants(orderId);
    expect(checkB.isValid).toBe(false);
    expect(checkB.error).toContain('missing valid paidAt timestamp');

    // Restore paidAt, but test Sub-case C: expired access window
    await db.update(orders).set({ paidAt: new Date() }).where(eq(orders.id, orderId));
    const pastDate = new Date(Date.now() - 3600000);
    await db
      .update(entitlements)
      .set({ expiresAt: pastDate })
      .where(eq(entitlements.orderId, orderId));
    const checkC = await validateFulfillmentInvariants(orderId);
    expect(checkC.isValid).toBe(false);
    expect(checkC.error).toContain('expired');
  });
});
