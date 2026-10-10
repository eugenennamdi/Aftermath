import { eq, desc, asc, and, or, sql, ilike } from 'drizzle-orm';
import { db } from '../db';
import {
  incidents,
  orders,
  customers,
  subscriptionPlans,
  entitlements,
  auditLogs,
  paymentEvents,
} from '../db/schema';

/**
 * Redacts customer email to protect PII in operator views.
 * e.g. "eugene@example.com" -> "eu***@example.com"
 */
export function redactEmail(email: string | null | undefined): string {
  if (!email || typeof email !== 'string') return 'unknown@redacted';
  const parts = email.split('@');
  if (parts.length !== 2) return '***@redacted';
  const local = parts[0];
  const domain = parts[1];
  const visible = local.slice(0, 2);
  return `${visible}***@${domain}`;
}

export type MatchStatus = 'VERIFIED' | 'MISMATCH' | 'UNKNOWN' | 'NOT_APPLICABLE';
export type PaymentVerificationState =
  | 'PROVIDER_VERIFIED'
  | 'WEBHOOK_OBSERVED'
  | 'SIMULATED_FIXTURE'
  | 'VERIFICATION_FAILED'
  | 'UNVERIFIED';

export interface OperationsOverview {
  metrics: {
    totalIncidents: number;
    resolvedIncidents: number;
    activeInvestigations: number;
    escalatedIncidents: number;
    openIncidents: number;
    activeEntitlements: number;
    totalOrders: number;
    resolutionRate: number | null; // percentage (0 - 100), or null if 0 incidents
  };
  workerFleet: {
    activeWorkersCount: number;
    activeWorkerIds: string[];
    hasActiveWorker: boolean;
  };
  recentActivity: Array<{
    id: string;
    incidentId: string | null;
    orderId: string | null;
    action: string;
    actor: string;
    details: string | null;
    createdAt: Date;
  }>;
}

