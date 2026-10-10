import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/db';
import { customers, orders, entitlements, incidents } from '@/db/schema';
import { paystackClient, generatePaystackReference } from '@/lib/paystack';
import { RecoveryWorker } from '@/worker/recovery-worker';
import { createOrGetIncident } from '@/services/incident';
import { recoveryService } from '@/services/recovery';
import { investigateIncident } from '@/agent/investigator';
import { eq } from 'drizzle-orm';

describe('Phase 2 Acceptance Scenario D: Duplicate Events & Concurrent Worker Fencing Protection', () => {
  let customerId: string;
  let customerEmail: string;
  let orderId: string;
  let reference: string;
  let worker1: RecoveryWorker;
  let worker2: RecoveryWorker;

  beforeEach(async () => {
    customerEmail = `scenario-d-${Date.now()}@example.com`;
    customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = generatePaystackReference();
    worker1 = new RecoveryWorker({ workerId: `worker_1_${Date.now()}` });
    worker2 = new RecoveryWorker({ workerId: `worker_2_${Date.now()}` });

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Scenario D User',
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

  it('Part 1: duplicate incident creation calls are idempotent and return the exact same incident row', async () => {
    const res1 = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
      errorDetail: 'First delivery attempt',
    });

    const res2 = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
      errorDetail: 'Duplicate delivery attempt',
    });

    expect(res1.isNew).toBe(true);
    expect(res2.isNew).toBe(false);
    expect(res1.incident.id).toBe(res2.incident.id);

    const allIncidents = await db.select().from(incidents).where(eq(incidents.orderId, orderId));
    expect(allIncidents.length).toBe(1);
  });

  it('Part 2: fencing tokens block stale worker from mutating state after lease reclamation', async () => {
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

    // 1. Worker 1 claims incident (fencingToken = 1)
    const claimedByWorker1 = await worker1.claimNextIncident(incident.id);
    expect(claimedByWorker1).not.toBeNull();
    expect(claimedByWorker1?.id).toBe(incident.id);
    expect(claimedByWorker1?.fencingToken).toBe(1);
    expect(claimedByWorker1?.leaseOwner).toBe(worker1.workerId);

    const mockTransport = async (turn: number) => {
      if (turn === 1) {
        return {
          functionCalls: [
            { name: 'inspect_order', args: { orderId } },
            { name: 'verify_paystack_transaction', args: { paymentReference: reference } },
          ],
        };
      }
      if (turn === 2) {
        return {
          functionCalls: [
            {
              name: 'submit_investigation_decision',
              args: {
                decision: 'PROPOSE_RECOVERY',
                summary: 'Verified Paystack payment matches trusted order',
              },
            },
          ],
        };
      }
      return {};
    };

    // Worker 1 runs investigation, assembling evidence
    const investigation1 = await investigateIncident(
      claimedByWorker1!.id,
      claimedByWorker1!.orderId,
      claimedByWorker1!.paymentReference,
      { mockTransport }
    );

    // 2. Simulate Worker 1 stalling or experiencing network pause.
    // Expire Worker 1's lease artificially in the database
    await db
      .update(incidents)
      .set({
        leaseExpiresAt: new Date(Date.now() - 5000), // Expired 5 seconds ago
      })
      .where(eq(incidents.id, incident.id));

    // 3. Worker 2 detects expired lease and reclaims incident
    const claimedByWorker2 = await worker2.claimNextIncident(incident.id);
    expect(claimedByWorker2).not.toBeNull();
    expect(claimedByWorker2?.id).toBe(incident.id);
    expect(claimedByWorker2?.fencingToken).toBe(2); // Incremented!
    expect(claimedByWorker2?.leaseOwner).toBe(worker2.workerId);

    // 4. Stale Worker 1 wakes up and attempts to commit recovery with stale fencingToken = 1
    await expect(
      recoveryService.authorizeAndExecuteRecovery(
        claimedByWorker1!.id,
        claimedByWorker1!.fencingToken, // Stale token = 1
        worker1.workerId, // Preempted owner
        investigation1
      )
    ).rejects.toThrow(/Worker lease invalid or preempted/);

    // 5. Worker 2 proceeds with valid fencingToken = 2 and successfully commits
    const investigation2 = await investigateIncident(
      claimedByWorker2!.id,
      claimedByWorker2!.orderId,
      claimedByWorker2!.paymentReference,
      { mockTransport }
    );

    const outcome2 = await recoveryService.authorizeAndExecuteRecovery(
      claimedByWorker2!.id,
      claimedByWorker2!.fencingToken, // Valid token = 2
      worker2.workerId,
      investigation2
    );

    expect(outcome2.success).toBe(true);
    expect(outcome2.decision).toBe('RESOLVED');

    // Verify incident is resolved with fencing token 2
    const [finalIncident] = await db.select().from(incidents).where(eq(incidents.id, incident.id));
    expect(finalIncident.status).toBe('RESOLVED');
    expect(finalIncident.fencingToken).toBe(2);

    // Exactly one entitlement created in relational engine
    const allEntitlements = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, orderId));
    expect(allEntitlements.length).toBe(1);
  });
});
