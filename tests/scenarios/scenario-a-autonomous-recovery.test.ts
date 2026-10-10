import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/db';
import { customers, orders, entitlements, incidents, auditLogs } from '@/db/schema';
import { paystackClient, generatePaystackReference } from '@/lib/paystack';
import { RecoveryWorker } from '@/worker/recovery-worker';
import { createOrGetIncident } from '@/services/incident';
import { entitlementService } from '@/services/entitlement';
import { eq } from 'drizzle-orm';

describe('Phase 2 Acceptance Scenario A: Autonomous Discovery, Investigation, Gate Authorization & Verified Resolution', () => {
  let customerId: string;
  let customerEmail: string;
  let orderId: string;
  let reference: string;
  let worker: RecoveryWorker;

  beforeEach(async () => {
    customerEmail = `scenario-a-${Date.now()}@example.com`;
    customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = generatePaystackReference();
    worker = new RecoveryWorker({ workerId: `test_worker_a_${Date.now()}` });

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Scenario A User',
    });

    await db.insert(orders).values({
      id: orderId,
      customerId,
      planId: 'plan_starter_monthly',
      paymentReference: reference,
      expectedAmount: 500000, // 5,000 NGN
      currency: 'NGN',
      status: 'PAID', // Customer paid, but normal fulfillment crashed/dropped
      paidAt: new Date(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('autonomously investigates discrepancy, authorizes recovery via deterministic gate, and independently verifies active entitlement', async () => {
    // Mock Paystack returning verified success matching the trusted order
    vi.spyOn(paystackClient, 'hasSecretKey').mockReturnValue(true);
    vi.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
      outcome: 'SUCCESS',
      reference,
      amount: 500000,
      currency: 'NGN',
      customerEmail,
      paidAt: new Date(),
      gatewayResponse: 'Successful',
      rawData: { status: 'success' },
    });

    // 1. Autonomous Discovery: sweeper or incident creation discovers unfulfilled paid order
    const { incident, isNew } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'PAID_BUT_UNFULFILLED',
      errorDetail: 'Order marked paid but active entitlement missing from relational engine',
    });

    expect(isNew).toBe(true);
    expect(incident.status).toBe('OPEN');

    // 2. Worker claims incident atomically via FOR UPDATE SKIP LOCKED
    const claimed = await worker.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(incident.id);
    expect(claimed?.fencingToken).toBe(1);
    expect(claimed?.leaseOwner).toBe(worker.workerId);

    // 3. Process claimed incident: Agent investigates -> Gate authorizes -> Entitlement provisioned -> Fresh read verifies
    const result = await worker.processClaimedIncident(claimed!);
    expect(result.decision).toBe('PROPOSE_RECOVERY');
    expect(result.outcome.decision).toBe('RESOLVED');

    // 4. Verify Database State Invariants:
    // a) Incident is marked RESOLVED with resolvedAt timestamp
    const [resolvedIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id));

    expect(resolvedIncident.status).toBe('RESOLVED');
    expect(resolvedIncident.lastDecision).toBe('PROPOSE_RECOVERY');
    expect(resolvedIncident.resolvedAt).not.toBeNull();
    expect(resolvedIncident.leaseOwner).toBeNull(); // Lease cleanly released

    // b) Entitlement is actively provisioned in authoritative table
    const authoritative = await entitlementService.getAuthoritativeEntitlement(orderId);
    expect(authoritative).not.toBeNull();
    expect(authoritative?.entitlement.status).toBe('ACTIVE');
    expect(authoritative?.entitlement.sourceReference).toBe(reference);
    expect(authoritative?.entitlement.customerId).toBe(customerId);
    expect(entitlementService.isEntitlementActive(authoritative!.entitlement)).toBe(true);

    // c) Order status transitioned to FULFILLED
    const [updatedOrder] = await db.select().from(orders).where(eq(orders.id, orderId));
    expect(updatedOrder.status).toBe('FULFILLED');

    // d) Audit log records resolution event
    const [auditLog] = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.incidentId, incident.id))
      .orderBy(eq(auditLogs.action, 'INCIDENT_RESOLVED'));

    expect(auditLog).toBeDefined();
  });
});
