import crypto from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../db';
import { incidents, orders, entitlements, auditLogs, customers, subscriptionPlans } from '../db/schema';
import { entitlementService } from './entitlement';
import { type InvestigationResult } from '../agent/investigator';
import { trace, log } from 'neatlogs';

export type GateDecision =
  | { authorized: true; reason: string }
  | { authorized: false; reason: string; securityViolation: boolean };

export interface RecoveryExecutionOutcome {
  success: boolean;
  incidentId: string;
  orderId: string;
  decision: 'RESOLVED' | 'ESCALATED' | 'RETRY_SCHEDULED';
  reason: string;
  entitlementId?: string;
}

/**
 * Deterministic Authorization Gate & Resolution Committer
 * 
 * Strict Trust Boundaries:
 * - LLM is an investigative reasoning engine, NEVER the mutating executioner.
 * - Identity and pricing derived strictly from authoritative database records.
 * - Guarded by 7 deterministic checks before any state mutation is permitted.
 * - Resolution transitions to RESOLVED ONLY after independent fresh read confirmation.
 */
export class RecoveryService {
  /**
   * Evaluates the deterministic authorization gate rules against authoritative data.
   */
  public evaluateAuthorizationGate(
    order: { id: string; expectedAmount: number; currency: string; customerId: string; paymentReference: string },
    customer: { id: string; email: string },
    investigation: InvestigationResult
  ): GateDecision {
    const { paystack } = investigation.evidence;

    // Gate Check 1: Paystack verification must be definitive SUCCESS
    if (paystack.outcome !== 'SUCCESS' || !paystack.verified) {
      return {
        authorized: false,
        reason: `Paystack verification not successful (outcome: ${paystack.outcome})`,
        securityViolation: false,
      };
    }

    // Gate Check 2: Mathematical equality of paid amount (in kobo/minor units)
    if (paystack.amount !== order.expectedAmount) {
      return {
        authorized: false,
        reason: `Paid amount (${paystack.amount}) does not match trusted order expected amount (${order.expectedAmount})`,
        securityViolation: true,
      };
    }

    // Gate Check 3: Currency code equality
    if (paystack.currency?.toUpperCase() !== order.currency?.toUpperCase()) {
      return {
        authorized: false,
        reason: `Currency (${paystack.currency}) does not match order currency (${order.currency})`,
        securityViolation: true,
      };
    }

    // Gate Check 4: Payer email matches trusted order customer
    if (paystack.customerEmail?.toLowerCase() !== customer.email?.toLowerCase()) {
      return {
        authorized: false,
        reason: `Payer email (${paystack.customerEmail}) does not match trusted customer email (${customer.email})`,
        securityViolation: true,
      };
    }

    // Gate Check 5: Payment reference matches trusted order reference
    if (paystack.reference !== order.paymentReference) {
      return {
        authorized: false,
        reason: `Paystack reference (${paystack.reference}) does not match order reference (${order.paymentReference})`,
        securityViolation: true,
      };
    }

    return {
      authorized: true,
      reason: 'All deterministic verification invariants satisfied: amount, currency, email, and reference match trusted order.',
    };
  }

