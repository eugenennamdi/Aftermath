import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/db';
import { customers, orders, entitlements, incidents } from '@/db/schema';
import { paystackClient, generatePaystackReference } from '@/lib/paystack';
import {
  investigateIncident,
  validateToolScoping,
  type LLMMockTransport,
} from '@/agent/investigator';

describe('Autonomous AI Agent Model Decisions & Tool Calling (CTO Requirement 1 & 2)', () => {
  let customerId: string;
  let customerEmail: string;
  let orderId: string;
  let reference: string;
  let incidentId: string;

  beforeEach(async () => {
    customerEmail = `agent-autonomy-${Date.now()}@example.com`;
    customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = generatePaystackReference();
    incidentId = `inc-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Agent Autonomy User',
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

  it('Flow A: verified payment with missing entitlement -> dynamically inspects order, payment, and entitlement, then proposes recovery', async () => {
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

    const toolCallsDispatched: string[] = [];

    // Mock LLM transport simulating genuine Gemini function calling across 2 turns:
    // Turn 1: Model chooses to inspect order and verify paystack
    // Turn 2: Model chooses to inspect entitlement and submit PROPOSE_RECOVERY
    const mockTransport: LLMMockTransport = async (turn, contents) => {
      if (turn === 1) {
        toolCallsDispatched.push('inspect_order', 'verify_paystack_transaction');
        return {
          functionCalls: [
            { name: 'inspect_order', args: { orderId } },
            { name: 'verify_paystack_transaction', args: { paymentReference: reference } },
          ],
        };
      }
      if (turn === 2) {
        toolCallsDispatched.push('inspect_entitlement', 'submit_investigation_decision');
        return {
          functionCalls: [
            { name: 'inspect_entitlement', args: { orderId } },
            {
              name: 'submit_investigation_decision',
              args: {
                decision: 'PROPOSE_RECOVERY',
                summary: 'Paystack verified 500,000 NGN matches order, no entitlement found. Propose recovery.',
              },
            },
          ],
        };
      }
      return {};
    };

    const result = await investigateIncident(incidentId, orderId, reference, { mockTransport });

    expect(result.decision).toBe('PROPOSE_RECOVERY');
    expect(result.turnsExecuted).toBe(2);
    expect(result.toolSequence).toEqual([
      'inspect_order',
      'verify_paystack_transaction',
      'inspect_entitlement',
      'submit_investigation_decision',
    ]);
    expect(result.evidence.order).toBeDefined();
    expect(result.evidence.paystack).toBeDefined();
    expect(result.evidence.entitlement).toBeDefined();
  });

  it('Flow B: existing active entitlement -> model discovers entitlement and chooses reconciliation over duplicate grant', async () => {
    // Pre-insert active entitlement
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    await db.insert(entitlements).values({
      id: `ent-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
      orderId,
      customerId,
      planId: 'plan_starter_monthly',
      sourceReference: reference,
      status: 'ACTIVE',
      startedAt,
      expiresAt,
    });

    const mockTransport: LLMMockTransport = async (turn) => {
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
                summary: 'Active entitlement already found in database. Reconcile without granting duplicate access.',
              },
            },
          ],
        };
      }
      return {};
    };

    const result = await investigateIncident(incidentId, orderId, reference, { mockTransport });

    expect(result.decision).toBe('RECONCILE_EXISTING');
    expect(result.toolSequence).toEqual(['inspect_entitlement', 'submit_investigation_decision']);
  });

  it('Flow C: provider temporarily unavailable (503) -> model observes transient error and chooses retry/defer', async () => {
    vi.spyOn(paystackClient, 'hasSecretKey').mockReturnValue(true);
    vi.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
      outcome: 'API_ERROR',
      reference,
      error: 'HTTP 503: Service Unavailable',
      statusCode: 503,
      retryable: true,
    });

    const mockTransport: LLMMockTransport = async (turn) => {
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
                summary: 'Paystack returned transient 503 error. Deferring with exponential backoff.',
              },
            },
          ],
        };
      }
      return {};
    };

    const result = await investigateIncident(incidentId, orderId, reference, { mockTransport });

    expect(result.decision).toBe('RETRY_LATER');
    expect(result.summary).toContain('503');
  });

  it('Flow D: payment identity mismatch (spoofed payer email) -> model detects fraud and escalates', async () => {
    vi.spyOn(paystackClient, 'hasSecretKey').mockReturnValue(true);
    vi.spyOn(paystackClient, 'verifyTransaction').mockResolvedValue({
      outcome: 'SUCCESS',
      reference,
      amount: 500000,
      currency: 'NGN',
      customerEmail: 'attacker@fraud.io', // Mismatch!
      paidAt: new Date(),
      rawData: {},
    });

    const mockTransport: LLMMockTransport = async (turn) => {
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
                summary: 'Security violation: Payer email attacker@fraud.io does not match customer.',
              },
            },
          ],
        };
      }
      return {};
    };

    const result = await investigateIncident(incidentId, orderId, reference, { mockTransport });

    expect(result.decision).toBe('ESCALATE');
    expect(result.summary).toContain('Security violation');
  });

  it('Flow E: server-side scoping rejects unauthorized tool arguments outside claimed incident scope', async () => {
    const scopingCheck = validateToolScoping(
      'inspect_order',
      { orderId: 'foreign_unauthorized_order_999' },
      { incidentId, orderId, paymentReference: reference }
    );

    expect(scopingCheck.valid).toBe(false);
    expect(scopingCheck.reason).toContain('foreign_unauthorized_order_999');
  });

  it('Flow F: unavailable model API key safely defers without unauthorized mutation', async () => {
    const prevKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const result = await investigateIncident(incidentId, orderId, reference);
      expect(result.decision).toBe('RETRY_LATER');
      expect(result.summary).toContain('GEMINI_API_KEY is not configured');
      expect(result.turnsExecuted).toBe(0);
    } finally {
      if (prevKey) process.env.GEMINI_API_KEY = prevKey;
    }
  });
});
