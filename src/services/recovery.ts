import crypto from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';
import { db, queryClient } from '../db';
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
 * Strict Trust Boundaries & Hardened Mutation Boundaries:
 * - LLM is an investigative reasoning engine, NEVER the mutating executioner.
 * - Identity and pricing derived strictly from authoritative database records.
 * - Guarded by 7 deterministic checks before any state mutation is permitted.
 * - Zero TOCTOU Gap: All mutations verify fencing token, worker lease ownership,
 *   AND unexpired lease duration (lease_expires_at > now()) inside an atomic transaction.
 * - Resolution transitions to RESOLVED ONLY after independent fresh read confirmation
 *   validating exact order, customer, plan, reference, ACTIVE status, and unexpired access.
 */
export class RecoveryService {
  /**
   * Evaluates deterministic authorization gate rules against authoritative data.
   */
  public evaluateAuthorizationGate(
    order: { id: string; expectedAmount: number; currency: string; customerId: string; paymentReference: string },
    customer: { id: string; email: string },
    investigation: InvestigationResult
  ): GateDecision {
    const paystack = investigation.evidence.paystack as {
      outcome?: string;
      verified?: boolean;
      amount?: number;
      currency?: string;
      customerEmail?: string;
      reference?: string;
    } | undefined;

    // Gate Check 1: Paystack verification must be definitive SUCCESS
    if (!paystack || paystack.outcome !== 'SUCCESS' || !paystack.verified) {
      return {
        authorized: false,
        reason: `Paystack verification not successful (outcome: ${paystack?.outcome || 'none'})`,
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
   * Hardened at the mutation boundary to eliminate TOCTOU race conditions.
   */
  public async authorizeAndExecuteRecovery(
    incidentId: string,
    fencingToken: number,
    leaseOwner: string,
    investigation: InvestigationResult,
    options?: {
      paystackAdapter?: import('../lib/paystack').PaystackVerificationAdapter;
      executionMode?: string;
    }
  ): Promise<RecoveryExecutionOutcome> {
    return await trace(
      {
        name: 'deterministic_authorization_guardrail',
        kind: 'GUARDRAIL',
        tags: ['authorization_gate', 'recovery'],
      },
      async (guardrailSpan) => {
        // Step 1: Pre-authorization validation of worker lease ownership & fencing token
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

        // Check lease expiration
        if (!currentIncident.leaseExpiresAt || new Date(currentIncident.leaseExpiresAt).getTime() <= Date.now()) {
          guardrailSpan?.setAttribute('guardrail.decision', 'REJECTED');
          guardrailSpan?.setAttribute('guardrail.reason', 'LEASE_EXPIRED');
          throw new Error(`Worker lease expired before authorization for incident ${incidentId}`);
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

        // Step 4: ATOMIC PROVISIONING TRANSACTION
        // Sets intermediate durable state 'PROVISIONED' under lease lock.
        // Crucial invariant: does NOT transition to 'RESOLVED' until independent verification passes.
        const entitlementId = `ent_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const provisionAuditId = `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const startedAt = new Date();
        const expiresAt = new Date(startedAt.getTime() + orderData.plan.durationDays * 24 * 60 * 60 * 1000);

        const mutationOutcome = await queryClient.begin(async (tx) => {
          // 1. Strict row-level verification of current lease validity at exact mutation moment
          const lockedIncidents = await tx<Array<{
            id: string;
            fencing_token: number;
            lease_owner: string;
            lease_expires_at: Date;
          }>>`
            SELECT id, fencing_token, lease_owner, lease_expires_at
            FROM incidents
            WHERE id = ${incidentId}
              AND fencing_token = ${fencingToken}
              AND lease_owner = ${leaseOwner}
              AND lease_expires_at > now()
            FOR UPDATE
          `;

          if (lockedIncidents.length === 0) {
            throw new Error(
              `Worker lease preempted or expired at mutation boundary for incident ${incidentId}`
            );
          }

          // 2. Check if entitlement already created in database
          const existingEnts = await tx<Array<{
            id: string;
            customer_id: string;
            plan_id: string;
            source_reference: string;
            status: string;
            expires_at: Date;
          }>>`
            SELECT id, customer_id, plan_id, source_reference, status, expires_at
            FROM entitlements
            WHERE order_id = ${orderData.order.id}
            LIMIT 1
          `;

          let finalEntId = existingEnts[0]?.id;

          if (finalEntId) {
            // Strictly validate existing record matches trusted order
            const e = existingEnts[0];
            if (
              e.customer_id !== orderData.customer.id ||
              e.plan_id !== orderData.plan.id ||
              e.source_reference !== orderData.order.paymentReference ||
              e.status !== 'ACTIVE' ||
              new Date(e.expires_at).getTime() <= Date.now()
            ) {
              throw new Error(
                `Existing entitlement ${finalEntId} violates integrity invariants for order ${orderData.order.id}`
              );
            }
          } else {
            // 3. Atomically insert new entitlement
            const inserted = await tx<Array<{ id: string }>>`
              INSERT INTO entitlements (
                id, order_id, customer_id, plan_id, source_reference, status, started_at, expires_at, created_at, updated_at
              ) VALUES (
                ${entitlementId},
                ${orderData.order.id},
                ${orderData.customer.id},
                ${orderData.plan.id},
                ${orderData.order.paymentReference},
                'ACTIVE',
                ${startedAt.toISOString()},
                ${expiresAt.toISOString()},
                now(),
                now()
              )
              ON CONFLICT (order_id) DO NOTHING
              RETURNING id
            `;

            if (inserted.length > 0) {
              finalEntId = inserted[0].id;
            } else {
              // Raced insert! Fetch the winning record and validate it
              const raced = await tx<Array<{
                id: string;
                customer_id: string;
                plan_id: string;
                source_reference: string;
                status: string;
                expires_at: Date;
              }>>`
                SELECT id, customer_id, plan_id, source_reference, status, expires_at
                FROM entitlements
                WHERE order_id = ${orderData.order.id}
                LIMIT 1
              `;
              if (
                !raced[0] ||
                raced[0].customer_id !== orderData.customer.id ||
                raced[0].plan_id !== orderData.plan.id ||
                raced[0].source_reference !== orderData.order.paymentReference ||
                raced[0].status !== 'ACTIVE' ||
                new Date(raced[0].expires_at).getTime() <= Date.now()
              ) {
                throw new Error(
                  `Entitlement insertion was skipped on conflict but no valid record found for order ${orderData.order.id}`
                );
              }
              finalEntId = raced[0].id;
            }
          }

          // 4. Atomically update order to FULFILLED
          await tx`
            UPDATE orders
            SET status = 'FULFILLED', updated_at = now()
            WHERE id = ${orderData.order.id}
          `;

          // 5. Atomically update incident to intermediate durable state 'PROVISIONED'
          // Worker lease is preserved across the verification boundary!
          const updatedIncidents = await tx<Array<{ id: string }>>`
            UPDATE incidents
            SET
              status = 'PROVISIONED',
              last_decision = 'PROPOSE_RECOVERY',
              decision_summary = ${investigation.summary},
              updated_at = now()
            WHERE id = ${incidentId}
              AND fencing_token = ${fencingToken}
              AND lease_owner = ${leaseOwner}
              AND lease_expires_at > now()
            RETURNING id
          `;

          if (updatedIncidents.length === 0) {
            throw new Error(
              `Conditional incident update failed: lost ownership during transaction for incident ${incidentId}`
            );
          }

          // 6. Record audit log for intermediate state
          await tx`
            INSERT INTO audit_logs (id, order_id, incident_id, action, actor, details, created_at)
            VALUES (${provisionAuditId}, ${orderData.order.id}, ${incidentId}, 'ENTITLEMENT_PROVISIONED', 'RECOVERY_WORKER', ${JSON.stringify({
              message: `Entitlement ${finalEntId} provisioned; awaiting independent verification`,
              entitlementId: finalEntId,
              executionMode: options?.executionMode || 'PRODUCTION',
            })}, now())
          `;

          return { entitlementId: finalEntId };
        });

        // Step 5: INDEPENDENT RESOLUTION VERIFICATION
        // An incident transitions to RESOLVED only when a fresh, independent query
        // directly confirms that the customer has active access with exact matching fields.
        let activeRecord: Awaited<ReturnType<typeof entitlementService.getAuthoritativeEntitlement>> | null = null;
        let verificationError: string | null = null;

        try {
          activeRecord = await entitlementService.getAuthoritativeEntitlement(
            orderData.order.id
          );

          if (!activeRecord) {
            verificationError = `Entitlement record missing for order ${orderData.order.id}`;
          } else {
            const ent = activeRecord.entitlement;
            if (ent.id !== mutationOutcome.entitlementId) {
              verificationError = `Entitlement ID mismatch: expected ${mutationOutcome.entitlementId}, got ${ent.id}`;
            } else if (ent.orderId !== orderData.order.id) {
              verificationError = `Order ID mismatch: expected ${orderData.order.id}, got ${ent.orderId}`;
            } else if (ent.customerId !== orderData.customer.id) {
              verificationError = `Customer ID mismatch: expected ${orderData.customer.id}, got ${ent.customerId}`;
            } else if (ent.planId !== orderData.plan.id) {
              verificationError = `Plan ID mismatch: expected ${orderData.plan.id}, got ${ent.planId}`;
            } else if (ent.sourceReference !== orderData.order.paymentReference) {
              verificationError = `Payment reference mismatch: expected ${orderData.order.paymentReference}, got ${ent.sourceReference}`;
            } else if (ent.status !== 'ACTIVE') {
              verificationError = `Entitlement status is ${ent.status}, expected ACTIVE`;
            } else if (new Date(ent.expiresAt).getTime() <= Date.now()) {
              verificationError = `Entitlement is expired (expiresAt: ${ent.expiresAt.toISOString()})`;
            }
          }
        } catch (err) {
          verificationError = `Verification query failed: ${(err as Error).message}`;
        }

        // If verification failed, preserve recoverable state (schedule retry) and throw
        if (verificationError || !activeRecord) {
          const reason = verificationError || 'Authoritative entitlement record verification failed';
          log('Independent verification failed for incident {incidentId}: {reason}', {
            incidentId,
            reason,
          });

          await this.scheduleIncidentRetry(
            incidentId,
            fencingToken,
            leaseOwner,
            `Post-provision verification failed: ${reason}`
          );

          throw new Error(`Independent resolution verification failed: ${reason}`);
        }

        // Step 6: CONDITIONAL RESOLUTION COMMIT
        // Only reached if fresh authoritative verification passed completely!
        const resolveAuditId = `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
        await queryClient.begin(async (tx) => {
          const rows = await tx<Array<{ id: string }>>`
            UPDATE incidents
            SET
              status = 'RESOLVED',
              resolved_at = now(),
              updated_at = now(),
              lease_owner = NULL,
              lease_expires_at = NULL
            WHERE id = ${incidentId}
              AND fencing_token = ${fencingToken}
              AND lease_owner = ${leaseOwner}
              AND lease_expires_at > now()
            RETURNING id
          `;

          if (rows.length === 0) {
            throw new Error(
              `Worker lease preempted or expired at resolution boundary for incident ${incidentId}`
            );
          }

          await tx`
            INSERT INTO audit_logs (id, order_id, incident_id, action, actor, details, created_at)
            VALUES (${resolveAuditId}, ${orderData.order.id}, ${incidentId}, 'INCIDENT_RESOLVED', 'RECOVERY_WORKER', ${JSON.stringify({
              message: `Autonomous recovery verified: Entitlement ${activeRecord.entitlement.id} confirmed ACTIVE`,
              entitlementId: activeRecord.entitlement.id,
              executionMode: options?.executionMode || 'PRODUCTION',
            })}, now())
          `;
        });

        log('Incident {incidentId} successfully resolved and verified independently', {
          incidentId,
          entitlementId: activeRecord.entitlement.id,
        });

        return {
          success: true,
          incidentId,
          orderId: orderData.order.id,
          decision: 'RESOLVED',
          reason: 'Autonomous recovery authorized, atomically committed, and independently confirmed.',
          entitlementId: activeRecord.entitlement.id,
        };
      }
    );
  }

  public static readonly MAX_INCIDENT_RETRIES = 5;

  /**
   * Reconciles an incident where active entitlement was already found.
   * Atomically verifies exact customer, plan, reference, and unexpired access
   * before and during commit under row lock.
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

    if (!incident.leaseExpiresAt || new Date(incident.leaseExpiresAt).getTime() <= Date.now()) {
      throw new Error(`Worker lease expired for incident ${incidentId}`);
    }

    // 1. Fetch trusted order record to verify exact binding identity
    const [orderData] = await db
      .select({
        order: orders,
        customer: customers,
        plan: subscriptionPlans,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id))
      .innerJoin(subscriptionPlans, eq(orders.planId, subscriptionPlans.id))
      .where(eq(orders.id, incident.orderId))
      .limit(1);

    if (!orderData) {
      throw new Error(`Cannot reconcile: trusted order record missing for ${incident.orderId}`);
    }

    // 2. Fresh authoritative verification confirming exact identity and active status
    const activeRecord = await entitlementService.getAuthoritativeEntitlement(incident.orderId);
    if (
      !activeRecord ||
      activeRecord.entitlement.orderId !== incident.orderId ||
      activeRecord.entitlement.customerId !== orderData.customer.id ||
      activeRecord.entitlement.planId !== orderData.plan.id ||
      activeRecord.entitlement.sourceReference !== orderData.order.paymentReference ||
      activeRecord.entitlement.status !== 'ACTIVE' ||
      new Date(activeRecord.entitlement.expiresAt).getTime() <= Date.now()
    ) {
      throw new Error(
        `Cannot reconcile: active entitlement not confirmed or identity mismatch for order ${incident.orderId}`
      );
    }

    const auditId = `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    // 3. Atomic conditional update & commit-boundary re-validation under row lock
    await queryClient.begin(async (tx) => {
      // Re-validate entitlement state under row lock to avoid read/write race
      const lockedEnts = await tx<Array<{
        id: string;
        customer_id: string;
        plan_id: string;
        source_reference: string;
        status: string;
        expires_at: Date;
      }>>`
        SELECT id, customer_id, plan_id, source_reference, status, expires_at
        FROM entitlements
        WHERE order_id = ${incident.orderId}
        FOR UPDATE
      `;

      if (
        lockedEnts.length === 0 ||
        lockedEnts[0].customer_id !== orderData.customer.id ||
        lockedEnts[0].plan_id !== orderData.plan.id ||
        lockedEnts[0].source_reference !== orderData.order.paymentReference ||
        lockedEnts[0].status !== 'ACTIVE' ||
        new Date(lockedEnts[0].expires_at).getTime() <= Date.now()
      ) {
        throw new Error(
          `Cannot reconcile: entitlement state invalid or revoked at commit boundary for order ${incident.orderId}`
        );
      }

      const rows = await tx<Array<{ id: string }>>`
        UPDATE incidents
        SET
          status = 'RESOLVED',
          last_decision = 'RECONCILE_EXISTING',
          decision_summary = ${summary},
          resolved_at = now(),
          updated_at = now(),
          lease_owner = NULL,
          lease_expires_at = NULL
        WHERE id = ${incidentId}
          AND fencing_token = ${fencingToken}
          AND lease_owner = ${leaseOwner}
          AND lease_expires_at > now()
        RETURNING id
      `;

      if (rows.length === 0) {
        throw new Error(`Worker lease preempted or expired at reconciliation boundary for incident ${incidentId}`);
      }

      await tx`
        INSERT INTO audit_logs (id, order_id, incident_id, action, actor, details, created_at)
        VALUES (${auditId}, ${incident.orderId}, ${incidentId}, 'INCIDENT_RECONCILED', 'RECOVERY_WORKER', 'Incident resolved via reconciliation: existing active entitlement confirmed.', now())
      `;
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
   * Enforces finite retry limit and unexpired lease ownership.
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

    if (!incident.leaseExpiresAt || new Date(incident.leaseExpiresAt).getTime() <= Date.now()) {
      throw new Error(`Worker lease expired for incident ${incidentId}`);
    }

    const nextRetryCount = incident.retryCount + 1;

    // Enforce finite retry limit: escalate if retry budget exhausted
    if (nextRetryCount > RecoveryService.MAX_INCIDENT_RETRIES) {
      log('Maximum retry count ({max}) reached for incident {incidentId}. Escalating.', {
        max: RecoveryService.MAX_INCIDENT_RETRIES,
        incidentId,
      });

      await this.escalateIncident(
        incidentId,
        fencingToken,
        leaseOwner,
        `RETRY_EXHAUSTED: Maximum retry attempts (${RecoveryService.MAX_INCIDENT_RETRIES}) reached without resolution. ${errorDetail}`
      );
      return;
    }

    const backoffMs = Math.min(60000, Math.pow(2, nextRetryCount) * 1000);
    const nextRetryAt = new Date(Date.now() + backoffMs);
    const auditId = `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await queryClient.begin(async (tx) => {
      const rows = await tx<Array<{ id: string }>>`
        UPDATE incidents
        SET
          status = 'OPEN',
          retry_count = ${nextRetryCount},
          next_retry_at = ${nextRetryAt.toISOString()},
          last_decision = 'RETRY_LATER',
          error_detail = ${errorDetail},
          updated_at = now(),
          lease_owner = NULL,
          lease_expires_at = NULL
        WHERE id = ${incidentId}
          AND fencing_token = ${fencingToken}
          AND lease_owner = ${leaseOwner}
          AND lease_expires_at > now()
        RETURNING id
      `;

      if (rows.length === 0) {
        throw new Error(`Worker lease preempted or expired at retry scheduling for incident ${incidentId}`);
      }

      await tx`
        INSERT INTO audit_logs (id, order_id, incident_id, action, actor, details, created_at)
        VALUES (${auditId}, ${incident.orderId}, ${incidentId}, 'RETRY_SCHEDULED', 'RECOVERY_WORKER', ${`Retry #${nextRetryCount} scheduled: ${errorDetail}`}, now())
      `;
    });
  }

  /**
   * Transitions an incident to ESCALATED when unresolvable or security violations occur.
   * Enforces unexpired lease ownership.
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

    if (!incident.leaseExpiresAt || new Date(incident.leaseExpiresAt).getTime() <= Date.now()) {
      throw new Error(`Worker lease expired for incident ${incidentId}`);
    }

    const auditId = `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await queryClient.begin(async (tx) => {
      const rows = await tx<Array<{ id: string }>>`
        UPDATE incidents
        SET
          status = 'ESCALATED',
          last_decision = 'ESCALATE',
          decision_summary = ${reason},
          updated_at = now(),
          lease_owner = NULL,
          lease_expires_at = NULL
        WHERE id = ${incidentId}
          AND fencing_token = ${fencingToken}
          AND lease_owner = ${leaseOwner}
          AND lease_expires_at > now()
        RETURNING id
      `;

      if (rows.length === 0) {
        throw new Error(`Worker lease preempted or expired at escalation for incident ${incidentId}`);
      }

      await tx`
        INSERT INTO audit_logs (id, order_id, incident_id, action, actor, details, created_at)
        VALUES (${auditId}, ${incident.orderId}, ${incidentId}, 'INCIDENT_ESCALATED', 'RECOVERY_WORKER', ${`Incident escalated: ${reason}`}, now())
      `;
    });
  }
}

export const recoveryService = new RecoveryService();
