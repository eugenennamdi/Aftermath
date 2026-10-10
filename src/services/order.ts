import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { subscriptionPlans, customers, orders, auditLogs } from '../db/schema';
import {
  paystackClient,
  PaystackClient,
  generatePaystackReference,
  isValidPaystackReference,
} from '../lib/paystack';

export interface CreateOrderParams {
  planId: string;
  customerEmail: string;
  customerName?: string;
  callbackUrl?: string;
  paystack?: PaystackClient; // optional custom client for testing
}

export interface OrderCheckoutResult {
  orderId: string;
  paymentReference: string;
  expectedAmount: number;
  currency: string;
  planName: string;
  authorizationUrl?: string;
  accessCode?: string;
}

export interface OrderValidationResult {
  isValid: boolean;
  mismatchReason?: string;
  expected?: {
    reference: string;
    amount: number;
    currency: string;
    email: string;
  };
  actual?: {
    reference: string;
    amount: number;
    currency: string;
    email: string;
  };
}

/**
 * Validates and resolves client-provided callback URLs against an authorized server origin.
 * Prevents arbitrary open-redirect attacks or exfiltration to attacker-controlled domains.
 */
export function resolveSafeCallbackUrl(clientCallbackUrl?: string): string {
  const defaultBase = process.env.APP_BASE_URL || 'http://localhost:3000';
  const defaultCallback = `${defaultBase.replace(/\/$/, '')}/checkout/complete`;

  if (!clientCallbackUrl) {
    return defaultCallback;
  }

  // Handle relative path safely
  if (clientCallbackUrl.startsWith('/')) {
    return `${defaultBase.replace(/\/$/, '')}${clientCallbackUrl}`;
  }

  try {
    const parsed = new URL(clientCallbackUrl);
    const appBase = new URL(defaultBase);

    // Explicit allowlist: same origin or designated localhost test ports
    const allowedHosts = new Set([
      appBase.host,
      'localhost:3000',
      '127.0.0.1:3000',
    ]);

    if (allowedHosts.has(parsed.host)) {
      return parsed.toString();
    }

    // Untrusted domain supplied: fall back to safe default callback
    return defaultCallback;
  } catch {
    return defaultCallback;
  }
}

/**
 * Creates a server-trusted order bound strictly to authoritative catalog pricing.
 * Never allows client-supplied amount or currency to override catalog values.
 */
export async function createTrustedOrder(
  params: CreateOrderParams
): Promise<OrderCheckoutResult> {
  const normalizedEmail = params.customerEmail.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Invalid customer email address.');
  }

  // 1. Authoritative plan lookup
  const [plan] = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, params.planId))
    .limit(1);

  if (!plan) {
    throw new Error(`Plan "${params.planId}" does not exist in catalog.`);
  }

  if (plan.isActive !== 'true') {
    throw new Error(`Plan "${params.planId}" is currently inactive.`);
  }

  // 2. Customer lookup or creation
  let [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.email, normalizedEmail))
    .limit(1);

  if (!customer) {
    const customerId = `cus_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const [createdCustomer] = await db
      .insert(customers)
      .values({
        id: customerId,
        email: normalizedEmail,
        name: params.customerName || null,
      })
      .returning();
    customer = createdCustomer;
  }

  // 3. Cryptographically unpredictable, Paystack-compatible reference (alphanumeric & hyphens, NO underscores)
  const paymentReference = generatePaystackReference();
  if (!isValidPaystackReference(paymentReference)) {
    throw new Error(`Generated reference "${paymentReference}" violates Paystack reference constraints.`);
  }
  const orderId = `ord_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

  // 4. Insert order with PENDING status
  const [createdOrder] = await db
    .insert(orders)
    .values({
      id: orderId,
      customerId: customer.id,
      planId: plan.id,
      paymentReference,
      expectedAmount: plan.amount, // Derived exclusively from catalog
      currency: plan.currency,     // Derived exclusively from catalog
      status: 'PENDING',
    })
    .returning();

  // Audit event
  await db.insert(auditLogs).values({
    id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
    orderId: createdOrder.id,
    action: 'ORDER_INITIALIZED',
    actor: 'SYSTEM',
    details: `Order created for customer ${customer.email} on plan ${plan.id} for ${plan.amount} ${plan.currency}`,
  });

  const client = params.paystack || paystackClient;
  let authorizationUrl: string | undefined;
  let accessCode: string | undefined;

  // 5. Initialize Paystack test-mode transaction if client is configured
  if (client.hasSecretKey()) {
    const safeCallback = resolveSafeCallbackUrl(params.callbackUrl);
    try {
      const initRes = await client.initializeTransaction({
        reference: paymentReference,
        amount: plan.amount,
        email: customer.email,
        callbackUrl: safeCallback,
        metadata: {
          order_id: createdOrder.id,
          plan_id: plan.id,
          customer_id: customer.id,
        },
      });

      // Strict validation: echoed reference must match local order reference exactly
      if (initRes.reference !== paymentReference) {
        throw new Error(
          `Paystack initialization reference mismatch: expected "${paymentReference}", received "${initRes.reference}".`
        );
      }

      authorizationUrl = initRes.authorizationUrl;
      accessCode = initRes.accessCode;

      await db
        .update(orders)
        .set({
          paystackAccessCode: accessCode,
          paystackAuthorizationUrl: authorizationUrl,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, createdOrder.id));
    } catch (err) {
      // Record failure on order
      await db
        .update(orders)
        .set({
          status: 'FAILED',
          updatedAt: new Date(),
        })
        .where(eq(orders.id, createdOrder.id));

      throw err;
    }
  }

  return {
    orderId: createdOrder.id,
    paymentReference: createdOrder.paymentReference,
    expectedAmount: createdOrder.expectedAmount,
    currency: createdOrder.currency,
    planName: plan.name,
    authorizationUrl,
    accessCode,
  };
}