export interface IncidentListItem {
  id: string;
  orderId: string;
  paymentReference: string;
  customerId: string;
  customerEmailRedacted: string;
  planName: string;
  expectedAmount: number;
  currency: string;
  status: string;
  reason: string;
  fencingToken: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  isLeaseActive: boolean;
  retryCount: number;
  lastDecision: string | null;
  decisionSummary: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IncidentDetailView {
  incident: {
    id: string;
    orderId: string;
    paymentReference: string;
    customerId: string;
    status: string;
    reason: string;
    fencingToken: number;
    leaseOwner: string | null;
    leaseExpiresAt: Date | null;
    isLeaseActive: boolean;
    retryCount: number;
    nextRetryAt: Date | null;
    lastDecision: string | null;
    decisionSummary: string | null;
    errorDetail: string | null;
    resolvedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  order: {
    id: string;
    expectedAmount: number;
    currency: string;
    status: string;
    paymentReference: string;
    paidAt: Date | null;
    createdAt: Date;
  };
  customer: {
    id: string;
    emailRedacted: string;
    name: string | null;
  };
  plan: {
    id: string;
    name: string;
    amount: number;
    currency: string;
    durationDays: number;
  };
  entitlement: {
    id: string;
    status: string;
    sourceReference: string;
    startedAt: Date;
    expiresAt: Date;
    isActive: boolean;
  } | null;
  paymentEvents: Array<{
    id: string;
    paymentReference: string;
    eventType: string;
    status: string;
    amount: number;
    currency: string;
    customerEmailRedacted: string;
    gatewayResponse: string | null;
    createdAt: Date;
  }>;
  auditTrail: Array<{
    id: string;
    action: string;
    actor: string;
    details: string | null;
    createdAt: Date;
  }>;
  evidenceDossier: {
    amountExpected: number;
    amountVerified: number | null;
    amountMatched: MatchStatus;
    currencyExpected: string;
    currencyVerified: string | null;
    currencyMatched: MatchStatus;
    customerExpected: string;
    customerVerified: string | null;
    customerMatched: MatchStatus;
    paymentVerificationState: PaymentVerificationState;
    verificationProvenance: 'LIVE_HTTP' | 'SCOPED_FIXTURE' | 'WEBHOOK_ONLY' | 'UNVERIFIED';
    entitlementActive: boolean;
    gateAuthorized: boolean;
  };
  neatlogsTrace: {
    traceId: string | null;
    traceUrl: string | null;
    workflowName: string;
  };
}

export class QueryService {
  /**
   * Derives authoritative metrics and active worker status from PostgreSQL.
   */
  public async getOperationsOverview(): Promise<OperationsOverview> {
    const [counts] = await db.select({
      totalIncidents: sql<number>`count(*)::int`,
      resolvedIncidents: sql<number>`count(case when ${incidents.status} = 'RESOLVED' then 1 end)::int`,
      activeInvestigations: sql<number>`count(case when ${incidents.status} in ('INVESTIGATING', 'PROVISIONED') then 1 end)::int`,
      escalatedIncidents: sql<number>`count(case when ${incidents.status} = 'ESCALATED' then 1 end)::int`,
      openIncidents: sql<number>`count(case when ${incidents.status} = 'OPEN' then 1 end)::int`,
    }).from(incidents);

    const [entitlementCounts] = await db.select({
      activeEntitlements: sql<number>`count(case when ${entitlements.status} = 'ACTIVE' and ${entitlements.expiresAt} > now() then 1 end)::int`,
    }).from(entitlements);

    const [orderCounts] = await db.select({
      totalOrders: sql<number>`count(*)::int`,
    }).from(orders);

    // Active workers with unexpired leases
    const activeLeases = await db
      .select({
        leaseOwner: incidents.leaseOwner,
      })
      .from(incidents)
      .where(
        and(
          sql`${incidents.leaseOwner} is not null`,
          sql`${incidents.leaseExpiresAt} > now()`
        )
      );

    // Also inspect recent worker activity in audit logs within the last 60 seconds
    const recentWorkerLogs = await db
      .select({
        actor: auditLogs.actor,
        details: auditLogs.details,
      })
      .from(auditLogs)
      .where(
        and(
          sql`${auditLogs.createdAt} > now() - interval '60 seconds'`,
          sql`${auditLogs.actor} = 'RECOVERY_WORKER'`
        )
      );

    const activeWorkerSet = new Set<string>();
    for (const l of activeLeases) {
      if (l.leaseOwner) activeWorkerSet.add(l.leaseOwner);
    }
    for (const log of recentWorkerLogs) {
      if (log.details) {
        try {
          const parsed = JSON.parse(log.details);
          if (parsed.workerId) activeWorkerSet.add(parsed.workerId);
        } catch {
          // not JSON, continue
        }
      }
    }
    const activeWorkerIds = Array.from(activeWorkerSet);

    // Recent activity audit trail (latest 10)
    const recentActivity = await db
      .select({
        id: auditLogs.id,
        incidentId: auditLogs.incidentId,
        orderId: auditLogs.orderId,
        action: auditLogs.action,
        actor: auditLogs.actor,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(10);

    const totalInc = counts?.totalIncidents ?? 0;
    const resolvedInc = counts?.resolvedIncidents ?? 0;
    const resolutionRate = totalInc > 0 ? Math.round((resolvedInc / totalInc) * 100) : null;

    return {
      metrics: {
        totalIncidents: totalInc,
        resolvedIncidents: resolvedInc,
        activeInvestigations: counts?.activeInvestigations ?? 0,
        escalatedIncidents: counts?.escalatedIncidents ?? 0,
        openIncidents: counts?.openIncidents ?? 0,
        activeEntitlements: entitlementCounts?.activeEntitlements ?? 0,
        totalOrders: orderCounts?.totalOrders ?? 0,
        resolutionRate,
      },
      workerFleet: {
        activeWorkersCount: activeWorkerIds.length,
        activeWorkerIds,
        hasActiveWorker: activeWorkerIds.length > 0,
      },
      recentActivity,
    };
  }

  /**
   * Retrieves a paginated and filtered list of incidents.
   */
  public async getIncidents(options?: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{
    incidents: IncidentListItem[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }> {
    const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);
    const offset = Math.max(options?.offset ?? 0, 0);
    const statusFilter = options?.status && options.status !== 'ALL' ? options.status : undefined;
    const searchTerm = options?.search?.trim();

    const conditions = [];

    if (statusFilter) {
      conditions.push(eq(incidents.status, statusFilter));
    }

    if (searchTerm) {
      const pattern = `%${searchTerm}%`;
      conditions.push(
        or(
          ilike(incidents.id, pattern),
          ilike(incidents.orderId, pattern),
          ilike(incidents.paymentReference, pattern),
          ilike(customers.email, pattern)
        )
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total count query
    const [totalResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(incidents)
      .innerJoin(orders, eq(incidents.orderId, orders.id))
      .innerJoin(customers, eq(incidents.customerId, customers.id))
      .where(whereClause);

    const total = totalResult?.count ?? 0;

    // Paginated rows
    const rows = await db
      .select({
        incident: incidents,
        order: orders,
        customer: customers,
        plan: subscriptionPlans,
      })
      .from(incidents)
      .innerJoin(orders, eq(incidents.orderId, orders.id))
      .innerJoin(customers, eq(incidents.customerId, customers.id))
      .innerJoin(subscriptionPlans, eq(orders.planId, subscriptionPlans.id))
      .where(whereClause)
      .orderBy(desc(incidents.createdAt))
      .limit(limit)
      .offset(offset);

    const now = Date.now();

    const items: IncidentListItem[] = rows.map(({ incident, order, customer, plan }) => {
      const isLeaseActive =
        Boolean(incident.leaseExpiresAt) &&
        new Date(incident.leaseExpiresAt!).getTime() > now &&
        Boolean(incident.leaseOwner);

      return {
        id: incident.id,
        orderId: incident.orderId,
        paymentReference: incident.paymentReference,
        customerId: incident.customerId,
        customerEmailRedacted: redactEmail(customer.email),
        planName: plan.name,
        expectedAmount: order.expectedAmount,
        currency: order.currency,
        status: incident.status,
        reason: incident.reason,
        fencingToken: incident.fencingToken,
        leaseOwner: incident.leaseOwner,
        leaseExpiresAt: incident.leaseExpiresAt,
        isLeaseActive,
        retryCount: incident.retryCount,
        lastDecision: incident.lastDecision,
        decisionSummary: incident.decisionSummary,
        resolvedAt: incident.resolvedAt,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
      };
    });

    return {
      incidents: items,
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * Retrieves full chronological evidence and audit history for a single incident.
   */
  public async getIncidentDetail(incidentId: string): Promise<IncidentDetailView | null> {
    const [row] = await db
      .select({
        incident: incidents,
        order: orders,
        customer: customers,
        plan: subscriptionPlans,
      })
      .from(incidents)
      .innerJoin(orders, eq(incidents.orderId, orders.id))
      .innerJoin(customers, eq(incidents.customerId, customers.id))
      .innerJoin(subscriptionPlans, eq(orders.planId, subscriptionPlans.id))
      .where(eq(incidents.id, incidentId))
      .limit(1);

    if (!row) return null;

    const { incident, order, customer, plan } = row;

    // Entitlement lookup
    const [ent] = await db
      .select()
      .from(entitlements)
      .where(eq(entitlements.orderId, order.id))
      .limit(1);

    // Payment events lookup
    const pEvents = await db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.paymentReference, incident.paymentReference))
      .orderBy(asc(paymentEvents.createdAt));

    // Audit logs for order/incident
    const logs = await db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        actor: auditLogs.actor,
        details: auditLogs.details,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(
        or(
          eq(auditLogs.incidentId, incident.id),
          eq(auditLogs.orderId, order.id)
        )
      )
      .orderBy(asc(auditLogs.createdAt));

    const now = Date.now();
    const isLeaseActive =
      Boolean(incident.leaseExpiresAt) &&
      new Date(incident.leaseExpiresAt!).getTime() > now &&
      Boolean(incident.leaseOwner);

    const isEntActive =
      Boolean(ent) &&
      ent!.status === 'ACTIVE' &&
      new Date(ent!.expiresAt).getTime() > now;

    // Synthesize evidence dossier checks
    const gateAuthorized = Boolean(
      incident.status === 'RESOLVED' ||
      incident.status === 'PROVISIONED' ||
      logs.some((l) => l.action === 'ENTITLEMENT_PROVISIONED' || l.action === 'INCIDENT_RESOLVED')
    );

    // Distinguish explicit fixture provenance vs real HTTP Paystack response
    const hasFixtureVerification =
      logs.some(
        (l) =>
          l.action === 'PAYSTACK_FIXTURE_VERIFIED' ||
          l.actor === 'paystack_fixture' ||
          (l.details &&
            (l.details.includes('SCOPED_FIXTURE') ||
              l.details.includes('TEST_FIXTURE') ||
              l.details.includes('SIMULATED') ||
              l.details.includes('Simulated')))
      ) || Boolean(incident.errorDetail?.includes('SIMULATED'));

    const hasLiveProviderVerification = logs.some(
      (l) =>
        (l.action === 'PAYSTACK_VERIFIED' || l.action === 'PAYMENT_VERIFIED') &&
        l.actor === 'paystack_adapter' &&
        (!l.details || !l.details.includes('SCOPED_FIXTURE'))
    );

    const hasFailedProviderVerification = logs.some(
      (l) =>
        (l.action === 'PAYSTACK_VERIFICATION_FAILED' ||
          l.action === 'PAYMENT_VERIFICATION_FAILED' ||
          l.action === 'PAYSTACK_FIXTURE_FAILED')
    );
    const hasChargeSuccess = pEvents.some(
      (e) => e.status === 'success' && e.eventType === 'charge.success'
    );
    const hasChargeFailed = pEvents.some((e) => e.status === 'failed');

    let paymentVerificationState: PaymentVerificationState = 'UNVERIFIED';
    let verificationProvenance: 'LIVE_HTTP' | 'SCOPED_FIXTURE' | 'WEBHOOK_ONLY' | 'UNVERIFIED' =
      'UNVERIFIED';

    if (hasLiveProviderVerification && !hasFixtureVerification) {
      // Authoritative independent live HTTP verification response persisted
      paymentVerificationState = 'PROVIDER_VERIFIED';
      verificationProvenance = 'LIVE_HTTP';
    } else if (hasFixtureVerification) {
      paymentVerificationState = 'SIMULATED_FIXTURE';
      verificationProvenance = 'SCOPED_FIXTURE';
    } else if (hasFailedProviderVerification || hasChargeFailed) {
      paymentVerificationState = 'VERIFICATION_FAILED';
      verificationProvenance = 'UNVERIFIED';
    } else if (hasChargeSuccess) {
      // Signed webhook observed, awaiting independent transaction verification
      paymentVerificationState = 'WEBHOOK_OBSERVED';
      verificationProvenance = 'WEBHOOK_ONLY';
    } else {
      paymentVerificationState = 'UNVERIFIED';
      verificationProvenance = 'UNVERIFIED';
    }

    // Determine truthful match status and verified amounts strictly from recorded evidence
    const amountExpected = order.expectedAmount;
    let amountVerified: number | null = null;
    let amountMatched: MatchStatus = 'UNKNOWN';

    const currencyExpected = order.currency;
    let currencyVerified: string | null = null;
    let currencyMatched: MatchStatus = 'UNKNOWN';

    const customerExpected = redactEmail(customer.email);
    let customerVerified: string | null = null;
    let customerMatched: MatchStatus = 'UNKNOWN';

    // Inspect if audit logs contain explicit recorded verification details from adapter
    const verificationLog = logs.find(
      (l) =>
        (l.action === 'PAYSTACK_VERIFIED' ||
          l.action === 'PAYSTACK_FIXTURE_VERIFIED' ||
          l.action === 'PAYMENT_VERIFIED' ||
          l.action === 'INVESTIGATION_EVIDENCE_GATHERED') &&
        l.details
    );

    let parsedVerificationDetails: {
      amount?: number;
      paidAmount?: number;
      currency?: string;
      customerEmail?: string;
      email?: string;
    } | null = null;

    if (verificationLog?.details) {
      try {
        parsedVerificationDetails = JSON.parse(verificationLog.details);
      } catch {
        parsedVerificationDetails = null;
      }
    }

    if (
      parsedVerificationDetails &&
      (paymentVerificationState === 'PROVIDER_VERIFIED' ||
        paymentVerificationState === 'SIMULATED_FIXTURE')
    ) {
      const amt = parsedVerificationDetails.amount ?? parsedVerificationDetails.paidAmount;
      if (typeof amt === 'number') {
        amountVerified = amt;
        amountMatched = amt === order.expectedAmount ? 'VERIFIED' : 'MISMATCH';
      }
      const curr = parsedVerificationDetails.currency;
      if (typeof curr === 'string') {
        currencyVerified = curr.toUpperCase();
        currencyMatched = curr.toUpperCase() === order.currency.toUpperCase() ? 'VERIFIED' : 'MISMATCH';
      }
      const email = parsedVerificationDetails.customerEmail ?? parsedVerificationDetails.email;
      if (typeof email === 'string') {
        customerVerified = redactEmail(email);
        customerMatched = email.toLowerCase() === customer.email.toLowerCase() ? 'VERIFIED' : 'MISMATCH';
      }
    }

    // Fall back to paymentEvents or secondary parsed details
    if (amountVerified === null && pEvents.length > 0) {
      const latest = pEvents[pEvents.length - 1];
      amountVerified = latest.amount;
      amountMatched = latest.amount === order.expectedAmount ? 'VERIFIED' : 'MISMATCH';

      currencyVerified = latest.currency;
      currencyMatched =
        latest.currency.toUpperCase() === order.currency.toUpperCase() ? 'VERIFIED' : 'MISMATCH';

      customerVerified = redactEmail(latest.customerEmail);
      customerMatched =
        latest.customerEmail.toLowerCase() === customer.email.toLowerCase()
          ? 'VERIFIED'
          : 'MISMATCH';
    } else if (amountVerified === null && parsedVerificationDetails) {
      const amt = parsedVerificationDetails.amount ?? parsedVerificationDetails.paidAmount;
      if (typeof amt === 'number') {
        amountVerified = amt;
        amountMatched = amt === order.expectedAmount ? 'VERIFIED' : 'MISMATCH';
      }
      const curr = parsedVerificationDetails.currency;
      if (typeof curr === 'string') {
        currencyVerified = curr.toUpperCase();
        currencyMatched = curr.toUpperCase() === order.currency.toUpperCase() ? 'VERIFIED' : 'MISMATCH';
      }
      const email = parsedVerificationDetails.customerEmail ?? parsedVerificationDetails.email;
      if (typeof email === 'string') {
        customerVerified = redactEmail(email);
        customerMatched = email.toLowerCase() === customer.email.toLowerCase() ? 'VERIFIED' : 'MISMATCH';
      }
    }


      // If still UNKNOWN and incident was escalated due to an explicit mismatch:
      if (amountMatched === 'UNKNOWN' && incident.status === 'ESCALATED') {
        const errText = `${incident.decisionSummary || ''} ${incident.errorDetail || ''} ${incident.reason || ''}`;
        const amountMatchRegex = /Paid amount \((\d+)\)/i.exec(errText);
        if (amountMatchRegex) {
          amountVerified = parseInt(amountMatchRegex[1], 10);
          amountMatched = 'MISMATCH';
        } else if (/amount/i.test(errText) && (/mismatch|does not match|underpaid/i.test(errText))) {
          amountMatched = 'MISMATCH';
        }

        if (/currency/i.test(errText) && (/mismatch|does not match/i.test(errText))) {
          currencyMatched = 'MISMATCH';
        }

        if (/payer email|customer email/i.test(errText) && (/mismatch|does not match/i.test(errText))) {
          customerMatched = 'MISMATCH';
        }
      }

    // Extract genuine neatlogs trace if captured in audit logs
    let genuineTraceId: string | null = null;
    for (const log of logs) {
      if (log.details) {
        try {
          const parsed = JSON.parse(log.details);
          if (parsed.traceId && typeof parsed.traceId === 'string') {
            genuineTraceId = parsed.traceId;
            break;
          }
        } catch {
          const match = /traceId['":\s]+([a-fA-F0-9]{32})/.exec(log.details);
          if (match) {
            genuineTraceId = match[1];
            break;
          }
        }
      }
    }

    // Format neatlogs URL strictly if genuine 32-character hex traceId and valid HTTPS endpoint
    let traceUrl: string | null = null;
    if (genuineTraceId && /^[0-9a-f]{32}$/i.test(genuineTraceId)) {
      try {
        const ep = process.env.NEATLOGS_ENDPOINT || 'https://neatlogs.com';
        const parsedUrl = new URL(ep);
        if (parsedUrl.protocol === 'https:') {
          traceUrl = `${parsedUrl.origin}/app/traces/${genuineTraceId}`;
        }
      } catch {
        traceUrl = null;
      }
    }

    return {
      incident: {
        id: incident.id,
        orderId: incident.orderId,
        paymentReference: incident.paymentReference,
        customerId: incident.customerId,
        status: incident.status,
        reason: incident.reason,
        fencingToken: incident.fencingToken,
        leaseOwner: incident.leaseOwner,
        leaseExpiresAt: incident.leaseExpiresAt,
        isLeaseActive,
        retryCount: incident.retryCount,
        nextRetryAt: incident.nextRetryAt,
        lastDecision: incident.lastDecision,
        decisionSummary: incident.decisionSummary,
        errorDetail: incident.errorDetail,
        resolvedAt: incident.resolvedAt,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
      },
      order: {
        id: order.id,
        expectedAmount: order.expectedAmount,
        currency: order.currency,
        status: order.status,
        paymentReference: order.paymentReference,
        paidAt: order.paidAt,
        createdAt: order.createdAt,
      },
      customer: {
        id: customer.id,
        emailRedacted: redactEmail(customer.email),
        name: customer.name,
      },
      plan: {
        id: plan.id,
        name: plan.name,
        amount: plan.amount,
        currency: plan.currency,
        durationDays: plan.durationDays,
      },
      entitlement: ent
        ? {
            id: ent.id,
            status: ent.status,
            sourceReference: ent.sourceReference,
            startedAt: ent.startedAt,
            expiresAt: ent.expiresAt,
            isActive: isEntActive,
          }
        : null,
      paymentEvents: pEvents.map((e) => ({
        id: e.id,
        paymentReference: e.paymentReference,
        eventType: e.eventType,
        status: e.status,
        amount: e.amount,
        currency: e.currency,
        customerEmailRedacted: redactEmail(e.customerEmail),
        gatewayResponse: e.gatewayResponse,
        createdAt: e.createdAt,
      })),
      auditTrail: logs,
      evidenceDossier: {
        amountExpected,
        amountVerified,
        amountMatched,
        currencyExpected,
        currencyVerified,
        currencyMatched,
        customerExpected,
        customerVerified,
        customerMatched,
        paymentVerificationState,
        verificationProvenance,
        entitlementActive: isEntActive,
        gateAuthorized,
      },
      neatlogsTrace: {
        traceId: genuineTraceId,
        traceUrl,
        workflowName: process.env.NEATLOGS_WORKFLOW_NAME || 'aftermath-recovery',
      },
    };
  }
}

export const queryService = new QueryService();
