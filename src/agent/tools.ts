import crypto from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db';
import { orders, subscriptionPlans, customers, paymentEvents, entitlements, incidents, auditLogs } from '../db/schema';
import { paystackClient, PaystackClient, type PaystackVerificationOutcome, type PaystackVerificationAdapter } from '../lib/paystack';
import { redactEmail } from '../services/query';
import { sanitizeTelemetryPayload } from '../lib/neatlogs';
import { trace } from 'neatlogs';

export type InspectOrderToolResult =
  | {
      found: false;
      orderId: string;
      error: string;
    }
  | {
      found: true;
      orderId: string;
      status: string;
      expectedAmount: number;
      currency: string;
      paymentReference: string;
      customerId: string;
      customerEmail: string;
      planId: string;
      planName: string;
      durationDays: number;
      createdAt: string;
    };

export type InspectPaymentEvidenceToolResult = {
  paymentReference: string;
  eventCount: number;
  events: Array<{
    id: string;
    eventType: string;
    status: string;
    amount: number;
    currency: string;
    customerEmail: string;
    channel: string | null;
    createdAt: string;
  }>;
};

export type VerifyPaystackToolResult =
  | {
      verified: true;
      outcome: 'SUCCESS';
      reference: string;
      amount: number;
      currency: string;
      customerEmail: string;
      paidAt: string;
      gatewayResponse?: string;
    }
  | {
      verified: false;
      outcome: 'API_ERROR';
      reference: string;
      error: string;
      retryable: boolean;
    }
  | {
      verified: false;
      outcome: 'FAILED' | 'PENDING' | 'MALFORMED' | 'UNVERIFIED';
      reference: string;
      gatewayResponse?: string;
    };

export type InspectEntitlementToolResult =
  | {
      exists: false;
      orderId: string;
      entitlement: null;
    }
  | {
      exists: true;
      orderId: string;
      entitlementId: string;
      status: string;
      isActive: boolean;
      startedAt: string;
      expiresAt: string;
    };

export type InspectPriorAttemptsToolResult = {
  incidentId: string;
  found: boolean;
  status: string | null;
  reason: string | null;
  retryCount: number;
  lastDecision: string | null;
  logs: Array<{
    action: string;
    actor: string;
    details: string | null;
    createdAt: string;
  }>;
};

/**
 * 1. Inspect local order and bound subscription details.
 */
export async function inspectOrder(orderId: string): Promise<InspectOrderToolResult> {
  return await trace(
    { name: 'inspect_order', kind: 'TOOL' },
    async (toolSpan) => {
      toolSpan?.setAttribute('tool.name', 'inspect_order');
      toolSpan?.setAttribute('tool.input', JSON.stringify(sanitizeTelemetryPayload({ orderId })));

      const [record] = await db
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

      if (!record) {
        const output: InspectOrderToolResult = {
          found: false,
          orderId,
          error: 'Order not found in authoritative records.',
        };
        toolSpan?.setAttribute('tool.output', JSON.stringify(output));
        return output;
      }

      const output: InspectOrderToolResult = {
        found: true,
        orderId: record.order.id,
        status: record.order.status,
        expectedAmount: record.order.expectedAmount,
        currency: record.order.currency,
        paymentReference: record.order.paymentReference,
        customerId: record.customer.id,
        customerEmail: record.customer.email,
        planId: record.plan.id,
        planName: record.plan.name,
        durationDays: record.plan.durationDays,
        createdAt: record.order.createdAt.toISOString(),
      };

      toolSpan?.setAttribute('tool.output', JSON.stringify(sanitizeTelemetryPayload(output)));
      return output;
    }
  );
}

/**
 * 2. Inspect recorded payment events (webhooks, callbacks, prior verifications).
 */
export async function inspectPaymentEvidence(paymentReference: string): Promise<InspectPaymentEvidenceToolResult> {
  return await trace(
    { name: 'inspect_payment_evidence', kind: 'TOOL' },
    async (toolSpan) => {
      toolSpan?.setAttribute('tool.name', 'inspect_payment_evidence');
      toolSpan?.setAttribute('tool.input', JSON.stringify(sanitizeTelemetryPayload({ paymentReference })));

      const events = await db
        .select()
        .from(paymentEvents)
        .where(eq(paymentEvents.paymentReference, paymentReference))
        .orderBy(desc(paymentEvents.createdAt))
        .limit(10);

      const output: InspectPaymentEvidenceToolResult = {
        paymentReference,
        eventCount: events.length,
        events: events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          status: e.status,
          amount: e.amount,
          currency: e.currency,
          customerEmail: e.customerEmail,
          channel: e.channel,
          createdAt: e.createdAt.toISOString(),
        })),
      };

      toolSpan?.setAttribute('tool.output', JSON.stringify(sanitizeTelemetryPayload(output)));
      return output;
    }
  );
}

