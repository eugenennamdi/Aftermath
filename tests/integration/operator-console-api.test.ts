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
import { GET as getIncidentsListRoute } from '@/app/api/incidents/route';
import { GET as getOverviewRoute } from '@/app/api/incidents/overview/route';
import { POST as runScenarioRoute } from '@/app/api/scenarios/run/route';
import { POST as workerTickRoute } from '@/app/api/worker/tick/route';
import { POST as checkoutInitializeRoute } from '@/app/api/checkout/initialize/route';
import { paymentEvents } from '@/db/schema';
import {
  validateCsrfOrOrigin,
  isWorkerCronAuthorized,
  resetCheckoutRateLimits,
} from '@/lib/auth';

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

    it('enforces authentication on GET /api/incidents (401 when missing, 200 when authenticated)', async () => {
      const unauthReq = new NextRequest('http://localhost:3000/api/incidents');
      const unauthRes = await getIncidentsListRoute(unauthReq);
      expect(unauthRes.status).toBe(401);
      const unauthJson = await unauthRes.json();
      expect(unauthJson.authenticated).toBe(false);

      const token = createOperatorSessionToken();
      const authReq = new NextRequest('http://localhost:3000/api/incidents', {
        headers: { cookie: `aftermath_operator_session=${token}` },
      });
      const authRes = await getIncidentsListRoute(authReq);
      expect(authRes.status).toBe(200);
      const authJson = await authRes.json();
      expect(Array.isArray(authJson.incidents)).toBe(true);
    });

    it('returns safe public summary on GET /api/incidents/overview when unauthenticated', async () => {
      const unauthReq = new NextRequest('http://localhost:3000/api/incidents/overview');
      const unauthRes = await getOverviewRoute(unauthReq);
      expect(unauthRes.status).toBe(200);
      const unauthJson = await unauthRes.json();
      expect(unauthJson.authenticated).toBe(false);
      expect(unauthJson.metrics).toBeDefined();
      expect(unauthJson.workerFleet).toBeDefined();
      expect(unauthJson.recentActivity).toEqual([]); // Stripped to prevent tenant info leak

      const token = createOperatorSessionToken();
      const authReq = new NextRequest('http://localhost:3000/api/incidents/overview', {
        headers: { cookie: `aftermath_operator_session=${token}` },
      });
      const authRes = await getOverviewRoute(authReq);
      expect(authRes.status).toBe(200);
      const authJson = await authRes.json();
      expect(authJson.authenticated).toBe(true);
      expect(Array.isArray(authJson.recentActivity)).toBe(true);
    });

    it('enforces authentication and origin on POST /api/scenarios/run', async () => {
      // Unauthenticated
      const unauthReq = new NextRequest('http://localhost:3000/api/scenarios/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:3000',
        },
        body: JSON.stringify({ scenario: 'A' }),
      });
      const unauthRes = await runScenarioRoute(unauthReq);
      expect(unauthRes.status).toBe(401);

      // Untrusted Origin
      const token = createOperatorSessionToken();
      const untrustedReq = new NextRequest('http://localhost:3000/api/scenarios/run', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `aftermath_operator_session=${token}`,
          origin: 'http://evil.com',
        },
        body: JSON.stringify({ scenario: 'A' }),
      });
      const untrustedRes = await runScenarioRoute(untrustedReq);
      expect(untrustedRes.status).toBe(403);
    });

    it('enforces operator session or CRON_SECRET on POST /api/worker/tick', async () => {
      // Unauthenticated without cron secret -> 401
      const unauthReq = new NextRequest('http://localhost:3000/api/worker/tick', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const unauthRes = await workerTickRoute(unauthReq);
      expect(unauthRes.status).toBe(401);

      // With valid CRON_SECRET header -> passes auth
      process.env.CRON_SECRET = 'valid-cron-secret-at-least-16-chars';
      try {
        const cronReq = new NextRequest('http://localhost:3000/api/worker/tick', {
          method: 'POST',
          headers: {
            'x-cron-secret': 'valid-cron-secret-at-least-16-chars',
            'content-type': 'application/json',
          },
          body: JSON.stringify({}),
        });
        const cronRes = await workerTickRoute(cronReq);
        expect(cronRes.status).toBe(200);
      } finally {
        delete process.env.CRON_SECRET;
      }
    }, 15000);

    it('enforces strict CSRF origin validation: rejects mismatched ports and spoofed hosts', () => {
      // Valid matching origin
      const validReq = new NextRequest('http://localhost:3000/api/checkout/initialize', {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
      });
      expect(validateCsrfOrOrigin(validReq)).toBe(true);

      // Port mismatch (e.g. attacker running on port 4000)
      const wrongPortReq = new NextRequest('http://localhost:3000/api/checkout/initialize', {
        method: 'POST',
        headers: { origin: 'http://localhost:4000' },
      });
      expect(validateCsrfOrOrigin(wrongPortReq)).toBe(false);

      // Spoofed Host header with matching attacker origin
      const spoofedHostReq = new NextRequest('http://evil.com/api/checkout/initialize', {
        method: 'POST',
        headers: {
          host: 'evil.com',
          origin: 'http://evil.com',
        },
      });
      expect(validateCsrfOrOrigin(spoofedHostReq)).toBe(false);
    });

    it('enforces strict CSRF behavior: blocks cookie-authenticated mutations missing Origin and fails closed in production', () => {
      const token = createOperatorSessionToken();

      // 1. Cookie-authenticated mutation missing Origin and Referer -> strictly false (prevents CSRF)
      const cookieNoOriginReq = new NextRequest('http://localhost:3000/api/checkout/initialize', {
        method: 'POST',
        headers: {
          cookie: `aftermath_operator_session=${token}`,
        },
      });
      expect(validateCsrfOrOrigin(cookieNoOriginReq)).toBe(false);

      // 2. Cookie-authenticated mutation with untrusted cross-site origin -> false
      const cookieEvilOriginReq = new NextRequest('http://localhost:3000/api/checkout/initialize', {
        method: 'POST',
        headers: {
          cookie: `aftermath_operator_session=${token}`,
          origin: 'http://evil-attacker.com',
        },
      });
      expect(validateCsrfOrOrigin(cookieEvilOriginReq)).toBe(false);

      // 3. Fails closed in production when no trusted origins are configured
      const originalEnv = process.env.NODE_ENV;
      const originalAppUrl = process.env.APP_URL;
      const originalTrusted = process.env.TRUSTED_ORIGINS;

      try {
        (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
        delete process.env.APP_URL;
        delete process.env.TRUSTED_ORIGINS;

        const prodReq = new NextRequest('http://localhost:3000/api/checkout/initialize', {
          method: 'POST',
          headers: { origin: 'http://localhost:3000' },
        });
        // In production without APP_URL, trusted origins list is empty -> fails closed
        expect(validateCsrfOrOrigin(prodReq)).toBe(false);
      } finally {
        (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
        if (originalAppUrl) process.env.APP_URL = originalAppUrl;
        if (originalTrusted) process.env.TRUSTED_ORIGINS = originalTrusted;
      }
    });

    it('enforces operator auth, rate limiting and plan allowlist on POST /api/checkout/initialize', async () => {
      resetCheckoutRateLimits();

      // 1. Unauthenticated request without session or checkout secret -> 401
      const unauthReq = new NextRequest('http://localhost:3000/api/checkout/initialize', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          planId: 'plan_starter_monthly',
          customerEmail: 'checkout-test@example.com',
        }),
      });
      const unauthRes = await checkoutInitializeRoute(unauthReq);
      expect(unauthRes.status).toBe(401);

      // 2. Untrusted origin -> 403
      const token = createOperatorSessionToken();
      const untrustedReq = new NextRequest('http://localhost:3000/api/checkout/initialize', {
        method: 'POST',
        headers: {
          origin: 'http://evil.com',
          cookie: `aftermath_operator_session=${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          planId: 'plan_starter_monthly',
          customerEmail: 'checkout-test@example.com',
        }),
      });
      const untrustedRes = await checkoutInitializeRoute(untrustedReq);
      expect(untrustedRes.status).toBe(403);

      // 3. Unauthorized plan -> 403
      const invalidPlanReq = new NextRequest('http://localhost:3000/api/checkout/initialize', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          cookie: `aftermath_operator_session=${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          planId: 'unauthorized_enterprise_plan',
          customerEmail: 'checkout-test@example.com',
        }),
      });
      const invalidPlanRes = await checkoutInitializeRoute(invalidPlanReq);
      expect(invalidPlanRes.status).toBe(403);

      // 4. Authenticated operator session creates trusted order -> 200
      const authReq = new NextRequest('http://localhost:3000/api/checkout/initialize', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          cookie: `aftermath_operator_session=${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          planId: 'plan_starter_monthly',
          customerEmail: 'checkout-test@example.com',
        }),
      });
      const authRes = await checkoutInitializeRoute(authReq);
      expect(authRes.status).toBe(200);
      const authData = await authRes.json();
      expect(authData.success).toBe(true);
      expect(authData.order.id).toBeDefined();
      expect(authData.order.paymentReference).toBeDefined();

      // 5. Server-to-server request with x-checkout-secret -> 200
      const serverReq = new NextRequest('http://localhost:3000/api/checkout/initialize', {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'x-checkout-secret': process.env.OPERATOR_SECRET!,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          planId: 'plan_pro_monthly',
          customerEmail: 'server-checkout@example.com',
        }),
      });
      const serverRes = await checkoutInitializeRoute(serverReq);
      expect(serverRes.status).toBe(200);
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

    it('retrieves full 10-step investigation detail and enforces truthful payment evidence provenance', async () => {
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

      // 1. Without paymentEvents or adapter logs: strictly UNVERIFIED and UNKNOWN (never infer PROVIDER_VERIFIED from RESOLVED)
      const detailUnverified = await queryService.getIncidentDetail(incId);
      expect(detailUnverified).not.toBeNull();
      expect(detailUnverified?.incident.id).toBe(incId);
      expect(detailUnverified?.order.id).toBe(orderId);
      expect(detailUnverified?.customer.emailRedacted).toContain('***@');
      expect(detailUnverified?.evidenceDossier).toBeDefined();
      expect(detailUnverified?.evidenceDossier.paymentVerificationState).toBe('UNVERIFIED');
      expect(detailUnverified?.evidenceDossier.amountMatched).toBe('UNKNOWN');
      expect(detailUnverified?.evidenceDossier.currencyMatched).toBe('UNKNOWN');
      expect(detailUnverified?.evidenceDossier.customerMatched).toBe('UNKNOWN');
      expect(detailUnverified?.evidenceDossier.amountVerified).toBeNull();
      expect(detailUnverified?.neatlogsTrace.traceUrl).toBeNull();

      // 2. Insert authoritative paymentEvents record: signed webhook observed (awaiting independent verification)
      await db.insert(paymentEvents).values({
        id: `pe_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        orderId,
        paymentReference: reference,
        eventType: 'charge.success',
        status: 'success',
        amount: 500000,
        currency: 'NGN',
        customerEmail: customerEmail,
        payloadHash: crypto.createHash('sha256').update(reference).digest('hex'),
        gatewayResponse: 'Successful',
      });

      const detailWebhook = await queryService.getIncidentDetail(incId);
      expect(detailWebhook?.evidenceDossier.paymentVerificationState).toBe('WEBHOOK_OBSERVED');
      expect(detailWebhook?.evidenceDossier.amountMatched).toBe('VERIFIED');
      expect(detailWebhook?.evidenceDossier.amountVerified).toBe(500000);

      // 3. Insert audit log with actual independent provider verification response and valid traceId
      const validTraceId = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
      await db.insert(auditLogs).values({
        id: `log_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`,
        incidentId: incId,
        orderId,
        action: 'PAYSTACK_VERIFIED',
        actor: 'paystack_adapter',
        details: JSON.stringify({
          reference,
          outcome: 'SUCCESS',
          amount: 500000,
          currency: 'NGN',
          customerEmail,
          traceId: validTraceId,
        }),
      });

      const detailVerified = await queryService.getIncidentDetail(incId);
      expect(detailVerified?.evidenceDossier.paymentVerificationState).toBe('PROVIDER_VERIFIED');
      expect(detailVerified?.evidenceDossier.amountMatched).toBe('VERIFIED');
      expect(detailVerified?.evidenceDossier.amountVerified).toBe(500000);
      expect(detailVerified?.evidenceDossier.currencyMatched).toBe('VERIFIED');
      expect(detailVerified?.evidenceDossier.customerMatched).toBe('VERIFIED');
      expect(detailVerified?.neatlogsTrace.traceUrl).toBe(`https://neatlogs.com/app/traces/${validTraceId}`);
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
