import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/webhooks/paystack/route';
import { db } from '@/db';
import { customers, orders, paymentEvents, entitlements, incidents } from '@/db/schema';
import { eq } from 'drizzle-orm';

describe('Paystack Webhook Handler Security & Processing', () => {
  const secretKey = 'sk_test_mock_webhook_secret_key';
  let customerEmail: string;
  let customerId: string;
  let orderId: string;
  let reference: string;

  beforeEach(async () => {
    process.env.PAYSTACK_SECRET_KEY = secretKey;

    customerEmail = `hook_${Date.now()}@example.com`;
    customerId = `cus_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = `ref_hook_${Date.now()}`;

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
      headers: { 'content-type': 'application/json' }, // No signature header!
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

  it('successfully processes valid charge.success, updates order, and provisions entitlement', async () => {
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
    expect(json.fulfillment).toBe('SUCCESS');

    // Verify order updated to FULFILLED
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order.status).toBe('FULFILLED');

    // Verify entitlement created
    const [entitlement] = await db.select().from(entitlements).where(eq(entitlements.orderId, orderId));
    expect(entitlement).toBeDefined();
    expect(entitlement.sourceReference).toBe(reference);
  });

  it('guarantees duplicate webhook deliveries are idempotent and do not create duplicate records (Requirement 7)', async () => {
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
    expect(json1.fulfillment).toBe('SUCCESS');

    // Second delivery (Paystack webhook retry)
    const req2 = createSignedRequest(payload);
    const res2 = await POST(req2);
    expect(res2.status).toBe(200);
    const json2 = await res2.json();
    expect(json2.duplicate).toBe(true);

    // Verify only ONE payment event exists
    const events = await db.select().from(paymentEvents).where(eq(paymentEvents.paymentReference, reference));
    expect(events.length).toBe(1);

    // Verify only ONE entitlement exists
    const userEntitlements = await db.select().from(entitlements).where(eq(entitlements.orderId, orderId));
    expect(userEntitlements.length).toBe(1);
  });

  it('detects amount mismatch and triggers recovery incident instead of granting access', async () => {
    const mismatchReq = createSignedRequest({
      event: 'charge.success',
      data: {
        reference,
        amount: 200000, // Expected 500000, received 200000
        currency: 'NGN',
        status: 'success',
        customer: { email: customerEmail },
      },
    });

    const res = await mismatchReq ? await POST(mismatchReq) : null;
    expect(res?.status).toBe(200);
    const json = await res?.json();
    expect(json.action).toBe('INCIDENT_CREATED');
    expect(json.reason).toBe('VERIFICATION_MISMATCH');

    // Verify order marked FAILED
    const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(order.status).toBe('FAILED');

    // Verify incident opened
    const [incident] = await db.select().from(incidents).where(eq(incidents.orderId, orderId));
    expect(incident).toBeDefined();
    expect(incident.reason).toBe('VERIFICATION_MISMATCH');

    // Verify NO entitlement created
    const userEntitlements = await db.select().from(entitlements).where(eq(entitlements.orderId, orderId));
    expect(userEntitlements.length).toBe(0);
  });
});
