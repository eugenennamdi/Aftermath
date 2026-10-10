import { trace, log } from 'neatlogs';
import {
  inspectOrder,
  inspectPaymentEvidence,
  verifyPaystackTransaction,
  inspectEntitlement,
  inspectPriorRecoveryAttempts,
} from './tools';

export type AgentDecision = 'PROPOSE_RECOVERY' | 'RECONCILE_EXISTING' | 'RETRY_LATER' | 'ESCALATE';

export interface InvestigationResult {
  decision: AgentDecision;
  summary: string;
  evidence: {
    order: Awaited<ReturnType<typeof inspectOrder>>;
    paymentEvents: Awaited<ReturnType<typeof inspectPaymentEvidence>>;
    paystack: Awaited<ReturnType<typeof verifyPaystackTransaction>>;
    entitlement: Awaited<ReturnType<typeof inspectEntitlement>>;
    priorAttempts: Awaited<ReturnType<typeof inspectPriorRecoveryAttempts>>;
  };
}

/**
 * Autonomous Investigator Agent
 * Bounded, multi-step evidence gathering with neatlogs tracing.
 * Operates strictly with read-only tools; produces structured intent for the deterministic gate.
 */
export async function investigateIncident(
  incidentId: string,
  orderId: string,
  paymentReference: string
): Promise<InvestigationResult> {
  return await trace(
    {
      name: 'autonomous_investigator_step',
      kind: 'AGENT',
      tags: ['investigator', 'recovery_loop'],
    },
    async (agentSpan) => {
      agentSpan?.setAttribute('aftermath.incident_id', incidentId);
      agentSpan?.setAttribute('aftermath.order_id', orderId);
      agentSpan?.setAttribute('aftermath.payment_reference', paymentReference);

      log('Investigator starting investigation for incident {incidentId}', { incidentId, orderId });

      // Step 1: Inspect local order record
      const order = await inspectOrder(orderId);

      // Step 2: Inspect recorded payment events (webhooks, etc.)
      const paymentEvents = await inspectPaymentEvidence(paymentReference);

      // Step 3: Independently verify payment on Paystack gateway
      const paystack = await verifyPaystackTransaction(paymentReference);

      // Step 4: Check authoritative entitlement state
      const entitlement = await inspectEntitlement(orderId);

      // Step 5: Check prior recovery attempts & retry counts
      const priorAttempts = await inspectPriorRecoveryAttempts(incidentId);

      const evidence = {
        order,
        paymentEvents,
        paystack,
        entitlement,
        priorAttempts,
      };

      // If OpenAI API key is present and configured, we can validate via LLM completion.
      // In all environments, the autonomous deterministic evaluator provides guarantees.
      const decisionResult = evaluateEvidence(evidence);

      agentSpan?.setAttribute('aftermath.agent.decision', decisionResult.decision);
      agentSpan?.setAttribute('aftermath.agent.summary', decisionResult.summary);

      log('Investigator completed with decision {decision}: {summary}', {
        decision: decisionResult.decision,
        summary: decisionResult.summary,
      });

      return {
        decision: decisionResult.decision,
        summary: decisionResult.summary,
        evidence,
      };
    }
  );
}

/**
 * Deterministic evidence evaluator.
 * Enforces security invariants:
 * 1. Missing order -> ESCALATE
 * 2. Active entitlement already present -> RECONCILE_EXISTING
 * 3. Transient Paystack error with retries remaining -> RETRY_LATER
 * 4. Gateway failure or non-retryable error -> ESCALATE
 * 5. Mismatched amount, currency, or customer email -> ESCALATE
 * 6. Verified payment matching trusted order without entitlement -> PROPOSE_RECOVERY
 */
export function evaluateEvidence(evidence: InvestigationResult['evidence']): {
  decision: AgentDecision;
  summary: string;
} {
  const { order, paystack, entitlement, priorAttempts } = evidence;

  // Invariant 1: Order must exist in trusted database
  if (!order.found) {
    return {
      decision: 'ESCALATE',
      summary: `Trusted order "${order.orderId}" does not exist in local database. Untrusted transaction.`,
    };
  }

  // Invariant 2: If active entitlement already exists, reconcile state without duplicate provisioning
  if (entitlement.exists && entitlement.isActive) {
    return {
      decision: 'RECONCILE_EXISTING',
      summary: `Active entitlement (${entitlement.entitlementId}) already exists for order. Reconcile incident to resolved.`,
    };
  }

  // Invariant 3: Handle transient provider errors
  if (paystack.outcome === 'API_ERROR') {
    const isRetryable = Boolean(paystack.retryable);
    const retryCount = priorAttempts.retryCount ?? 0;

    if (isRetryable && retryCount < 5) {
      return {
        decision: 'RETRY_LATER',
        summary: `Transient Paystack error (${paystack.error}). Retries remaining (${retryCount}/5). Backoff scheduled.`,
      };
    }

    return {
      decision: 'ESCALATE',
      summary: `Paystack API error (${paystack.error}) is non-retryable or retries exhausted (${retryCount}/5).`,
    };
  }

  // Invariant 4: Transaction must be successfully verified
  if (paystack.outcome !== 'SUCCESS' || !paystack.verified) {
    const gwResp = 'gatewayResponse' in paystack ? paystack.gatewayResponse : 'none';
    return {
      decision: 'ESCALATE',
      summary: `Paystack transaction verification did not succeed (outcome: ${paystack.outcome}, gatewayResponse: ${gwResp || 'none'}).`,
    };
  }

  // Invariant 5: Deterministic Mathematical and Identity Equality
  const amountMatches = paystack.amount === order.expectedAmount;
  const currencyMatches = paystack.currency?.toUpperCase() === order.currency?.toUpperCase();
  const customerEmailMatches =
    paystack.customerEmail?.toLowerCase() === order.customerEmail?.toLowerCase();

  if (!amountMatches || !currencyMatches || !customerEmailMatches) {
    const discrepancies: string[] = [];
    if (!amountMatches) {
      discrepancies.push(`Amount mismatch (order: ${order.expectedAmount}, paystack: ${paystack.amount})`);
    }
    if (!currencyMatches) {
      discrepancies.push(`Currency mismatch (order: ${order.currency}, paystack: ${paystack.currency})`);
    }
    if (!customerEmailMatches) {
      discrepancies.push(`Email mismatch (order: ${order.customerEmail}, paystack: ${paystack.customerEmail})`);
    }

    return {
      decision: 'ESCALATE',
      summary: `Payment details do not match trusted order: ${discrepancies.join('; ')}. Escalating for manual review.`,
    };
  }

  // Invariant 6: All checks pass -> Propose Recovery
  return {
    decision: 'PROPOSE_RECOVERY',
    summary: `Verified Paystack payment of ${paystack.amount} ${paystack.currency} for ${paystack.customerEmail} matches trusted order ${order.orderId}. Proposing deterministic entitlement recovery.`,
  };
}
