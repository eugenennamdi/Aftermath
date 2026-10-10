import crypto from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, queryClient } from '../db';
import { incidents, orders, auditLogs } from '../db/schema';
import { investigateIncident } from '../agent/investigator';
import { recoveryService } from '../services/recovery';
import { getPaidUnfulfilledOrders, getPendingOrdersForReconciliation, createOrGetIncident } from '../services/incident';
import { paystackClient, type PaystackVerificationAdapter } from '../lib/paystack';
import { initNeatlogs } from '../lib/neatlogs';
import { trace, flush, log } from 'neatlogs';

export interface ClaimedIncident {
  id: string;
  orderId: string;
  paymentReference: string;
  customerId: string;
  fencingToken: number;
  leaseOwner: string;
}

export class RecoveryWorker {
  public readonly workerId: string;
  private isRunning: boolean = false;
  private pollIntervalMs: number;
  private loopTimer: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private readonly paystackAdapter?: PaystackVerificationAdapter;

  constructor(options?: {
    pollIntervalMs?: number;
    workerId?: string;
    paystackAdapter?: PaystackVerificationAdapter;
  }) {
    this.workerId = options?.workerId || `worker_${process.pid}_${crypto.randomUUID().slice(0, 8)}`;
    this.pollIntervalMs = options?.pollIntervalMs ?? 1000;
    this.paystackAdapter = options?.paystackAdapter;
  }

  /**
   * Transactional claiming with FOR UPDATE SKIP LOCKED.
   * Atomically claims eligible incident, increments fencing token, sets lease.
   * Closes the transaction immediately so NO locks are held during downstream work.
   */
  public async claimNextIncident(specificIncidentId?: string): Promise<ClaimedIncident | null> {
    const claimedRows = await queryClient.begin(async (tx) => {
      // 1. Select candidate with FOR UPDATE SKIP LOCKED
      const candidates = specificIncidentId
        ? await tx<Array<{
            id: string;
            order_id: string;
            payment_reference: string;
            customer_id: string;
            fencing_token: number;
          }>>`
            SELECT id, order_id, payment_reference, customer_id, fencing_token
            FROM incidents
            WHERE id = ${specificIncidentId}
              AND (
                (status = 'OPEN' AND (next_retry_at IS NULL OR next_retry_at <= now()))
                OR
                (status IN ('INVESTIGATING', 'PROVISIONED') AND lease_expires_at < now())
              )
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          `
        : await tx<Array<{
            id: string;
            order_id: string;
            payment_reference: string;
            customer_id: string;
            fencing_token: number;
          }>>`
            SELECT id, order_id, payment_reference, customer_id, fencing_token
            FROM incidents
            WHERE (
              (status = 'OPEN' AND (next_retry_at IS NULL OR next_retry_at <= now()))
              OR
              (status IN ('INVESTIGATING', 'PROVISIONED') AND lease_expires_at < now())
            )
            ORDER BY created_at DESC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
          `;

      if (candidates.length === 0) {
        return null;
      }

      const candidate = candidates[0];
      const nextFencingToken = candidate.fencing_token + 1;

      // 2. Atomically update lease and increment fencing token
      const updated = await tx<Array<{
        id: string;
        order_id: string;
        payment_reference: string;
        customer_id: string;
        fencing_token: number;
        lease_owner: string;
      }>>`
        UPDATE incidents
        SET
          status = 'INVESTIGATING',
          fencing_token = ${nextFencingToken},
          lease_owner = ${this.workerId},
          lease_expires_at = now() + interval '30 seconds',
          updated_at = now()
        WHERE id = ${candidate.id}
        RETURNING id, order_id, payment_reference, customer_id, fencing_token, lease_owner
      `;

      return updated[0] || null;
    });

    if (!claimedRows) return null;

    return {
      id: claimedRows.id,
      orderId: claimedRows.order_id,
      paymentReference: claimedRows.payment_reference,
      customerId: claimedRows.customer_id,
      fencingToken: claimedRows.fencing_token,
      leaseOwner: claimedRows.lease_owner,
    };
  }

  /**
   * Extends the worker's active lease atomically.
   * Conditional on current lease ownership, fencing token, and unexpired lease.
   */
  public async extendLease(
    incidentId: string,
    fencingToken: number,
    durationSeconds: number = 30
  ): Promise<boolean> {
    const updated = await queryClient<Array<{ id: string }>>`
      UPDATE incidents
      SET
        lease_expires_at = now() + (${durationSeconds} * interval '1 second'),
        updated_at = now()
      WHERE id = ${incidentId}
        AND fencing_token = ${fencingToken}
        AND lease_owner = ${this.workerId}
        AND lease_expires_at > now()
      RETURNING id
    `;
    return updated.length > 0;
  }

