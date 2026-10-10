import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/webhooks/paystack/route';
import { db } from '@/db';
import { customers, orders, paymentEvents, entitlements } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { generatePaystackReference } from '@/lib/paystack';

describe('Paystack Webhook Handler Security & Fast Ingestion Boundary', () => {
  const secretKey = 'sk_test_mock_webhook_secret_key';
  let customerEmail: string;
  let customerId: string;
  let orderId: string;
  let reference: string;

  beforeEach(async () => {
    process.env.PAYSTACK_SECRET_KEY = secretKey;

    customerEmail = `hook-${Date.now()}@example.com`;
    customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = generatePaystackReference();

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Webhook Test User',
    });

    await db.insert(orders).values({
      id: orderId,
      customerId,
      planId: 'plan_starter_monthly',
      paymentReference: reference,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PENDING',
    });
  });

  function createSignedRequest(body: unknown, customSignature?: string) {
    const raw = JSON.stringify(body);
    const signature =
      customSignature !== undefined
        ? customSignature
        : crypto.createHmac('sha512', secretKey).update(raw).digest('hex');

    return new NextRequest('http://localhost:3000/api/webhooks/paystack', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': signature,
      },
      body: raw,
    });
  }

  it('rejects unsigned webhook requests with HTTP 401 (Requirement 11)', async () => {
    const raw = JSON.stringify({ event: 'charge.success', data: { reference } });
    const req = new NextRequest('http://localhost:3000/api/webhooks/paystack', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Invalid or missing webhook signature');
  });

  it('rejects forged webhook signatures with HTTP 401 (Requirement 11)', async () => {
    const req = createSignedRequest(
      { event: 'charge.success', data: { reference } },
      'forged_deadbeef_signature'
    );

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('rejects malformed webhook bodies with HTTP 400 (Requirement 11)', async () => {
    const malformedRaw = '{"broken_json:';
    const sig = crypto.createHmac('sha512', secretKey).update(malformedRaw).digest('hex');

    const req = new NextRequest('http://localhost:3000/api/webhooks/paystack', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-paystack-signature': sig,
      },
      body: malformedRaw,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('fast acknowledgment: ingests valid charge.success, records payment, and acknowledges promptly without synchronous fulfillment (Regression Check 3)', async () => {
    const req = createSignedRequest({
      event: 'charge.success',
      data: {
        reference,
        amount: 500000,
        currency: 'NGN',
        status: 'success',
        customer: { email: customerEmail },
        paid_at: new Date().toISOString(),
      },
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);
    expect(json.acknowledged).toBe(true);
    expect(json.orderId).toBe(orderId);

    // Verify order updated to PAID (fulfillment signal persisted)
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order.status).toBe('PAID');

    // IMPORTANT: Verify that the webhook DID NOT synchronously provision entitlements inside the HTTP request!
    // Entitlement provisioning must execute independently via the fulfillment engine
    const activeEntitlements = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, orderId));
    expect(activeEntitlements.length).toBe(0);
  });

  it('guarantees duplicate webhook deliveries are idempotent and do not create duplicate records (Requirement 7 & Regression Check 9)', async () => {
    const payload = {
      event: 'charge.success',
      data: {
        reference,
        amount: 500000,
        currency: 'NGN',
        status: 'success',
        customer: { email: customerEmail },
        paid_at: new Date().toISOString(),
      },
    };

    // First delivery
    const req1 = createSignedRequest(payload);
    const res1 = await POST(req1);
    expect(res1.status).toBe(200);
    const json1 = await res1.json();
    expect(json1.received).toBe(true);
    expect(json1.duplicate).toBeUndefined();

    // Second delivery (Paystack webhook retry)
    const req2 = createSignedRequest(payload);
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.duplicate).toBe(true);

    // Verify only ONE payment event exists
    const events = await db.select().from(paymentEvents).where(eq(paymentEvents.paymentReference, reference));
    expect(events.length).toBe(1);
  });
});