  /**
   * Authorizes and executes entitlement recovery for an incident under worker lease.
   */
  public async authorizeAndExecuteRecovery(
    incidentId: string,
    fencingToken: number,
    leaseOwner: string,
    investigation: InvestigationResult
  ): Promise<RecoveryExecutionOutcome> {
    return await trace(
      {
        name: 'deterministic_authorization_guardrail',
        kind: 'GUARDRAIL',
        tags: ['authorization_gate', 'recovery'],
      },
      async (guardrailSpan) => {
        // Step 1: Validate worker lease ownership & fencing token in database
        const [currentIncident] = await db
          .select()
          .from(incidents)
          .where(
            and(
              eq(incidents.id, incidentId),
              eq(incidents.fencingToken, fencingToken),
              eq(incidents.leaseOwner, leaseOwner)
            )
          )
          .limit(1);

        if (!currentIncident) {
          guardrailSpan?.setAttribute('guardrail.decision', 'REJECTED');
          guardrailSpan?.setAttribute('guardrail.reason', 'STALE_LEASE_OR_FENCING_TOKEN');
          throw new Error(`Worker lease invalid or preempted for incident ${incidentId}`);
        }

        // Step 2: Authoritative order and customer lookup
        const [orderData] = await db
          .select({
            order: orders,
            customer: customers,
            plan: subscriptionPlans,
          })
          .from(orders)
          .innerJoin(customers, eq(orders.customerId, customers.id))
          .innerJoin(subscriptionPlans, eq(orders.planId, subscriptionPlans.id))
          .where(eq(orders.id, currentIncident.orderId))
          .limit(1);

        if (!orderData) {
          await this.escalateIncident(
            incidentId,
            fencingToken,
            leaseOwner,
            'Order or customer record not found for incident.'
          );
          return {
            success: false,
            incidentId,
            orderId: currentIncident.orderId,
            decision: 'ESCALATED',
            reason: 'Order or customer record not found.',
          };
        }

        // Step 3: Run Deterministic Authorization Gate
        const gateCheck = this.evaluateAuthorizationGate(
          orderData.order,
          orderData.customer,
          investigation
        );

        guardrailSpan?.setAttribute(
          'guardrail.decision',
          gateCheck.authorized ? 'AUTHORIZED' : 'REJECTED'
        );
        guardrailSpan?.setAttribute('guardrail.reason', gateCheck.reason);

        if (!gateCheck.authorized) {
          log('Deterministic authorization rejected for incident {incidentId}: {reason}', {
            incidentId,
            reason: gateCheck.reason,
          });

          await this.escalateIncident(
            incidentId,
            fencingToken,
            leaseOwner,
            `Gate rejected: ${gateCheck.reason}`
          );

          return {
            success: false,
            incidentId,
            orderId: currentIncident.orderId,
            decision: 'ESCALATED',
            reason: gateCheck.reason,
          };
        }

        // Step 4: Ensure order state is marked PAID so provisionEntitlement succeeds
        if (orderData.order.status !== 'PAID' && orderData.order.status !== 'FULFILLED') {
          await db
            .update(orders)
            .set({ status: 'PAID', paidAt: new Date(), updatedAt: new Date() })
            .where(eq(orders.id, orderData.order.id));
        }

        // Step 5: Provision entitlement idempotently
        const provisionOutcome = await entitlementService.provisionEntitlement(
          orderData.order.id,
          orderData.order.paymentReference
        );

        if (!provisionOutcome.success && provisionOutcome.code !== 'ALREADY_FULFILLED') {
          log('Provisioning failed during recovery for incident {incidentId}: {error}', {
            incidentId,
            error: provisionOutcome.error,
          });

          // If retryable failure, schedule retry; otherwise escalate
          const isRetryable = provisionOutcome.code === 'PROVISIONING_FAILED';
          if (isRetryable && currentIncident.retryCount < 5) {
            await this.scheduleIncidentRetry(
              incidentId,
              fencingToken,
              leaseOwner,
              provisionOutcome.error
            );
            return {
              success: false,
              incidentId,
              orderId: currentIncident.orderId,
              decision: 'RETRY_SCHEDULED',
              reason: provisionOutcome.error,
            };
          }

          await this.escalateIncident(
            incidentId,
            fencingToken,
            leaseOwner,
            `Provisioning failed: ${provisionOutcome.error}`
          );
          return {
            success: false,
            incidentId,
            orderId: currentIncident.orderId,
            decision: 'ESCALATED',
            reason: provisionOutcome.error,
          };
        }

        // Step 6: INDEPENDENT RESOLUTION VERIFICATION
        // An incident transitions to RESOLVED only when a fresh, independent query
        // directly confirms that the customer has active access.
        const activeRecord = await entitlementService.getAuthoritativeEntitlement(
          orderData.order.id
        );

        if (!activeRecord || !entitlementService.isEntitlementActive(activeRecord.entitlement)) {
          throw new Error(
            `Independent resolution verification failed: active entitlement not confirmed for order ${orderData.order.id}`
          );
        }

        // Step 7: Transition Incident to RESOLVED
        const now = new Date();
        await db
          .update(incidents)
          .set({
            status: 'RESOLVED',
            lastDecision: 'PROPOSE_RECOVERY',
            decisionSummary: investigation.summary,
            resolvedAt: now,
            updatedAt: now,
            leaseOwner: null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(incidents.id, incidentId),
              eq(incidents.fencingToken, fencingToken),
              eq(incidents.leaseOwner, leaseOwner)
            )
          );

        // Record resolution in audit log
        await db.insert(auditLogs).values({
          id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
          orderId: orderData.order.id,
          incidentId,
          action: 'INCIDENT_RESOLVED',
          actor: 'RECOVERY_WORKER',
          details: `Autonomous recovery complete. Entitlement ${activeRecord.entitlement.id} verified active until ${activeRecord.entitlement.expiresAt.toISOString()}`,
        });

        log('Incident {incidentId} successfully resolved and verified', {
          incidentId,
          entitlementId: activeRecord.entitlement.id,
        });

        return {
          success: true,
          incidentId,
          orderId: orderData.order.id,
          decision: 'RESOLVED',
          reason: 'Autonomous recovery authorized and resolution independently confirmed.',
          entitlementId: activeRecord.entitlement.id,
        };
      }
    );
  }