/**
 * Retrieves order and customer details by order ID.
 */
export async function getOrderById(orderId: string) {
  const [order] = await db
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

  return order || null;
}

/**
 * Retrieves order and customer details by payment reference.
 */
export async function getOrderByReference(reference: string) {
  const [order] = await db
    .select({
      order: orders,
      customer: customers,
      plan: subscriptionPlans,
    })
    .from(orders)
    .innerJoin(customers, eq(orders.customerId, customers.id))
    .innerJoin(subscriptionPlans, eq(orders.planId, subscriptionPlans.id))
    .where(eq(orders.paymentReference, reference))
    .limit(1);

  return order || null;
}

/**
 * Deterministically checks mathematical and identity equality between trusted order and external payment.
 */
export function validateOrderPaymentBinding(
  orderData: {
    order: typeof orders.$inferSelect;
    customer: typeof customers.$inferSelect;
  },
  payment: {
    reference: string;
    amount: number;
    currency: string;
    customerEmail: string;
  }
): OrderValidationResult {
  const expected = {
    reference: orderData.order.paymentReference,
    amount: orderData.order.expectedAmount,
    currency: orderData.order.currency.toUpperCase(),
    email: orderData.customer.email.toLowerCase(),
  };

  const actual = {
    reference: payment.reference,
    amount: payment.amount,
    currency: payment.currency.toUpperCase(),
    email: payment.customerEmail.toLowerCase(),
  };

  if (expected.reference !== actual.reference) {
    return {
      isValid: false,
      mismatchReason: `Payment reference mismatch: expected "${expected.reference}", received "${actual.reference}".`,
      expected,
      actual,
    };
  }

  if (expected.amount !== actual.amount) {
    return {
      isValid: false,
      mismatchReason: `Payment amount mismatch: expected ${expected.amount} subunits, received ${actual.amount} subunits.`,
      expected,
      actual,
    };
  }

  if (expected.currency !== actual.currency) {
    return {
      isValid: false,
      mismatchReason: `Currency mismatch: expected "${expected.currency}", received "${actual.currency}".`,
      expected,
      actual,
    };
  }

  if (expected.email !== actual.email) {
    return {
      isValid: false,
      mismatchReason: `Payer email mismatch: expected "${expected.email}", received "${actual.email}".`,
      expected,
      actual,
    };
  }

  return { isValid: true, expected, actual };
}