  /**
   * Processes a single claimed incident through the autonomous recovery pipeline.
   * Runs background lease heartbeat, bounds model calls with timeout, and checks lease validity at boundaries.
   */
  public async processClaimedIncident(
    incident: ClaimedIncident,
    options?: import('../agent/investigator').InvestigationOptions & {
      heartbeatIntervalMs?: number;
      leaseDurationSeconds?: number;
      investigationTimeoutMs?: number;
      executionMode?: string;
    }
  ): Promise<{
    incidentId: string;
    decision: string;
    modelUsed: string;
    turnsExecuted: number;
    toolSequence: string[];
    outcome: Record<string, unknown>;
  }> {
    await initNeatlogs();

    return await trace(
      {
        name: 'aftermath_recovery_workflow',
        kind: 'WORKFLOW',
        tags: ['recovery_worker', this.workerId],
      },
      async (workflowSpan) => {
        workflowSpan?.setAttribute('aftermath.incident_id', incident.id);
        workflowSpan?.setAttribute('aftermath.order_id', incident.orderId);
        workflowSpan?.setAttribute('aftermath.worker_id', this.workerId);
        workflowSpan?.setAttribute('aftermath.fencing_token', incident.fencingToken);
        workflowSpan?.setAttribute('aftermath.execution_mode', options?.executionMode ?? 'PRODUCTION');

        log('Worker {workerId} claimed incident {incidentId} (fencing token: {fencingToken})', {
          workerId: this.workerId,
          incidentId: incident.id,
          fencingToken: incident.fencingToken,
        });

        const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? 10000;
        const leaseDurationSeconds = options?.leaseDurationSeconds ?? 30;
        const timeoutMs = options?.investigationTimeoutMs ?? 60000;

        let leaseActive = true;
        let leaseError: Error | null = null;
        let heartbeatTimer: NodeJS.Timeout | null = null;

        // Background Heartbeat Lease Renewal
        if (heartbeatIntervalMs > 0) {
          heartbeatTimer = setInterval(async () => {
            try {
              const renewed = await this.extendLease(incident.id, incident.fencingToken, leaseDurationSeconds);
              if (!renewed) {
                leaseActive = false;
                leaseError = new Error(`Worker ${this.workerId} lost lease for incident ${incident.id}`);
                if (heartbeatTimer) clearInterval(heartbeatTimer);
              }
            } catch (err) {
              log('Heartbeat lease renewal failed: {error}', { error: (err as Error).message });
            }
          }, heartbeatIntervalMs);
        }

        const effectiveAdapter = options?.paystackAdapter || this.paystackAdapter;
        const effectiveExecutionMode = options?.executionMode || 'PRODUCTION';

        // Record processing start in audit logs with executionMode
        try {
          await db.insert(auditLogs).values({
            id: `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
            incidentId: incident.id,
            orderId: incident.orderId,
            action: 'INCIDENT_PROCESSING_STARTED',
            actor: 'RECOVERY_WORKER',
            details: JSON.stringify({
              workerId: this.workerId,
              fencingToken: incident.fencingToken,
              executionMode: effectiveExecutionMode,
            }),
          });
        } catch {
          // Non-blocking audit record
        }

        try {
          // Step 1: Execute Autonomous Investigator Agent with bounded timeout
          const investigationPromise = investigateIncident(
            incident.id,
            incident.orderId,
            incident.paymentReference,
            {
              ...options,
              paystackAdapter: effectiveAdapter,
              executionMode: effectiveExecutionMode,
            }
          );

          const timeoutPromise = new Promise<never>((_, reject) => {
            const t = setTimeout(() => {
              reject(new Error(`Investigation timed out after ${timeoutMs}ms for incident ${incident.id}`));
            }, timeoutMs);
            if (t.unref) t.unref();
          });

          const investigation = await Promise.race([investigationPromise, timeoutPromise]);

          // Verify lease is still actively held before entering mutation boundary
          if (!leaseActive || leaseError) {
            throw (leaseError || new Error(`Worker lease expired during investigation for incident ${incident.id}`));
          }

          workflowSpan?.setAttribute('aftermath.agent.proposed_decision', investigation.decision);
          workflowSpan?.setAttribute('aftermath.agent.model', investigation.modelUsed);
          workflowSpan?.setAttribute('aftermath.agent.tool_sequence', JSON.stringify(investigation.toolSequence));

          let executionOutcome: Record<string, unknown> = {};

          // Step 2: Route through Deterministic Authorization Gate & Committer
          switch (investigation.decision) {
            case 'PROPOSE_RECOVERY': {
              const outcome = await recoveryService.authorizeAndExecuteRecovery(
                incident.id,
                incident.fencingToken,
                this.workerId,
                investigation,
                {
                  paystackAdapter: effectiveAdapter,
                  executionMode: effectiveExecutionMode,
                }
              );
              executionOutcome = outcome as unknown as Record<string, unknown>;
              break;
            }

            case 'RECONCILE_EXISTING': {
              const outcome = await recoveryService.reconcileExistingEntitlement(
                incident.id,
                incident.fencingToken,
                this.workerId,
                investigation.summary
              );
              executionOutcome = outcome as unknown as Record<string, unknown>;
              break;
            }

            case 'RETRY_LATER': {
              await recoveryService.scheduleIncidentRetry(
                incident.id,
                incident.fencingToken,
                this.workerId,
                investigation.summary
              );
              executionOutcome = { status: 'RETRY_SCHEDULED', reason: investigation.summary };
              break;
            }

            case 'ESCALATE': {
              await recoveryService.escalateIncident(
                incident.id,
                incident.fencingToken,
                this.workerId,
                investigation.summary
              );
              executionOutcome = { status: 'ESCALATED', reason: investigation.summary };
              break;
            }
          }

          // Flush telemetry
          try {
            await flush();
          } catch {
            // Non-blocking flush
          }

          return {
            incidentId: incident.id,
            decision: investigation.decision,
            modelUsed: investigation.modelUsed,
            turnsExecuted: investigation.turnsExecuted,
            toolSequence: investigation.toolSequence,
            outcome: executionOutcome,
          };
        } finally {
          if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
          }
        }
      }
    );
  }

  /**
   * Sweeps unfulfilled paid orders and stale pending orders.
   * Discovers broken operations autonomously without requiring webhooks.
   */
  public async sweepReconciliation(): Promise<{
    unfulfilledOrdersFound: number;
    pendingOrdersSwept: number;
  }> {
    // 1. Sweep paid orders with missing entitlements
    const unfulfilled = await getPaidUnfulfilledOrders(20);
    for (const order of unfulfilled) {
      await createOrGetIncident({
        orderId: order.id,
        paymentReference: order.paymentReference,
        customerId: order.customerId,
        reason: 'PAID_BUT_UNFULFILLED',
        errorDetail: 'Sweeper detected paid order without active entitlement',
      });
    }

    // 2. Sweep pending orders older than 5 minutes
    const stalePending = await getPendingOrdersForReconciliation(5, 20);
    for (const order of stalePending) {
      // Check Paystack verification directly
      const outcome = await (this.paystackAdapter || paystackClient).verifyTransaction(order.paymentReference);
      if (outcome.outcome === 'SUCCESS') {
        // Payment was completed on Paystack! Mark order paid and open incident
        await createOrGetIncident({
          orderId: order.id,
          paymentReference: order.paymentReference,
          customerId: order.customerId,
          reason: 'PAID_BUT_UNFULFILLED',
          errorDetail: 'Sweeper verified successful Paystack payment for pending order',
        });
      }
    }

    return {
      unfulfilledOrdersFound: unfulfilled.length,
      pendingOrdersSwept: stalePending.length,
    };
  }

  /**
   * Executes a single worker polling tick.
   */
  public async tick(): Promise<boolean> {
    if (this.isProcessing) return false;
    this.isProcessing = true;

    try {
      const claimed = await this.claimNextIncident();
      if (claimed) {
        await this.processClaimedIncident(claimed);
        return true;
      }
      return false;
    } catch (err) {
      console.error(`[RecoveryWorker ${this.workerId}] Error in tick:`, err);
      return false;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Starts the continuous background polling loop.
   */
  public async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[RecoveryWorker ${this.workerId}] Started background recovery loop.`);

    let sweepCounter = 0;

    const runLoop = async () => {
      if (!this.isRunning) return;

      try {
        const didProcess = await this.tick();

        // Run reconciliation sweep every ~30 seconds (30 ticks at 1000ms)
        sweepCounter++;
        if (sweepCounter >= 30) {
          sweepCounter = 0;
          await this.sweepReconciliation();
        }

        // If work was found, check immediately for next; otherwise sleep pollIntervalMs
        const nextDelay = didProcess ? 50 : this.pollIntervalMs;
        if (this.isRunning) {
          this.loopTimer = setTimeout(runLoop, nextDelay);
        }
      } catch (err) {
        console.error(`[RecoveryWorker ${this.workerId}] Loop error:`, err);
        if (this.isRunning) {
          this.loopTimer = setTimeout(runLoop, this.pollIntervalMs);
        }
      }
    };

    runLoop();
  }

  /**
   * Stops the background worker cleanly.
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    if (this.loopTimer) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    console.log(`[RecoveryWorker ${this.workerId}] Worker stopped.`);
  }

  public getStatus() {
    return {
      workerId: this.workerId,
      isRunning: this.isRunning,
      isProcessing: this.isProcessing,
    };
  }
}

export const recoveryWorker = new RecoveryWorker();