export interface VerifyPaystackContext {
  orderId?: string;
  incidentId?: string;
}

/**
 * 3. Independently verify transaction against Paystack API.
 */
export async function verifyPaystackTransaction(
  paymentReference: string,
  adapter?: PaystackVerificationAdapter,
  context?: VerifyPaystackContext
): Promise<VerifyPaystackToolResult> {
  return await trace(
    { name: 'verify_paystack_transaction', kind: 'TOOL' },
    async (toolSpan) => {
      toolSpan?.setAttribute('tool.name', 'verify_paystack_transaction');
      toolSpan?.setAttribute('tool.input', JSON.stringify(sanitizeTelemetryPayload({ paymentReference })));

      const client = adapter || paystackClient;
      const outcome: PaystackVerificationOutcome = await client.verifyTransaction(paymentReference);

      // Explicitly distinguish real live HTTP Paystack responses from scoped test fixtures
      const isLiveHttp = adapter
        ? adapter.adapterType === 'LIVE_HTTP' || (adapter instanceof PaystackClient && !(adapter as any).__isSimulated)
        : paystackClient.adapterType === 'LIVE_HTTP';
      const provenance: 'LIVE_HTTP' | 'SCOPED_FIXTURE' = isLiveHttp ? 'LIVE_HTTP' : 'SCOPED_FIXTURE';

      // Resolve orderId and incidentId for linked evidence provenance
      let targetOrderId = context?.orderId;
      let targetIncidentId = context?.incidentId;

      if (!targetOrderId || !targetIncidentId) {
        try {
          const [foundOrder] = await db
            .select({ id: orders.id })
            .from(orders)
            .where(eq(orders.paymentReference, paymentReference))
            .limit(1);
          if (foundOrder) {
            targetOrderId = targetOrderId || foundOrder.id;
            if (!targetIncidentId) {
              const [foundInc] = await db
                .select({ id: incidents.id })
                .from(incidents)
                .where(eq(incidents.orderId, foundOrder.id))
                .limit(1);
              if (foundInc) {
                targetIncidentId = foundInc.id;
              }
            }
          }
        } catch {
          // non-blocking fallback
        }
      }

      let output: VerifyPaystackToolResult;
      if (outcome.outcome === 'SUCCESS') {
        output = {
          verified: true,
          outcome: 'SUCCESS',
          reference: outcome.reference,
          amount: outcome.amount,
          currency: outcome.currency,
          customerEmail: outcome.customerEmail,
          paidAt: outcome.paidAt
            ? (outcome.paidAt instanceof Date ? outcome.paidAt.toISOString() : new Date(outcome.paidAt).toISOString())
            : new Date().toISOString(),
          gatewayResponse: outcome.gatewayResponse,
        };

        // Persist independent verification response in audit_logs with explicit order/incident association & provenance
        const auditAction = isLiveHttp ? 'PAYSTACK_VERIFIED' : 'PAYSTACK_FIXTURE_VERIFIED';
        const auditActor = isLiveHttp ? 'paystack_adapter' : 'paystack_fixture';
        try {
          await db.insert(auditLogs).values({
            id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
            orderId: targetOrderId || null,
            incidentId: targetIncidentId || null,
            action: auditAction,
            actor: auditActor,
            details: JSON.stringify({
              provenance,
              reference: outcome.reference,
              outcome: outcome.outcome,
              amount: outcome.amount,
              currency: outcome.currency,
              customerEmail: redactEmail(outcome.customerEmail),
              gatewayResponse: outcome.gatewayResponse || 'Successful',
              verifiedAt: new Date().toISOString(),
            }),
          });
        } catch {
          // Non-blocking persistence
        }
      } else if (outcome.outcome === 'API_ERROR') {
        output = {
          verified: false,
          outcome: 'API_ERROR',
          reference: outcome.reference,
          error: outcome.error,
          retryable: outcome.retryable,
        };
      } else {
        output = {
          verified: false,
          outcome: outcome.outcome,
          reference: outcome.reference,
          gatewayResponse: 'gatewayResponse' in outcome ? outcome.gatewayResponse : outcome.outcome,
        };

        if (outcome.outcome === 'FAILED') {
          const auditAction = isLiveHttp ? 'PAYSTACK_VERIFICATION_FAILED' : 'PAYSTACK_FIXTURE_FAILED';
          const auditActor = isLiveHttp ? 'paystack_adapter' : 'paystack_fixture';
          try {
            await db.insert(auditLogs).values({
              id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
              orderId: targetOrderId || null,
              incidentId: targetIncidentId || null,
              action: auditAction,
              actor: auditActor,
              details: JSON.stringify({
                provenance,
                reference: outcome.reference,
                outcome: outcome.outcome,
                error: 'gatewayResponse' in outcome ? outcome.gatewayResponse : 'Transaction failed',
                verifiedAt: new Date().toISOString(),
              }),
            });
          } catch {
            // Non-blocking persistence
          }
        }
      }

      toolSpan?.setAttribute('tool.output', JSON.stringify(sanitizeTelemetryPayload(output)));
      return output;
    }
  );
}

