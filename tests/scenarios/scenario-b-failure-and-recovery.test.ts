import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/db';
import { customers, orders, entitlements, incidents, auditLogs } from '@/db/schema';
import { paystackClient, generatePaystackReference } from '@/lib/paystack';
import { RecoveryWorker } from '@/worker/recovery-worker';
import { createOrGetIncident } from '@/services/incident';
import { entitlementService } from '@/services/entitlement';
import { eq } from 'drizzle-orm';

describe('Phase 2 Acceptance Scenario B: Transient Failure Backoff & Ambiguous Post-Commit Reconciliation', () => {
  let customerId: string;
  let customerEmail: string;
  let orderId: string;
  let reference: string;
  let worker: RecoveryWorker;

  beforeEach(async () => {
    customerEmail = `scenario-b-${Date.now()}@example.com`;
    customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = generatePaystackReference();
    worker = new RecoveryWorker({ workerId: `test_worker_b_${Date.now()}` });

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Scenario B User',
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

  it('Part 1: handles transient Paystack 503 error with bounded retry and exponential backoff', async () => {
    // Mock Paystack returning transient 503 error
    vi.spyOn(paystackClient, 'hasSecretKey').mockReturnValue(true);
    vi.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
      outcome: 'API_ERROR',
      reference,
      error: 'HTTP 503: Service Unavailable',
      statusCode: 503,
      retryable: true,
    });

    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'FULFILLMENT_FAILED',
      errorDetail: 'Initial fulfillment timed out',
    });

    const claimed = await worker.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    const mockTransport1 = async (turn: number) => {
      if (turn === 1) {
        return {
          functionCalls: [
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
                decision: 'RETRY_LATER',
                summary: 'Paystack returned transient 503 error; backoff scheduled',
              },
            },
          ],
        };
      }
      return {};
    };

    const result = await worker.processClaimedIncident(claimed!, { mockTransport: mockTransport1 });
    expect(result.decision).toBe('RETRY_LATER');

    // Verify Incident State after retry scheduled:
    const [retryingIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id));

    expect(retryingIncident.status).toBe('OPEN');
    expect(retryingIncident.retryCount).toBe(1);
    expect(retryingIncident.nextRetryAt).not.toBeNull();
    expect(retryingIncident.lastDecision).toBe('RETRY_LATER');
    expect(retryingIncident.leaseOwner).toBeNull(); // Lease released for next attempt

    // Entitlement must NOT be created on transient failure
    const entitlement = await entitlementService.getAuthoritativeEntitlement(orderId);
    expect(entitlement).toBeNull();
  });

  it('Part 2: handles ambiguous post-commit drop via RECONCILE_EXISTING without duplicate provisioning', async () => {
    // Pre-condition: Entitlement was committed, but network dropped before incident was resolved
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const existingEntId = `ent-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await db.insert(entitlements).values({
      id: existingEntId,
      orderId,
      customerId,
      planId: 'plan_starter_monthly',
      sourceReference: reference,
      status: 'ACTIVE',
      startedAt,
      expiresAt,
    });

    // Paystack verification returns success
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
      errorDetail: 'Ambiguous crash before resolution commit',
    });

    const claimed = await worker.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    const mockTransport2 = async (turn: number) => {
      if (turn === 1) {
        return {
          functionCalls: [{ name: 'inspect_entitlement', args: { orderId } }],
        };
      }
      if (turn === 2) {
        return {
          functionCalls: [
            {
              name: 'submit_investigation_decision',
              args: {
                decision: 'RECONCILE_EXISTING',
                summary: 'Active entitlement already found in database; reconcile incident without duplicate grant',
              },
            },
          ],
        };
      }
      return {};
    };

    // Agent should inspect existing entitlement and propose RECONCILE_EXISTING
    const result = await worker.processClaimedIncident(claimed!, { mockTransport: mockTransport2 });
    expect(result.decision).toBe('RECONCILE_EXISTING');
    expect(result.outcome.decision).toBe('RESOLVED');

    // Incident resolved cleanly
    const [resolvedIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id));

    expect(resolvedIncident.status).toBe('RESOLVED');
    expect(resolvedIncident.lastDecision).toBe('RECONCILE_EXISTING');
    expect(resolvedIncident.resolvedAt).not.toBeNull();

    // Exactly 1 entitlement row exists (no duplicate created)
    const allEntitlements = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, orderId));

    expect(allEntitlements.length).toBe(1);
    expect(allEntitlements[0].id).toBe(existingEntId);
  });
});
