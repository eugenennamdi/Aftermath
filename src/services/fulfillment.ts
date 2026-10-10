import { eq } from 'drizzle-orm';
import { db } from '../db';
import { orders, customers, subscriptionPlans, entitlements, auditLogs } from '../db/schema';
import { paystackClient, PaystackClient } from '../lib/paystack';
import { validateOrderPaymentBinding } from './order';
import { entitlementService, ProvisionOptions } from './entitlement';
import { createOrGetIncident } from './incident';

export type NormalFulfillmentResult =
  | { status: 'FULFILLED'; orderId: string; entitlementId: string }
  | { status: 'ALREADY_FULFILLED'; orderId: string; entitlementId: string }
  | { status: 'ORDER_NOT_FOUND'; orderId: string }
  | { status: 'PAYMENT_PENDING'; orderId: string; reference: string }
  | { status: 'PAYMENT_FAILED'; orderId: string; reference: string; error: string }
  | { status: 'RETRYABLE_PROVIDER_ERROR'; orderId: string; reference: string; error: string }
  | { status: 'MISMATCH'; orderId: string; reference: string; reason: string }
  | { status: 'FULFILLMENT_FAILED'; orderId: string; reference: string; error: string };

export interface FulfillmentOptions extends ProvisionOptions {
  client?: PaystackClient;
}

/**
 * Normal SaaS Fulfillment Engine
 * Runs independently of the webhook request.
 * Gated strictly by authoritative Paystack API verification and trusted local order matching.
 * Grants access idempotently; never invokes the Aftermath recovery agent.
 */
export async function processNormalFulfillment(
  orderId: string,
  options?: FulfillmentOptions
): Promise<NormalFulfillmentResult> {
  // 1. Authoritative local order read
  const [orderRecord] = await db
    .select({
      order: orders,
      customer: customers,
      plan: subscriptionPlans,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .innerJoin(subscriptionPlans, eq(orders.planId, subscriptionPlans.id))
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!orderRecord) {
    return { status: 'ORDER_NOT_FOUND', orderId };
  }

  const { order, customer } = orderRecord;

  // Fast-path idempotency: check if already fulfilled
  const existingEntitlement = await entitlementService.getAuthoritativeEntitlement(order.id);
  if (existingEntitlement && entitlementService.isEntitlementActive(existingEntitlement.entitlement)) {
    return {
      status: 'ALREADY_FULFILLED',
      orderId: order.id,
      entitlementId: existingEntitlement.entitlement.id,
    };
  }

  // 2. Independent server-side Paystack verification
  const client = options?.client || paystackClient;
  const verification = await client.verifyTransaction(order.paymentReference);

  // Handle transient provider errors: preserve retryable state
  if (verification.outcome === 'API_ERROR') {
    return {
      status: 'RETRYABLE_PROVIDER_ERROR',
      orderId: order.id,
      reference: order.paymentReference,
      error: verification.error,
    };
  }

  // Handle ongoing/pending payments: never grant access
  if (verification.outcome === 'PENDING') {
    return {
      status: 'PAYMENT_PENDING',
      orderId: order.id,
      reference: order.paymentReference,
    };
  }

  // Handle abandoned or failed payments: update order to FAILED
  if (verification.outcome === 'FAILED') {
    await db
      .update(orders)
      .set({ status: 'FAILED', updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    await createOrGetIncident({
      orderId: order.id,
      paymentReference: order.paymentReference,
      customerId: customer.id,
      reason: 'VERIFICATION_MISMATCH',
      errorDetail: verification.gatewayResponse || 'Paystack returned failed payment status',
    });

    return {
      status: 'PAYMENT_FAILED',
      orderId: order.id,
      reference: order.paymentReference,
      error: verification.gatewayResponse || 'Transaction failed',
    };
  }

  // Handle malformed provider response
  if (verification.outcome === 'MALFORMED') {
    await createOrGetIncident({
      orderId: order.id,
      paymentReference: order.paymentReference,
      customerId: customer.id,
      reason: 'VERIFICATION_MISMATCH',
      errorDetail: verification.error,
    });

    return {
      status: 'MISMATCH',
      orderId: order.id,
      reference: order.paymentReference,
      reason: verification.error,
    };
  }

  // 3. Deterministic mathematical equality & customer identity validation
  const bindingCheck = validateOrderPaymentBinding(
    { order, customer },
    {
      reference: verification.reference,
      amount: verification.amount,
      currency: verification.currency,
      customerEmail: verification.customerEmail,
    }
  );

  if (!bindingCheck.isValid) {
    // Definitive mismatch: mark order FAILED and open durable incident
    await db
      .update(orders)
      .set({ status: 'FAILED', updatedAt: new Date() })
      .where(eq(orders.id, order.id));

    await createOrGetIncident({
      orderId: order.id,
      paymentReference: order.paymentReference,
      customerId: customer.id,
      reason: 'VERIFICATION_MISMATCH',
      errorDetail: bindingCheck.mismatchReason,
    });

    return {
      status: 'MISMATCH',
      orderId: order.id,
      reference: order.paymentReference,
      reason: bindingCheck.mismatchReason || 'Payment parameters mismatched trusted order',
    };
  }

  // 4. Payment validated: mark order PAID
  await db
    .update(orders)
    .set({
      status: 'PAID',
      paidAt: verification.paidAt || new Date(),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id));

  // 5. Grant access idempotently via EntitlementService
  const provisionResult = await entitlementService.provisionEntitlement(
    order.id,
    order.paymentReference,
    { _injectFailure: options?._injectFailure }
  );

  if (provisionResult.success) {
    return {
      status: 'FULFILLED',
      orderId: order.id,
      entitlementId: provisionResult.entitlement.id,
    };
  }

  // If already fulfilled concurrently
  if (provisionResult.code === 'ALREADY_FULFILLED') {
    const existing = await entitlementService.getAuthoritativeEntitlement(order.id);
    return {
      status: 'ALREADY_FULFILLED',
      orderId: order.id,
      entitlementId: existing ? existing.entitlement.id : 'unknown',
    };
  }

  // Definitive fulfillment failure: open recovery incident
  await createOrGetIncident({
    orderId: order.id,
    paymentReference: order.paymentReference,
    customerId: customer.id,
    reason: 'FULFILLMENT_FAILED',
    errorDetail: provisionResult.error,
  });

  return {
    status: 'FULFILLMENT_FAILED',
    orderId: order.id,
    reference: order.paymentReference,
    error: provisionResult.error,
  };
}