  /**
   * Reconciles an incident where active entitlement was already found.
   */
  public async reconcileExistingEntitlement(
    incidentId: string,
    fencingToken: number,
    leaseOwner: string,
    summary: string
  ): Promise<RecoveryExecutionOutcome> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.id, incidentId),
          eq(incidents.fencingToken, fencingToken),
          eq(incidents.leaseOwner, leaseOwner)
        )
      )
      .limit(1);

    if (!incident) {
      throw new Error(`Worker lease invalid or preempted for incident ${incidentId}`);
    }

    // Fresh authoritative verification
    const activeRecord = await entitlementService.getAuthoritativeEntitlement(incident.orderId);
    if (!activeRecord || !entitlementService.isEntitlementActive(activeRecord.entitlement)) {
      throw new Error(
        `Cannot reconcile: active entitlement not confirmed for order ${incident.orderId}`
      );
    }

    const now = new Date();
    await db
      .update(incidents)
      .set({
        status: 'RESOLVED',
        lastDecision: 'RECONCILE_EXISTING',
        decisionSummary: summary,
        resolvedAt: now,
        updatedAt: now,
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(incidents.id, incidentId),
          eq(incidents.fencingToken, fencingToken),
          eq(incidents.leaseOwner, leaseOwner)
        )
      );

    await db.insert(auditLogs).values({
      id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      orderId: incident.orderId,
      incidentId,
      action: 'INCIDENT_RECONCILED',
      actor: 'RECOVERY_WORKER',
      details: `Incident resolved via reconciliation: existing active entitlement ${activeRecord.entitlement.id} confirmed.`,
    });

    return {
      success: true,
      incidentId,
      orderId: incident.orderId,
      decision: 'RESOLVED',
      reason: 'Existing active entitlement verified and reconciled.',
      entitlementId: activeRecord.entitlement.id,
    };
  }

  /**
   * Schedules bounded exponential retry for transient errors.
   */
  public async scheduleIncidentRetry(
    incidentId: string,
    fencingToken: number,
    leaseOwner: string,
    errorDetail: string
  ): Promise<void> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.id, incidentId),
          eq(incidents.fencingToken, fencingToken),
          eq(incidents.leaseOwner, leaseOwner)
        )
      )
      .limit(1);

    if (!incident) return;

    const nextRetryCount = incident.retryCount + 1;
    // Exponential backoff: 2s, 4s, 8s, 16s, 32s (capped at 60s)
    const backoffMs = Math.min(60000, Math.pow(2, nextRetryCount) * 1000);
    const nextRetryAt = new Date(Date.now() + backoffMs);

    await db
      .update(incidents)
      .set({
        status: 'OPEN',
        retryCount: nextRetryCount,
        nextRetryAt,
        lastDecision: 'RETRY_LATER',
        errorDetail,
        updatedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(incidents.id, incidentId),
          eq(incidents.fencingToken, fencingToken),
          eq(incidents.leaseOwner, leaseOwner)
        )
      );

    await db.insert(auditLogs).values({
      id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      orderId: incident.orderId,
      incidentId,
      action: 'RETRY_SCHEDULED',
      actor: 'RECOVERY_WORKER',
      details: `Retry #${nextRetryCount} scheduled for ${nextRetryAt.toISOString()}: ${errorDetail}`,
    });
  }

  /**
   * Transitions an incident to ESCALATED when unresolvable or security violations occur.
   */
  public async escalateIncident(
    incidentId: string,
    fencingToken: number,
    leaseOwner: string,
    reason: string
  ): Promise<void> {
    const [incident] = await db
      .select()
      .from(incidents)
      .where(
        and(
          eq(incidents.id, incidentId),
          eq(incidents.fencingToken, fencingToken),
          eq(incidents.leaseOwner, leaseOwner)
        )
      )
      .limit(1);

    if (!incident) return;

    await db
      .update(incidents)
      .set({
        status: 'ESCALATED',
        lastDecision: 'ESCALATE',
        decisionSummary: reason,
        updatedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(incidents.id, incidentId),
          eq(incidents.fencingToken, fencingToken),
          eq(incidents.leaseOwner, leaseOwner)
        )
      );

    await db.insert(auditLogs).values({
      id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      orderId: incident.orderId,
      incidentId,
      action: 'INCIDENT_ESCALATED',
      actor: 'RECOVERY_WORKER',
      details: `Incident escalated for operator review: ${reason}`,
    });
  }
}

export const recoveryService = new RecoveryService();