/**
 * 4. Inspect authoritative entitlements table for active access.
 */
export async function inspectEntitlement(orderId: string): Promise<InspectEntitlementToolResult> {
  return await trace(
    { name: 'inspect_entitlement', kind: 'TOOL' },
    async (toolSpan) => {
      toolSpan?.setAttribute('tool.name', 'inspect_entitlement');
      toolSpan?.setAttribute('tool.input', JSON.stringify(sanitizeTelemetryPayload({ orderId })));

      const [ent] = await db
        .select()
        .from(entitlements)
        .where(eq(entitlements.orderId, orderId))
        .limit(1);

      if (!ent) {
        const output: InspectEntitlementToolResult = {
          exists: false,
          orderId,
          entitlement: null,
        };
        toolSpan?.setAttribute('tool.output', JSON.stringify(output));
        return output;
      }

      const isCurrent = ent.status === 'ACTIVE' && new Date(ent.expiresAt).getTime() > Date.now();
      const output: InspectEntitlementToolResult = {
        exists: true,
        orderId,
        entitlementId: ent.id,
        status: ent.status,
        isActive: isCurrent,
        startedAt: ent.startedAt.toISOString(),
        expiresAt: ent.expiresAt.toISOString(),
      };

      toolSpan?.setAttribute('tool.output', JSON.stringify(sanitizeTelemetryPayload(output)));
      return output;
    }
  );
}

/**
 * 5. Inspect prior recovery attempts and audit log history.
 */
export async function inspectPriorRecoveryAttempts(incidentId: string): Promise<InspectPriorAttemptsToolResult> {
  return await trace(
    { name: 'inspect_prior_recovery_attempts', kind: 'TOOL' },
    async (toolSpan) => {
      toolSpan?.setAttribute('tool.name', 'inspect_prior_recovery_attempts');
      toolSpan?.setAttribute('tool.input', JSON.stringify(sanitizeTelemetryPayload({ incidentId })));

      const [incident] = await db
        .select()
        .from(incidents)
        .where(eq(incidents.id, incidentId))
        .limit(1);

      const logs = await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.incidentId, incidentId))
        .orderBy(desc(auditLogs.createdAt))
        .limit(10);

      const output: InspectPriorAttemptsToolResult = {
        incidentId,
        found: Boolean(incident),
        status: incident?.status || null,
        reason: incident?.reason || null,
        retryCount: incident?.retryCount ?? 0,
        lastDecision: incident?.lastDecision || null,
        logs: logs.map((l) => ({
          action: l.action,
          actor: l.actor,
          details: l.details,
          createdAt: l.createdAt.toISOString(),
        })),
      };

      toolSpan?.setAttribute('tool.output', JSON.stringify(sanitizeTelemetryPayload(output)));
      return output;
    }
  );
}

export const recoveryTools = {
  inspect_order: inspectOrder,
  inspect_payment_evidence: inspectPaymentEvidence,
  verify_paystack_transaction: verifyPaystackTransaction,
  inspect_entitlement: inspectEntitlement,
  inspect_prior_recovery_attempts: inspectPriorRecoveryAttempts,
};
