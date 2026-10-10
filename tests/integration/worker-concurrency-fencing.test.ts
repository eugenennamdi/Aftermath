import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { db, queryClient } from '@/db';
import { customers, orders, entitlements, incidents, auditLogs } from '@/db/schema';
import { paystackClient, generatePaystackReference } from '@/lib/paystack';
import { RecoveryWorker } from '@/worker/recovery-worker';
import { createOrGetIncident } from '@/services/incident';
import { recoveryService } from '@/services/recovery';
import { type InvestigationResult } from '@/agent/investigator';
import { eq } from 'drizzle-orm';

describe('Hardened Recovery Mutation Boundary & Concurrency Fencing (CTO Requirement 3 & 4)', () => {
  let customerId: string;
  let customerEmail: string;
  let orderId: string;
  let reference: string;
  let workerA: RecoveryWorker;
  let workerB: RecoveryWorker;

  beforeEach(async () => {
    customerEmail = `fencing-${Date.now()}@example.com`;
    customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = generatePaystackReference();
    workerA = new RecoveryWorker({ workerId: `worker_A_${Date.now()}` });
    workerB = new RecoveryWorker({ workerId: `worker_B_${Date.now()}` });

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Fencing Test User',
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

  it('blocks Worker A at the exact mutation boundary if it stalls, loses its lease, and Worker B claims the incident', async () => {
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

    // 1. Worker A claims incident (fencingToken = 1, leaseOwner = workerA)
    const claimedA = await workerA.claimNextIncident(incident.id);
    expect(claimedA).not.toBeNull();
    expect(claimedA?.fencingToken).toBe(1);
    expect(claimedA?.leaseOwner).toBe(workerA.workerId);

    // Build valid investigation evidence dossier for Worker A
    const investigationA: InvestigationResult = {
      decision: 'PROPOSE_RECOVERY',
      summary: 'Payment verified matching order',
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

    // 2. Simulate Worker A stalling (e.g. GC pause, slow network call).
    // In the meantime, Worker A's lease expires in the database:
    await db
      .update(incidents)
      .set({
        leaseExpiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
      })
      .where(eq(incidents.id, incident.id));

    // 3. Worker B notices expired lease and reclaims the incident (fencingToken increments to 2, leaseOwner = workerB)
    const claimedB = await workerB.claimNextIncident(incident.id);
    expect(claimedB).not.toBeNull();
    expect(claimedB?.fencingToken).toBe(2);
    expect(claimedB?.leaseOwner).toBe(workerB.workerId);

    // 4. Stalled Worker A wakes up and attempts to commit recovery mutation using its stale token (1)
    // CRITICAL: Must be rejected at the atomic mutation boundary!
    await expect(
      recoveryService.authorizeAndExecuteRecovery(
        incident.id,
        claimedA!.fencingToken, // Stale token = 1
        workerA.workerId, // Preempted owner
        investigationA
      )
    ).rejects.toThrow(/Worker lease invalid or preempted/);

    // 5. Worker B proceeds with its valid lease and successfully commits
    const outcomeB = await recoveryService.authorizeAndExecuteRecovery(
      incident.id,
      claimedB!.fencingToken, // Valid token = 2
      workerB.workerId,
      investigationA
    );

    expect(outcomeB.success).toBe(true);
    expect(outcomeB.decision).toBe('RESOLVED');

    // Exactly 1 entitlement row created in PostgreSQL
    const allEntitlements = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, orderId));

    expect(allEntitlements.length).toBe(1);

    // Incident is resolved under fencing token 2
    const [finalIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id));

    expect(finalIncident.status).toBe('RESOLVED');
    expect(finalIncident.fencingToken).toBe(2);
  });

  it('blocks mutation when lease expires even if fencing token has not yet been incremented by another worker', async () => {
    vi.spyOn(paystackClient, 'hasSecretKey').mockReturnValue(true);

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
      .set({
        leaseExpiresAt: new Date(Date.now() - 1000),
      })
      .where(eq(incidents.id, incident.id));

    const investigation: InvestigationResult = {
      decision: 'PROPOSE_RECOVERY',
      summary: 'Verified payment',
      modelUsed: 'gemini-3.8-flash',
      provider: 'google_gemini',
      turnsExecuted: 1,
      toolSequence: ['submit_investigation_decision'],
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

    // Fails because lease has expired
    await expect(
      recoveryService.authorizeAndExecuteRecovery(
        incident.id,
        claimed!.fencingToken,
        workerA.workerId,
        investigation
      )
    ).rejects.toThrow(/Worker lease expired/);
  });

  it('demonstrates safe lease renewal via extendLease during long processing', async () => {
    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
    });

    const claimed = await workerA.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    // Worker extends its lease by 45 seconds
    const extended = await workerA.extendLease(incident.id, claimed!.fencingToken, 45);
    expect(extended).toBe(true);

    const [updated] = await db.select().from(incidents).where(eq(incidents.id, incident.id));
    const remainingSeconds = (new Date(updated.leaseExpiresAt!).getTime() - Date.now()) / 1000;
    expect(remainingSeconds).toBeGreaterThan(40);
  });
});
