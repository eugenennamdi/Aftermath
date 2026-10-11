import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildTruthfulTimeline,
  determineReferenceMatch,
  type TimelineStage,
} from '@/components/incident-detail-modal';
import type { IncidentDetailView } from '@/services/query';

function createMockIncidentDetailView(overrides?: {
  incident?: Partial<IncidentDetailView['incident']>;
  order?: Partial<IncidentDetailView['order']>;
  customer?: Partial<IncidentDetailView['customer']>;
  plan?: Partial<IncidentDetailView['plan']>;
  entitlement?: Partial<NonNullable<IncidentDetailView['entitlement']>> | null;
  evidenceDossier?: Partial<IncidentDetailView['evidenceDossier']>;
  auditTrail?: IncidentDetailView['auditTrail'];
  paymentEvents?: IncidentDetailView['paymentEvents'];
  neatlogsTrace?: Partial<IncidentDetailView['neatlogsTrace']>;
}): IncidentDetailView {
  const now = new Date();
  const base: IncidentDetailView = {
    incident: {
      id: 'inc_test_123',
      orderId: 'ord_test_123',
      customerId: 'cust_123',
      status: 'RESOLVED',
      reason: 'UNFULFILLED_PAID_ORDER',
      paymentReference: 'ref_test_123',
      fencingToken: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      isLeaseActive: false,
      retryCount: 0,
      nextRetryAt: null,
      lastDecision: 'PROPOSE_RECOVERY',
      decisionSummary: 'Payment verified and deterministic gate checks passed.',
      errorDetail: null,
      resolvedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    order: {
      id: 'ord_test_123',
      expectedAmount: 500000,
      currency: 'NGN',
      status: 'FULFILLED',
      paymentReference: 'ref_test_123',
      paidAt: now,
      createdAt: now,
    },
    customer: {
      id: 'cust_123',
      emailRedacted: 'al***@example.com',
      name: 'Alex Developer',
    },
    plan: {
      id: 'plan_pro_monthly',
      name: 'Pro Monthly',
      amount: 500000,
      currency: 'NGN',
      durationDays: 30,
    },
    entitlement: {
      id: 'ent_test_123',
      status: 'ACTIVE',
      sourceReference: 'ref_test_123',
      startedAt: now,
      expiresAt: new Date(Date.now() + 30 * 86400000),
      isActive: true,
    },
    evidenceDossier: {
      paymentVerificationState: 'PROVIDER_VERIFIED',
      amountExpected: 500000,
      amountVerified: 500000,
      amountMatched: 'VERIFIED',
      currencyExpected: 'NGN',
      currencyVerified: 'NGN',
      currencyMatched: 'VERIFIED',
      customerExpected: 'alex@example.com',
      customerVerified: 'alex@example.com',
      customerMatched: 'VERIFIED',
      verificationProvenance: 'LIVE_HTTP',
      entitlementActive: true,
      gateAuthorized: true,
    },
    auditTrail: [
      {
        id: 'aud_1',
        action: 'INCIDENT_PROCESSING_STARTED',
        actor: 'recovery-worker',
        details: 'Worker acquired lease with fencing token #1',
        createdAt: now,
      },
      {
        id: 'aud_2',
        action: 'PAYSTACK_VERIFIED',
        actor: 'recovery-worker',
        details: 'Live Paystack verification successful',
        createdAt: now,
      },
      {
        id: 'aud_3',
        action: 'INDEPENDENT_VERIFICATION_SUCCEEDED',
        actor: 'recovery-worker',
        details: 'Independent query confirmed active entitlement',
        createdAt: now,
      },
    ],
    paymentEvents: [
      {
        id: 'pe_1',
        paymentReference: 'ref_test_123',
        eventType: 'charge.success',
        status: 'success',
        amount: 500000,
        currency: 'NGN',
        customerEmailRedacted: 'al***@example.com',
        gatewayResponse: 'Successful',
        createdAt: now,
      },
    ],
    neatlogsTrace: {
      traceId: 'tr_test_neatlogs',
      workflowName: 'autonomous-recovery',
      traceUrl: 'https://neatlogs.com/traces/tr_test_neatlogs',
    },
  };

  return {
    ...base,
    incident: { ...base.incident, ...(overrides?.incident || {}) },
    order: { ...base.order, ...(overrides?.order || {}) },
    customer: { ...base.customer, ...(overrides?.customer || {}) },
    plan: { ...base.plan, ...(overrides?.plan || {}) },
    entitlement:
      overrides?.entitlement === null
        ? null
        : overrides?.entitlement
        ? { ...base.entitlement!, ...overrides.entitlement }
        : base.entitlement,
    evidenceDossier: { ...base.evidenceDossier, ...(overrides?.evidenceDossier || {}) },
    auditTrail: overrides?.auditTrail ?? base.auditTrail,
    paymentEvents: overrides?.paymentEvents ?? base.paymentEvents,
    neatlogsTrace: { ...base.neatlogsTrace, ...(overrides?.neatlogsTrace || {}) },
  };
}

describe('Operator Console UI — Truthful Incident Timeline & Evidence', () => {
  it('1. Investigating incident with in-progress state does not claim completion', () => {
    const view = createMockIncidentDetailView({
      incident: {
        status: 'INVESTIGATING',
        lastDecision: null,
        decisionSummary: null,
        leaseOwner: 'worker-instance-01',
        fencingToken: 2,
        isLeaseActive: true,
      },
      evidenceDossier: {
        gateAuthorized: false,
        amountVerified: null,
        amountMatched: 'UNKNOWN',
        currencyVerified: null,
        currencyMatched: 'UNKNOWN',
        customerVerified: null,
        customerMatched: 'UNKNOWN',
      },
      entitlement: null,
    });

    const timeline = buildTruthfulTimeline(view);

    const investigationStep = timeline.find((s: TimelineStage) => s.stepNumber === 3);
    expect(investigationStep).toBeDefined();
    expect(investigationStep?.status).toBe('IN_PROGRESS');
    expect(investigationStep?.title).toContain('Investigation in Progress');

    const gateStep = timeline.find((s: TimelineStage) => s.stepNumber === 4);
    expect(gateStep?.status).toBe('PENDING');
    expect(gateStep?.badgeLabel).toBe('GATE PENDING');

    const finalStep = timeline.find((s: TimelineStage) => s.stepNumber === 6);
    expect(finalStep?.status).toBe('IN_PROGRESS');
    expect(finalStep?.badgeLabel).toBe('INVESTIGATING');
  });

  it('2. Reconcile existing entitlement is distinguished from new provisioning', () => {
    const view = createMockIncidentDetailView({
      incident: {
        status: 'RESOLVED',
        lastDecision: 'RECONCILE_EXISTING',
        decisionSummary: 'Pre-existing entitlement detected; reconciled without mutation.',
        leaseOwner: null,
      },
    });

    const timeline = buildTruthfulTimeline(view);

    const step3 = timeline.find((s: TimelineStage) => s.stepNumber === 3);
    expect(step3?.badgeLabel).toBe('RECONCILE');

    const step5 = timeline.find((s: TimelineStage) => s.stepNumber === 5);
    expect(step5?.title).toBe('Pre-existing Entitlement Observed & Reconciled');
    expect(step5?.badgeLabel).toBe('RECONCILED');
    expect(step5?.description).toContain('Access was granted prior; zero duplicate mutations');

    const step6 = timeline.find((s: TimelineStage) => s.stepNumber === 6);
    expect(step6?.title).toBe('Incident Resolved via Reconciliation');
    expect(step6?.badgeLabel).toBe('RECONCILED');
  });

  it('3. Escalation due to gate rejection vs retry exhaustion', () => {
    // 3A: Gate rejection due to underpayment
    const underpaidView = createMockIncidentDetailView({
      incident: {
        status: 'ESCALATED',
        lastDecision: 'ESCALATE',
        reason: 'VERIFICATION_MISMATCH',
        errorDetail: 'Deterministic gate failed: underpaid 250000 vs 500000',
        leaseOwner: null,
      },
      evidenceDossier: {
        gateAuthorized: false,
        amountMatched: 'MISMATCH',
      },
      entitlement: null,
    });

    const underpaidTimeline = buildTruthfulTimeline(underpaidView);
    const gateStepA = underpaidTimeline.find((s: TimelineStage) => s.stepNumber === 4);
    expect(gateStepA?.title).toBe('Deterministic Gate: Rejected');
    expect(gateStepA?.badgeLabel).toBe('GATE REJECTED');
    expect(gateStepA?.status).toBe('REJECTED');

    // 3B: Retry exhaustion without gate evaluation
    const retryExhaustedView = createMockIncidentDetailView({
      incident: {
        status: 'ESCALATED',
        lastDecision: null,
        reason: 'UNFULFILLED_PAID_ORDER',
        retryCount: 5,
        errorDetail: 'Retry budget exhausted after 5 attempts',
        leaseOwner: null,
      },
      evidenceDossier: {
        gateAuthorized: false,
      },
      entitlement: null,
    });

    const retryTimeline = buildTruthfulTimeline(retryExhaustedView);
    const gateStepB = retryTimeline.find((s: TimelineStage) => s.stepNumber === 4);
    expect(gateStepB?.title).toBe('Deterministic Gate: Deferral / Retry Exhausted');
    expect(gateStepB?.badgeLabel).toBe('BLOCKED');
    expect(gateStepB?.status).toBe('BLOCKED');

    const step5B = retryTimeline.find((s: TimelineStage) => s.stepNumber === 5);
    expect(step5B?.title).toBe('No Entitlement Linked');
    expect(step5B?.badgeLabel).toBe('NOT CREATED');
  });

  it('4. Independent verification is not falsely claimed without audit record', () => {
    const now = new Date();
    const viewWithoutAudit = createMockIncidentDetailView({
      auditTrail: [
        {
          id: 'aud_1',
          action: 'INCIDENT_PROCESSING_STARTED',
          actor: 'worker',
          details: 'Worker started',
          createdAt: now,
        },
      ],
    });

    const timeline = buildTruthfulTimeline(viewWithoutAudit);
    const step5 = timeline.find((s: TimelineStage) => s.stepNumber === 5);
    expect(step5?.title).toBe('Active Entitlement Record Observed');
    expect(step5?.description).toContain('independent confirmation query not recorded in audit trail');

    // With explicit independent verification audit record
    const viewWithAudit = createMockIncidentDetailView({
      auditTrail: [
        {
          id: 'aud_2',
          action: 'INDEPENDENT_VERIFICATION_SUCCEEDED',
          actor: 'worker',
          details: 'Verified fresh read',
          createdAt: now,
        },
      ],
    });

    const timelineWithAudit = buildTruthfulTimeline(viewWithAudit);
    const step5WithAudit = timelineWithAudit.find((s: TimelineStage) => s.stepNumber === 5);
    expect(step5WithAudit?.title).toBe('Entitlement Active & Independently Confirmed');
  });

  it('5. Model decision attribution requires recorded evidence', () => {
    const now = new Date();
    // Model attribution with LiteLLM/claude audit trace
    const viewWithModel = createMockIncidentDetailView({
      auditTrail: [
        {
          id: 'aud_1',
          action: 'INVESTIGATION_DECISION',
          actor: 'agent',
          details: 'Invoked claude-sonnet via LiteLLM',
          createdAt: now,
        },
      ],
    });
    const timelineModel = buildTruthfulTimeline(viewWithModel);
    expect(timelineModel.find((s: TimelineStage) => s.stepNumber === 3)?.description).toContain('Claude Sonnet 4.6');

    // Fixture attribution
    const viewWithFixture = createMockIncidentDetailView({
      auditTrail: [
        {
          id: 'aud_2',
          action: 'PAYSTACK_FIXTURE_VERIFIED',
          actor: 'fixture',
          details: 'SIMULATED FIXTURE verification',
          createdAt: now,
        },
      ],
    });
    const timelineFixture = buildTruthfulTimeline(viewWithFixture);
    expect(timelineFixture.find((s: TimelineStage) => s.stepNumber === 3)?.description).toContain('Controlled test fixture');

    // Generic fallback without recorded provider
    const viewGeneric = createMockIncidentDetailView({
      auditTrail: [],
    });
    const timelineGeneric = buildTruthfulTimeline(viewGeneric);
    expect(timelineGeneric.find((s: TimelineStage) => s.stepNumber === 3)?.description).toBe(
      'Autonomous recovery engine evaluated gathered evidence and emitted structured intent.'
    );
  });

  it('6. Transaction reference matching distinguishes live provider match from local binding', () => {
    const now = new Date();
    // Provider verified and matches order paymentReference
    const matchView = createMockIncidentDetailView({
      evidenceDossier: {
        paymentVerificationState: 'PROVIDER_VERIFIED',
      },
      order: {
        paymentReference: 'ref_live_match',
      },
      paymentEvents: [
        {
          id: 'pe_1',
          paymentReference: 'ref_live_match',
          eventType: 'charge.success',
          status: 'success',
          amount: 500000,
          currency: 'NGN',
          customerEmailRedacted: 'al***@example.com',
          gatewayResponse: 'Successful',
          createdAt: now,
        },
      ],
    });
    const matchResult = determineReferenceMatch(matchView);
    expect(matchResult.isReferenceMatched).toBe(true);
    expect(matchResult.displayStatus).toBe('MATCH');

    // Payment reference present locally, but provider unverified
    const localBindingOnlyView = createMockIncidentDetailView({
      evidenceDossier: {
        paymentVerificationState: 'UNVERIFIED',
      },
      order: {
        paymentReference: 'ref_local_only',
      },
      paymentEvents: [
        {
          id: 'pe_2',
          paymentReference: 'ref_local_only',
          eventType: 'charge.success',
          status: 'success',
          amount: 500000,
          currency: 'NGN',
          customerEmailRedacted: 'al***@example.com',
          gatewayResponse: null,
          createdAt: now,
        },
      ],
    });
    const localResult = determineReferenceMatch(localBindingOnlyView);
    expect(localResult.isReferenceMatched).toBe(false);
    expect(localResult.displayStatus).toBe('LOCAL BINDING ONLY');
  });

  it('7. Operations overview view does not contain unconditional fixture badge', () => {
    const overviewPath = path.resolve(process.cwd(), 'src/components/operations-overview-view.tsx');
    const content = readFileSync(overviewPath, 'utf8');

    expect(content).not.toContain('LOCAL TEST DATA / FIXTURES');
  });

  it('8. Radix UI Dialog and Tabs primitives export and configure accessible attributes', () => {
    const dialogPath = path.resolve(process.cwd(), 'src/components/ui/dialog.tsx');
    const dialogContent = readFileSync(dialogPath, 'utf8');
    expect(dialogContent).toContain('radix-ui');
    expect(dialogContent).toContain('data-slot="dialog"');
    expect(dialogContent).toContain('data-slot="dialog-content"');

    const tabsPath = path.resolve(process.cwd(), 'src/components/ui/tabs.tsx');
    const tabsContent = readFileSync(tabsPath, 'utf8');
    expect(tabsContent).toContain('radix-ui');
    expect(tabsContent).toContain('data-slot="tabs"');
    expect(tabsContent).toContain('data-slot="tabs-list"');
    expect(tabsContent).toContain('data-slot="tabs-trigger"');
  });
});
