import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import crypto from 'node:crypto';
import { db } from '@/db';
import { customers, orders, incidents, entitlements, auditLogs } from '@/db/schema';
import { queryService, redactEmail } from '@/services/query';
import { scenarioRunnerService } from '@/services/scenario-runner';
import {
  verifyOperatorPassword,
  createOperatorSessionToken,
  verifyOperatorSessionToken,
} from '@/lib/auth';
import { generatePaystackReference } from '@/lib/paystack';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { GET as getIncidentRoute } from '@/app/api/incidents/[id]/route';

describe('Phase 3 Operator Console: Authoritative Query Layer, Security & Scenario Execution', () => {
  let customerId: string;
  let customerEmail: string;
  let orderId: string;
  let reference: string;
  const originalSecret = process.env.OPERATOR_SECRET;

  beforeAll(() => {
    process.env.OPERATOR_SECRET = 'aftermath-operator-test-secret-32-chars-long';
  });

  afterAll(() => {
    if (originalSecret !== undefined) {
      process.env.OPERATOR_SECRET = originalSecret;
    } else {
      delete process.env.OPERATOR_SECRET;
    }
  });

  beforeEach(async () => {
    customerEmail = `console-test-${Date.now()}@example.com`;
    customerId = `cus-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    orderId = `ord-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    reference = generatePaystackReference();

    await db.insert(customers).values({
      id: customerId,
      email: customerEmail,
      name: 'Console Test User',
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

  describe('1. Operator Authentication & Session Token Crypto', () => {
    it('verifies operator passphrase using constant-time comparison', () => {
      const correctSecret = process.env.OPERATOR_SECRET!;
      expect(verifyOperatorPassword(correctSecret)).toBe(true);
      expect(verifyOperatorPassword('wrong-passphrase')).toBe(false);
      expect(verifyOperatorPassword('')).toBe(false);
    });

    it('fails closed when OPERATOR_SECRET is missing or shorter than 16 characters', () => {
      const saved = process.env.OPERATOR_SECRET;
      try {
        delete process.env.OPERATOR_SECRET;
        expect(verifyOperatorPassword('any-passphrase-whatsoever')).toBe(false);
        expect(() => createOperatorSessionToken()).toThrow(/OPERATOR_SECRET is missing or shorter/);

        process.env.OPERATOR_SECRET = 'short-secret';
        expect(verifyOperatorPassword('short-secret')).toBe(false);
        expect(() => createOperatorSessionToken()).toThrow(/OPERATOR_SECRET is missing or shorter/);
      } finally {
        process.env.OPERATOR_SECRET = saved;
      }
    });

    it('generates signed HMAC session token and verifies valid tokens', () => {
      const token = createOperatorSessionToken();
      expect(typeof token).toBe('string');
      expect(token).toContain('.');
      expect(verifyOperatorSessionToken(token)).toBe(true);
    });

    it('rejects tampered or forged session tokens', () => {
      const token = createOperatorSessionToken();
      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.forged_signature_xyz`;
      expect(verifyOperatorSessionToken(tamperedToken)).toBe(false);
      expect(verifyOperatorSessionToken('invalid.payload')).toBe(false);
      expect(verifyOperatorSessionToken(null)).toBe(false);
    });

    it('enforces authentication on GET /api/incidents/[id] route (401 when missing)', async () => {
      const unauthReq = new NextRequest('http://localhost:3000/api/incidents/inc_test_123');
      const response = await getIncidentRoute(unauthReq, {
        params: Promise.resolve({ id: 'inc_test_123' }),
      });
      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toContain('Unauthorized');
    });

    it('permits authenticated operator on GET /api/incidents/[id]', async () => {
      const incId = `inc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await db.insert(incidents).values({
        id: incId,
        orderId,
        paymentReference: reference,
        customerId,
        status: 'OPEN',
        reason: 'PAID_BUT_UNFULFILLED',
      });

      const token = createOperatorSessionToken();
      const authReq = new NextRequest('http://localhost:3000/api/incidents/' + incId, {
        headers: {
          cookie: `aftermath_operator_session=${token}`,
        },
      });

      const response = await getIncidentRoute(authReq, {
        params: Promise.resolve({ id: incId }),
      });
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.incident.id).toBe(incId);
    });
  });

  describe('2. PII Sanitization & Data Redaction', () => {
    it('redacts customer email to prevent PII exposure in public console', () => {
      expect(redactEmail('eugene@example.com')).toBe('eu***@example.com');
      expect(redactEmail('alex.smith@neatlogs.com')).toBe('al***@neatlogs.com');
      expect(redactEmail('a@b.com')).toBe('a***@b.com');
      expect(redactEmail('')).toBe('unknown@redacted');
      expect(redactEmail(null)).toBe('unknown@redacted');
    });
  });

  describe('3. Authoritative Query Service & Operations Overview', () => {
    it('derives authoritative metrics and active worker count from PostgreSQL', async () => {
      const overview = await queryService.getOperationsOverview();

      expect(overview).toBeDefined();
      expect(overview.metrics).toBeDefined();
      expect(typeof overview.metrics.totalIncidents).toBe('number');
      expect(typeof overview.metrics.resolvedIncidents).toBe('number');
      expect(typeof overview.metrics.activeEntitlements).toBe('number');
      expect(overview.workerFleet).toBeDefined();
      expect(Array.isArray(overview.recentActivity)).toBe(true);
    });

    it('retrieves paginated and filtered incidents with customer email redacted', async () => {
      // Create a test incident
      const incId = `inc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await db.insert(incidents).values({
        id: incId,
        orderId,
        paymentReference: reference,
        customerId,
        status: 'OPEN',
        reason: 'PAID_BUT_UNFULFILLED',
      });

      const list = await queryService.getIncidents({ limit: 10, offset: 0 });
      expect(list.incidents.length).toBeGreaterThan(0);
      expect(list.total).toBeGreaterThan(0);

      const target = list.incidents.find((i) => i.id === incId);
      expect(target).toBeDefined();
      expect(target?.customerEmailRedacted).toContain('***@');
      expect(target?.expectedAmount).toBe(500000);
      expect(target?.currency).toBe('NGN');
    });

    it('retrieves full 10-step investigation detail and truthful evidence dossier', async () => {
      const incId = `inc_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await db.insert(incidents).values({
        id: incId,
        orderId,
        paymentReference: reference,
        customerId,
        status: 'RESOLVED',
        reason: 'PAID_BUT_UNFULFILLED',
        lastDecision: 'PROPOSE_RECOVERY',
        decisionSummary: 'Verified matching payment against order.',
        resolvedAt: new Date(),
      });

      const detail = await queryService.getIncidentDetail(incId);
      expect(detail).not.toBeNull();
      expect(detail?.incident.id).toBe(incId);
      expect(detail?.order.id).toBe(orderId);
      expect(detail?.customer.emailRedacted).toContain('***@');
      expect(detail?.evidenceDossier).toBeDefined();
      expect(detail?.evidenceDossier.amountMatched).toBe('VERIFIED');
      expect(detail?.evidenceDossier.currencyMatched).toBe('VERIFIED');
      expect(detail?.evidenceDossier.customerMatched).toBe('VERIFIED');
      expect(detail?.evidenceDossier.paymentVerificationState).toBeDefined();
      expect(detail?.neatlogsTrace).toBeDefined();
      expect(detail?.neatlogsTrace.workflowName).toBeDefined();
    });
  });

  describe('4. Controlled Scenario Runner Backend Executions', () => {
    it('executes Scenario A (Missing Entitlement Autonomous Recovery) on real database', async () => {
      const result = await scenarioRunnerService.runScenarioA();

      expect(result.scenario).toBe('A');
      expect(result.label).toBe('SIMULATED TEST FIXTURE');
      expect(result.success).toBe(true);
      expect(result.finalIncidentStatus).toBe('RESOLVED');
      expect(result.entitlementId).toBeDefined();
      expect(result.steps.length).toBeGreaterThanOrEqual(4);

      // Verify row persisted in PostgreSQL
      const [persisted] = await db.select().from(incidents).where(eq(incidents.id, result.incidentId));
      expect(persisted.status).toBe('RESOLVED');
    }, 30000);

    it('executes Scenario B (Transient Failure & Reconciliation) with zero duplicate entitlements', async () => {
      const result = await scenarioRunnerService.runScenarioB();

      expect(result.scenario).toBe('B');
      expect(result.label).toBe('SIMULATED TEST FIXTURE');
      expect(result.success).toBe(true);
      expect(result.finalIncidentStatus).toBe('RESOLVED');

      // Verify only 1 entitlement row exists for order
      const orderEnts = await db.select().from(entitlements).where(eq(entitlements.orderId, result.orderId));
      expect(orderEnts).toHaveLength(1);
    }, 30000);

    it('executes Scenario C (Unsafe / Underpaid Payment) blocking recovery and escalating to ESCALATED', async () => {
      const result = await scenarioRunnerService.runScenarioC();

      expect(result.scenario).toBe('C');
      expect(result.label).toBe('SIMULATED TEST FIXTURE');
      expect(result.success).toBe(true);
      expect(result.finalIncidentStatus).toBe('ESCALATED');
      expect(result.entitlementId).toBeNull();

      // Invariant check: zero entitlements created for underpaid transaction
      const orderEnts = await db.select().from(entitlements).where(eq(entitlements.orderId, result.orderId));
      expect(orderEnts).toHaveLength(0);
    }, 30000);

    it('executes Scenario D (Duplicate Events & Concurrency) enforcing relational uniqueness', async () => {
      const result = await scenarioRunnerService.runScenarioD();

      expect(result.scenario).toBe('D');
      expect(result.label).toBe('SIMULATED TEST FIXTURE');
      expect(result.success).toBe(true);

      const orderEnts = await db.select().from(entitlements).where(eq(entitlements.orderId, result.orderId));
      expect(orderEnts).toHaveLength(1);
    });
  });
});
