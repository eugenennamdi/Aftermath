import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { paymentEvents, orders, auditLogs } from '@/db/schema';
import { paystackClient } from '@/lib/paystack';
import { getOrderByReference } from '@/services/order';

// Bound request payload to max 1MB to prevent memory exhaustion
const MAX_PAYLOAD_BYTES = 1024 * 1024;

// Schema for Paystack webhook events
const PaystackWebhookSchema = z.object({
  event: z.string(),
  data: z.object({
    id: z.number().optional(),
    reference: z.string().min(1),
    amount: z.number().int().positive(),
    currency: z.string().min(3).max(3),
    status: z.string(),
    channel: z.string().optional(),
    gateway_response: z.string().optional(),
    customer: z.object({
      email: z.string().email(),
      id: z.number().optional(),
    }),
    paid_at: z.string().optional(),
  }),
});

/**
 * Paystack Webhook Ingestion Endpoint
 * Gated strictly for fast, reliable ingestion & transactional persistence.
 * Avoids synchronous provisioning or outbound API calls inside the request cycle.
 * Acknowledges immediately with HTTP 200 upon durable event persistence.
 */
export async function POST(req: NextRequest) {
  try {
    // 1. Bound request payload size
    const arrayBuffer = await req.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Payload exceeds maximum allowed size' },
        { status: 413 }
      );
    }

    const rawBuffer = Buffer.from(arrayBuffer);
    const signature = req.headers.get('x-paystack-signature');

    // 2. Strict HMAC-SHA512 constant-time signature validation
    if (!paystackClient.verifyWebhookSignature(rawBuffer, signature)) {
      return NextResponse.json(
        { error: 'Invalid or missing webhook signature' },
        { status: 401 }
      );
    }

    // 3. Strict schema parsing
    const rawText = rawBuffer.toString('utf-8');
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(rawText);
    } catch {
      return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
    }

    const parseResult = PaystackWebhookSchema.safeParse(jsonBody);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid event structure', details: parseResult.error.issues },
        { status: 400 }
      );
    }

    const { event, data } = parseResult.data;

    // Filter non-payment events with instant acknowledgment
    if (event !== 'charge.success') {
      return NextResponse.json({ received: true, ignored: true, event });
    }

    // 4. Compute privacy-safe payload hash (never store unredacted raw cards or sensitive payload)
    const payloadHash = crypto.createHash('sha256').update(rawBuffer).digest('hex');

    // 5. Idempotent payment event recording
    const [existingEvent] = await db
      .select()
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.paymentReference, data.reference),
          eq(paymentEvents.eventType, event)
        )
      )
      .limit(1);

    if (existingEvent) {
      // Event already recorded: acknowledge immediately without re-processing side-effects
      return NextResponse.json({ received: true, duplicate: true });
    }

    // 6. Look up trusted local order
    const orderRecord = await getOrderByReference(data.reference);

    const eventId = `evt_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await db.insert(paymentEvents).values({
      id: eventId,
      orderId: orderRecord ? orderRecord.order.id : null,
      paymentReference: data.reference,
      eventType: event,
      status: data.status,
      amount: data.amount,
      currency: data.currency.toUpperCase(),
      customerEmail: data.customer.email.toLowerCase(),
      channel: data.channel || null,
      gatewayResponse: data.gateway_response || null,
      payloadHash,
    });

    if (!orderRecord) {
      // Payment received for unknown order: log audit and acknowledge
      await db.insert(auditLogs).values({
        id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        action: 'UNKNOWN_ORDER_PAYMENT',
        actor: 'WEBHOOK',
        details: `Received charge.success for unknown reference: ${data.reference}`,
      });
      return NextResponse.json({ received: true, warning: 'Order not found' });
    }

    const { order } = orderRecord;

    // 7. Persist fulfillment signal transactionally on order
    // If order was PENDING, record PAID status and paidAt timestamp
    if (order.status === 'PENDING') {
      const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
      await db
        .update(orders)
        .set({
          status: 'PAID',
          paidAt,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));
    }

    await db.insert(auditLogs).values({
      id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      orderId: order.id,
      action: 'WEBHOOK_INGESTED',
      actor: 'WEBHOOK',
      details: `Payment event ingested for order ${order.id}. Awaiting independent fulfillment verification.`,
    });

    // 8. Prompt acknowledgment: return immediately with HTTP 200
    // NO synchronous provisioning or outbound API calls inside the request
    return NextResponse.json({
      received: true,
      acknowledged: true,
      orderId: order.id,
      reference: data.reference,
    });
  } catch (err) {
    const errorMsg = (err as Error).message || String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
