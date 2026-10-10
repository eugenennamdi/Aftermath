import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '@/db';
import { paymentEvents, orders, auditLogs } from '@/db/schema';
import { paystackClient } from '@/lib/paystack';
import { getOrderByReference, validateOrderPaymentBinding } from '@/services/order';
import { entitlementService } from '@/services/entitlement';
import { createOrGetIncident } from '@/services/incident';

// Bound request payload to max 1MB to prevent memory exhaustion attacks
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

export async function POST(req: NextRequest) {
  try {
    // 1. Preserve raw request bytes
    const arrayBuffer = await req.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_PAYLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Payload exceeds maximum allowed size' },
        { status: 413 }
      );
    }

    const rawBuffer = Buffer.from(arrayBuffer);
    const signature = req.headers.get('x-paystack-signature');

    // 2. Strict HMAC-SHA512 signature validation (constant-time)
    if (!paystackClient.verifyWebhookSignature(rawBuffer, signature)) {
      return NextResponse.json(
        { error: 'Invalid or missing webhook signature' },
        { status: 401 }
      );
    }

    // 3. Strict schema validation
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

    // Filter non-payment events
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
      // Event already recorded and processed
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
      // Payment received for unknown order
      await db.insert(auditLogs).values({
        id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        action: 'UNKNOWN_ORDER_PAYMENT',
        actor: 'WEBHOOK',
        details: `Received charge.success for unknown reference: ${data.reference}`,
      });
      return NextResponse.json({ received: true, warning: 'Order not found' });
    }

    const { order, customer } = orderRecord;

    // 7. Validate mathematical equality & customer identity
    const bindingCheck = validateOrderPaymentBinding(
      { order, customer },
      {
        reference: data.reference,
        amount: data.amount,
        currency: data.currency,
        customerEmail: data.customer.email,
      }
    );

    if (!bindingCheck.isValid) {
      // Order payment mismatch! Flag order as FAILED and create recovery incident
      await db
        .update(orders)
        .set({
          status: 'FAILED',
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id));

      await createOrGetIncident({
        orderId: order.id,
        paymentReference: data.reference,
        customerId: customer.id,
        reason: 'VERIFICATION_MISMATCH',
        errorDetail: bindingCheck.mismatchReason,
      });

      return NextResponse.json({
        received: true,
        action: 'INCIDENT_CREATED',
        reason: 'VERIFICATION_MISMATCH',
      });
    }

    // 8. Validated payment: update order to PAID
    const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
    await db
      .update(orders)
      .set({
        status: 'PAID',
        paidAt,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    // 9. Execute normal fulfillment path (synchronous, NO AI in webhook)
    const provisionResult = await entitlementService.provisionEntitlement(
      order.id,
      data.reference
    );

    if (provisionResult.success) {
      return NextResponse.json({
        received: true,
        fulfillment: 'SUCCESS',
        entitlementId: provisionResult.entitlement.id,
      });
    }

    // Normal fulfillment failed (e.g. transient DB issue, temporary timeout)
    // Create durable recovery incident for Aftermath autonomous agent
    await createOrGetIncident({
      orderId: order.id,
      paymentReference: data.reference,
      customerId: customer.id,
      reason: 'FULFILLMENT_FAILED',
      errorDetail: provisionResult.error,
    });

    return NextResponse.json({
      received: true,
      fulfillment: 'FAILED',
      incidentCreated: true,
    });
  } catch (err) {
    const errorMsg = (err as Error).message || String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
