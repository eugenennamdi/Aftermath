import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { db, queryClient } from '@/db';
import { customers, orders, entitlements, incidents, auditLogs } from '@/db/schema';
import { paystackClient, generatePaystackReference } from '@/lib/paystack';
import { RecoveryWorker } from '@/worker/recovery-worker';
import { createOrGetIncident } from '@/services/incident';
import { recoveryService, RecoveryService } from '@/services/recovery';
import { entitlementService } from '@/services/entitlement';
import { type InvestigationResult } from '@/agent/investigator';
import { eq } from 'drizzle-orm';

describe('Phase 2 Safety Closeout: Verified Resolution, Lease Lifecycle & Bounded Retries', () => {
  let customerId: string;
  let customerEmail: string;
  let orderId: string;
  let reference: string;
  let workerA: RecoveryWorker;
  let workerB: RecoveryWorker;

  beforeEach(async () => {
    customerEmail = `safety-${Date.now()}@example.com`;
    customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = generatePaystackReference();
    workerA = new RecoveryWorker({ workerId: `safety_worker_a_${Date.now()}` });
    workerB = new RecoveryWorker({ workerId: `safety_worker_b_${Date.now()}` });

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Safety Lifecycle User',
    });

    await db.insert(orders).values({
      id: orderId,
      customerId,
      planId: 'plan_starter_monthly',
      paymentReference: reference,
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'PAID',
      paidAt: new Date(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prevents premature RESOLVED state if independent verification fails, preserving recoverable retry state', async () => {
    vi.spyOn(paystackClient, 'hasSecretKey').mockReturnValue(true);
    vi.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
      outcome: 'SUCCESS',
      reference,
      amount: 500000,
      currency: 'NGN',
      customerEmail,
      paidAt: new Date(),
      rawData: {},
    });

    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
    });

    const claimed = await workerA.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    const validInvestigation: InvestigationResult = {
      decision: 'PROPOSE_RECOVERY',
      summary: 'Verified matching payment',
      modelUsed: 'gemini-3.8-flash',
      provider: 'google_gemini',
      turnsExecuted: 2,
      toolSequence: ['inspect_order', 'verify_paystack_transaction', 'submit_investigation_decision'],
      evidence: {
        paystack: {
          outcome: 'SUCCESS',
          verified: true,
          reference,
          amount: 500000,
          currency: 'NGN',
          customerEmail,
        },
      },
    };

    // Simulate independent read failure (e.g. read replica lag or temporary network failure)
    vi.spyOn(entitlementService, 'getAuthoritativeEntitlement').mockResolvedValue(null as any);

    // authorizeAndExecuteRecovery MUST throw and NOT mark incident as RESOLVED
    await expect(
      recoveryService.authorizeAndExecuteRecovery(
        incident.id,
        claimed!.fencingToken,
        workerA.workerId,
        validInvestigation
      )
    ).rejects.toThrow(/verification failed/i);

    // Verify database state: Incident is NOT RESOLVED!
    const [persistedIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id));

    expect(persistedIncident.status).not.toBe('RESOLVED');
    expect(persistedIncident.status).toBe('OPEN'); // scheduleIncidentRetry reset it to OPEN for retry
    expect(persistedIncident.retryCount).toBe(1);
    expect(persistedIncident.leaseOwner).toBeNull();
  });

  it('safely reconciles existing entitlement when a worker previously crashed in PROVISIONED state', async () => {
    // 1. Manually simulate crash state: Entitlement was created, but incident left in PROVISIONED with expired lease
    const entId = `ent_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.insert(entitlements).values({
      id: entId,
      orderId,
      customerId,
      planId: 'plan_starter_monthly',
      sourceReference: reference,
      status: 'ACTIVE',
      startedAt: now,
      expiresAt,
    });

    const [crashedIncident] = await db
      .insert(incidents)
      .values({
        id: `inc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        orderId,
        paymentReference: reference,
        customerId,
        status: 'PROVISIONED',
        fencingToken: 1,
        leaseOwner: 'crashed_worker_dead',
        leaseExpiresAt: new Date(Date.now() - 10000), // Expired 10s ago
        reason: 'PAID_BUT_UNFULFILLED',
      })
      .returning();

    // 2. Worker B claims the abandoned incident
    const claimedB = await workerB.claimNextIncident(crashedIncident.id);
    expect(claimedB).not.toBeNull();
    expect(claimedB?.fencingToken).toBe(2); // Incremented fencing token
    expect(claimedB?.leaseOwner).toBe(workerB.workerId);

    // 3. Worker B reconciles existing entitlement
    const outcome = await recoveryService.reconcileExistingEntitlement(
      crashedIncident.id,
      claimedB!.fencingToken,
      workerB.workerId,
      'Active entitlement detected from previous provision run'
    );

    expect(outcome.success).toBe(true);
    expect(outcome.decision).toBe('RESOLVED');
    expect(outcome.entitlementId).toBe(entId);

    // 4. Verify incident is RESOLVED and only ONE entitlement exists (idempotency preserved)
    const [finalIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, crashedIncident.id));

    expect(finalIncident.status).toBe('RESOLVED');
    expect(finalIncident.resolvedAt).not.toBeNull();

    const orderEntitlements = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, orderId));

    expect(orderEntitlements).toHaveLength(1);
    expect(orderEntitlements[0].id).toBe(entId);
  });

  it('renews worker lease via extendLease and rejects renewal when fencing token or owner mismatches', async () => {
    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
    });

    const claimed = await workerA.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    // Valid lease renewal succeeds
    const renewed = await workerA.extendLease(incident.id, claimed!.fencingToken, 45);
    expect(renewed).toBe(true);

    // Stale fencing token renewal fails
    const staleRenew = await workerA.extendLease(incident.id, claimed!.fencingToken + 99, 45);
    expect(staleRenew).toBe(false);

    // Impostor worker renewal fails
    const impostorRenew = await workerB.extendLease(incident.id, claimed!.fencingToken, 45);
    expect(impostorRenew).toBe(false);
  });

  it('rejects stale worker at retry and escalation boundaries when lease is expired or lost', async () => {
    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
    });

    const claimed = await workerA.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    // Expire the lease explicitly
    await db
      .update(incidents)
      .set({ leaseExpiresAt: new Date(Date.now() - 5000) })
      .where(eq(incidents.id, incident.id));

    // scheduleIncidentRetry must reject with lease expired/preempted
    await expect(
      recoveryService.scheduleIncidentRetry(
        incident.id,
        claimed!.fencingToken,
        workerA.workerId,
        'Transient error retry attempt'
      )
    ).rejects.toThrow(/Worker lease (expired|invalid|preempted)/);

    // escalateIncident must reject with lease expired/preempted
    await expect(
      recoveryService.escalateIncident(
        incident.id,
        claimed!.fencingToken,
        workerA.workerId,
        'Critical error escalation attempt'
      )
    ).rejects.toThrow(/Worker lease (expired|invalid|preempted)/);
  });

  it('enforces finite retry limit (MAX_INCIDENT_RETRIES = 5) and escalates to terminal ESCALATED on exhaustion', async () => {
    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
    });

    // Fast-forward retry count to maximum limit (5)
    await db
      .update(incidents)
      .set({ retryCount: RecoveryService.MAX_INCIDENT_RETRIES })
      .where(eq(incidents.id, incident.id));

    const claimed = await workerA.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    // Scheduling another retry should trigger terminal escalation
    await recoveryService.scheduleIncidentRetry(
      incident.id,
      claimed!.fencingToken,
      workerA.workerId,
      'Transient network glitch after 5 retries'
    );

    const [updatedIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id));

    expect(updatedIncident.status).toBe('ESCALATED');
    expect(updatedIncident.decisionSummary).toContain('RETRY_EXHAUSTED');
    expect(updatedIncident.leaseOwner).toBeNull();
  });

  it('strictly rejects reconciliation when entitlement identity mismatches trusted order', async () => {
    // Insert conflicting entitlement belonging to a different customer and plan
    const conflictEntId = `ent_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const impostorCustomerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.insert(customers).values({
      id: impostorCustomerId,
      email: `impostor-${Date.now()}-${crypto.randomUUID().slice(0, 8)}@attacker.com`,
      name: 'Impostor User',
    });

    await db.insert(entitlements).values({
      id: conflictEntId,
      orderId,
      customerId: impostorCustomerId, // Mismatched customer!
      planId: 'plan_starter_monthly',
      sourceReference: reference,
      status: 'ACTIVE',
      startedAt: now,
      expiresAt,
    });

    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
    });

    const claimed = await workerA.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    // Reconcile must fail due to customer identity mismatch
    await expect(
      recoveryService.reconcileExistingEntitlement(
        incident.id,
        claimed!.fencingToken,
        workerA.workerId,
        'Attempt to reconcile tampered entitlement'
      )
    ).rejects.toThrow(/Cannot reconcile: active entitlement not confirmed or identity mismatch/);

    // Verify incident was NOT resolved
    const [finalIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id));

    expect(finalIncident.status).not.toBe('RESOLVED');
  });
});
