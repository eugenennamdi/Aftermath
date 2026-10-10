import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/db';
import { customers, orders, entitlements, incidents, auditLogs } from '@/db/schema';
import { paystackClient, generatePaystackReference } from '@/lib/paystack';
import { RecoveryWorker } from '@/worker/recovery-worker';
import { createOrGetIncident } from '@/services/incident';
import { entitlementService } from '@/services/entitlement';
import { eq } from 'drizzle-orm';

describe('Phase 2 Acceptance Scenario C: Deterministic Security Gate Rejection & Escalation', () => {
  let customerId: string;
  let customerEmail: string;
  let orderId: string;
  let reference: string;
  let worker: RecoveryWorker;

  beforeEach(async () => {
    customerEmail = `scenario-c-${Date.now()}@example.com`;
    customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = generatePaystackReference();
    worker = new RecoveryWorker({ workerId: `test_worker_c_${Date.now()}` });

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Scenario C User',
    });

    await db.insert(orders).values({
      id: orderId,
      customerId,
      planId: 'plan_starter_monthly',
      paymentReference: reference,
      expectedAmount: 500000, // 5,000 NGN
      currency: 'NGN',
      status: 'PAID',
      paidAt: new Date(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Rejection 1: rejects and escalates on Underpaid Amount mismatch (e.g. 250,000 kobo vs 500,000 kobo)', async () => {
    vi.spyOn(paystackClient, 'hasSecretKey').mockReturnValue(true);
    vi.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
      outcome: 'SUCCESS',
      reference,
      amount: 250000, // Underpaid!
      currency: 'NGN',
      customerEmail,
      paidAt: new Date(),
      rawData: {},
    });

    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'VERIFICATION_MISMATCH',
      errorDetail: 'Gateway reported different amount',
    });

    const claimed = await worker.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    const mockTransport1 = async (turn: number) => {
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
                decision: 'ESCALATE',
                summary: 'Amount mismatch: expected 500000 kobo, received 250000 kobo',
              },
            },
          ],
        };
      }
      return {};
    };

    const result = await worker.processClaimedIncident(claimed!, { mockTransport: mockTransport1 });
    expect(result.decision).toBe('ESCALATE');

    // Incident escalated in DB
    const [escalatedIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id));

    expect(escalatedIncident.status).toBe('ESCALATED');
    expect(escalatedIncident.lastDecision).toBe('ESCALATE');
    expect(escalatedIncident.decisionSummary).toContain('Amount mismatch');

    // Zero entitlements created
    const entitlement = await entitlementService.getAuthoritativeEntitlement(orderId);
    expect(entitlement).toBeNull();
  });

  it('Rejection 2: rejects and escalates on Currency mismatch (e.g. USD vs NGN)', async () => {
    vi.spyOn(paystackClient, 'hasSecretKey').mockReturnValue(true);
    vi.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
      outcome: 'SUCCESS',
      reference,
      amount: 500000,
      currency: 'USD', // Wrong currency!
      customerEmail,
      paidAt: new Date(),
      rawData: {},
    });

    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'VERIFICATION_MISMATCH',
      errorDetail: 'Gateway reported different currency',
    });

    const claimed = await worker.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    const mockTransport2 = async (turn: number) => {
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
                decision: 'ESCALATE',
                summary: 'Currency mismatch: expected NGN, received USD',
              },
            },
          ],
        };
      }
      return {};
    };

    const result = await worker.processClaimedIncident(claimed!, { mockTransport: mockTransport2 });
    expect(result.decision).toBe('ESCALATE');

    const [escalatedIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id));

    expect(escalatedIncident.status).toBe('ESCALATED');
    expect(escalatedIncident.decisionSummary).toContain('Currency mismatch');

    const entitlement = await entitlementService.getAuthoritativeEntitlement(orderId);
    expect(entitlement).toBeNull();
  });

  it('Rejection 3: rejects and escalates on Customer Identity spoofing (attacker email paid for order)', async () => {
    vi.spyOn(paystackClient, 'hasSecretKey').mockReturnValue(true);
    vi.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
      outcome: 'SUCCESS',
      reference,
      amount: 500000,
      currency: 'NGN',
      customerEmail: 'attacker@evil.com', // Spoofed payer!
      paidAt: new Date(),
      rawData: {},
    });

    const { incident } = await createOrGetIncident({
      orderId,
      paymentReference: reference,
      customerId,
      reason: 'VERIFICATION_MISMATCH',
      errorDetail: 'Payer email mismatch detected',
    });

    const claimed = await worker.claimNextIncident(incident.id);
    expect(claimed).not.toBeNull();

    const mockTransport3 = async (turn: number) => {
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
                decision: 'ESCALATE',
                summary: 'Email mismatch: expected customer email, received attacker@evil.com',
              },
            },
          ],
        };
      }
      return {};
    };

    const result = await worker.processClaimedIncident(claimed!, { mockTransport: mockTransport3 });
    expect(result.decision).toBe('ESCALATE');

    const [escalatedIncident] = await db
      .select()
      .from(incidents)
      .where(eq(incidents.id, incident.id));

    expect(escalatedIncident.status).toBe('ESCALATED');
    expect(escalatedIncident.decisionSummary).toContain('Email mismatch');

    const entitlement = await entitlementService.getAuthoritativeEntitlement(orderId);
    expect(entitlement).toBeNull();
  });
});
