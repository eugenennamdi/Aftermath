'use client';

import React, { useState, useEffect } from 'react';
import { type IncidentDetailView } from '@/services/query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from './ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { StatusBadge } from './ui/badge';
import {
  ShieldCheckIcon,
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  ExternalLinkIcon,
  CopyIcon,
  LockIcon,
  XIcon,
} from './ui/icons';
import {
  AuditLogEntryCard,
  FormattedInvestigationText,
  FormattedInline,
} from './ui/audit-formatters';

interface IncidentDetailModalProps {
  incidentId: string | null;
  onClose: () => void;
}

export type TimelineStageStatus = 'COMPLETED' | 'IN_PROGRESS' | 'REJECTED' | 'PENDING' | 'BLOCKED';

export interface TimelineStage {
  stepNumber: number;
  title: string;
  badgeLabel: string;
  status: TimelineStageStatus;
  timestamp?: string | null;
  description: string;
  callout?: React.ReactNode;
}

export function determineReferenceMatch(data: IncidentDetailView) {
  // Only genuine LIVE_HTTP provider verification qualifies as live gateway verification
  const isLiveProviderVerified = Boolean(
    data.evidenceDossier.paymentVerificationState === 'PROVIDER_VERIFIED' &&
      data.evidenceDossier.verificationProvenance === 'LIVE_HTTP'
  );

  // Extract verified payment reference strictly from live provider audit log if available
  let verifiedPaymentRef: string | null = null;
  if (isLiveProviderVerified && Array.isArray(data.auditTrail)) {
    const liveLog = data.auditTrail.find(
      (l) =>
        (l.action === 'PAYSTACK_VERIFIED' || l.action === 'PAYMENT_VERIFIED') &&
        l.actor === 'paystack_adapter' &&
        l.details
    );
    if (liveLog?.details) {
      try {
        const parsed = JSON.parse(liveLog.details);
        if (typeof parsed.reference === 'string' && parsed.reference.trim()) {
          verifiedPaymentRef = parsed.reference.trim();
        }
      } catch {
        // parse error ignored
      }
    }
  }

  // A live match occurs strictly when a live provider reference exists and equals the trusted order reference
  const isReferenceMatched = Boolean(
    isLiveProviderVerified &&
      verifiedPaymentRef &&
      verifiedPaymentRef === data.order.paymentReference
  );

  const isReferenceMismatch = Boolean(
    isLiveProviderVerified &&
      verifiedPaymentRef &&
      verifiedPaymentRef !== data.order.paymentReference
  );

  let displayStatus: 'MATCH' | 'MISMATCH' | 'LOCAL BINDING ONLY' | 'UNVERIFIED';
  if (isReferenceMatched) {
    displayStatus = 'MATCH';
  } else if (isReferenceMismatch) {
    displayStatus = 'MISMATCH';
  } else if (data.order.paymentReference || data.incident.paymentReference) {
    displayStatus = 'LOCAL BINDING ONLY';
  } else {
    displayStatus = 'UNVERIFIED';
  }

  return {
    hasProviderVerification: isLiveProviderVerified,
    verifiedPaymentRef,
    isReferenceMatched,
    displayStatus,
  };
}

// Derive truthful, evidence-based stages strictly from authoritative DTO data and audit logs
export function buildTruthfulTimeline(view: IncidentDetailView): TimelineStage[] {
    const { incident, order, entitlement, evidenceDossier, auditTrail } = view;
    const stages: TimelineStage[] = [];

    // Stage 1: Detection
    stages.push({
      stepNumber: 1,
      title: 'Incident Detected & Ingested',
      badgeLabel: 'DETECTION',
      status: 'COMPLETED',
      timestamp: incident.createdAt ? new Date(incident.createdAt).toLocaleTimeString() : null,
      description: `Discrepancy registered with reason: "${incident.reason}". Bound to local order ${order.id}.`,
    });

    // Stage 2: Worker Claim & Lease Fencing
    if (incident.leaseOwner) {
      stages.push({
        stepNumber: 2,
        title: 'Claimed by Recovery Worker',
        badgeLabel: 'WORKER LEASE',
        status: incident.status === 'INVESTIGATING' ? 'IN_PROGRESS' : 'COMPLETED',
        description: `Active lease held by worker "${incident.leaseOwner}" under fencing token #${incident.fencingToken}.`,
      });
    } else if (auditTrail.some((a) => a.action === 'INCIDENT_PROCESSING_STARTED')) {
      stages.push({
        stepNumber: 2,
        title: 'Fencing Token Assigned',
        badgeLabel: 'FENCING',
        status: 'COMPLETED',
        description: `Processed under fencing token #${incident.fencingToken}.`,
      });
    } else if (incident.fencingToken > 0) {
      stages.push({
        stepNumber: 2,
        title: 'Fencing Token Assigned',
        badgeLabel: 'FENCING',
        status: 'COMPLETED',
        description: `Fencing token #${incident.fencingToken} assigned.`,
      });
    } else {
      stages.push({
        stepNumber: 2,
        title: 'Awaiting Worker Claim',
        badgeLabel: 'QUEUED',
        status: 'PENDING',
        description: 'Incident is queued in database, awaiting worker lease acquisition.',
      });
    }

    // Stage 3: Autonomous Investigation & Intent
    if (incident.lastDecision) {
      // Inspect if provider evidence is actually recorded in audit logs
      const hasModelProof = auditTrail.some(
        (a) =>
          a.details &&
          (a.details.includes('claude-sonnet') ||
            a.details.includes('LiteLLM') ||
            a.details.includes('claude'))
      );
      const hasFixtureProof = auditTrail.some(
        (a) =>
          a.action === 'PAYSTACK_FIXTURE_VERIFIED' ||
          (a.details && a.details.includes('FIXTURE'))
      );

      let attributionText = 'Autonomous recovery engine evaluated gathered evidence and emitted structured intent.';
      if (hasModelProof) {
        attributionText = 'Autonomous agent (Claude Sonnet 4.6 / LiteLLM) analyzed gathered evidence and emitted structured intent.';
      } else if (hasFixtureProof) {
        attributionText = 'Controlled test fixture evaluated evidence rules and emitted structured intent.';
      }

      const isEscalateDecision = incident.lastDecision === 'ESCALATE';
      const isReconcileDecision = incident.lastDecision === 'RECONCILE_EXISTING';

      stages.push({
        stepNumber: 3,
        title: `Investigator Decision: ${incident.lastDecision}`,
        badgeLabel: isEscalateDecision ? 'ESCALATE' : isReconcileDecision ? 'RECONCILE' : 'DECISION',
        status: isEscalateDecision ? 'REJECTED' : 'COMPLETED',
        description: attributionText,
        callout: incident.decisionSummary ? (
          <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <ActivityIcon size={14} className="text-muted-foreground" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                  Investigation Evidence Synthesis
                </span>
              </div>
              <span
                className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${
                  incident.lastDecision === 'PROPOSE_RECOVERY'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : incident.lastDecision === 'ESCALATE'
                    ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : 'bg-muted text-foreground border-border'
                }`}
              >
                {incident.lastDecision}
              </span>
            </div>
            <FormattedInvestigationText text={incident.decisionSummary} />
          </div>
        ) : undefined,
      });
    } else if (incident.status === 'INVESTIGATING') {
      stages.push({
        stepNumber: 3,
        title: 'Autonomous Investigation in Progress',
        badgeLabel: 'IN PROGRESS',
        status: 'IN_PROGRESS',
        description: 'Worker is actively querying read-only Paystack and database tools. Final decision not yet recorded.',
      });
    } else if (incident.status === 'ESCALATED') {
      stages.push({
        stepNumber: 3,
        title: 'Escalation Recorded',
        badgeLabel: 'ESCALATED',
        status: 'REJECTED',
        description: incident.errorDetail || 'Escalation registered in database without recorded decision summary.',
        callout: incident.decisionSummary ? (
          <div className="p-3.5 rounded-xl bg-card border border-border shadow-xs space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <ActivityIcon size={14} className="text-muted-foreground" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
                  Escalation Evidence & Reasoning
                </span>
              </div>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200">
                ESCALATE
              </span>
            </div>
            <FormattedInvestigationText text={incident.decisionSummary} />
          </div>
        ) : undefined,
      });
    } else {
      stages.push({
        stepNumber: 3,
        title: 'Investigation Pending',
        badgeLabel: 'PENDING',
        status: 'PENDING',
        description: 'Investigation has not yet executed.',
      });
    }

    // Stage 4: Deterministic Authorization Gate
    const hasGateRejectAudit = auditTrail.some(
      (a) =>
        a.action === 'GATE_REJECTED' ||
        (a.details && a.details.includes('GATE REJECTED')) ||
        (a.details && a.details.includes('SECURITY AMOUNT MISMATCH'))
    );
    const hasMismatchReason =
      incident.reason === 'VERIFICATION_MISMATCH' ||
      /underpaid|mismatch|security/i.test(incident.errorDetail || '');

    if (evidenceDossier.gateAuthorized) {
      stages.push({
        stepNumber: 4,
        title: 'Deterministic Gate: Authorized',
        badgeLabel: 'GATE PASSED',
        status: 'COMPLETED',
        description: 'Mathematical equality verified: amount, currency, and customer strictly matched trusted order.',
      });
    } else if (hasGateRejectAudit || hasMismatchReason) {
      stages.push({
        stepNumber: 4,
        title: 'Deterministic Gate: Rejected',
        badgeLabel: 'GATE REJECTED',
        status: 'REJECTED',
        description: incident.errorDetail || 'Security invariants failed. Recovery strictly blocked by authorization gate.',
      });
    } else if (incident.status === 'ESCALATED') {
      const isRetryExhausted =
        incident.retryCount >= 5 ||
        /retry budget|budget exhausted|transient/i.test(incident.errorDetail || '');

      stages.push({
        stepNumber: 4,
        title: isRetryExhausted ? 'Deterministic Gate: Deferral / Retry Exhausted' : 'Deterministic Gate: Not Evaluated',
        badgeLabel: 'BLOCKED',
        status: 'BLOCKED',
        description: isRetryExhausted
          ? 'Incident escalated due to retry exhaustion or upstream timeout. Deterministic gate evaluation was not reached.'
          : 'Escalated before deterministic authorization gate evaluation.',
      });
    } else if (incident.status === 'INVESTIGATING') {
      stages.push({
        stepNumber: 4,
        title: 'Deterministic Gate: Awaiting Evaluation',
        badgeLabel: 'GATE PENDING',
        status: 'PENDING',
        description: 'Gate evaluation blocked until agent investigation outputs a verified proposal.',
      });
    } else {
      stages.push({
        stepNumber: 4,
        title: 'Deterministic Gate: Not Reached',
        badgeLabel: 'PENDING',
        status: 'PENDING',
        description: 'Awaiting prior investigation stages before evaluation.',
      });
    }

    // Stage 5: Entitlement Provisioning vs Pre-existing Reconciliation
    const isReconcileDecision = incident.lastDecision === 'RECONCILE_EXISTING';
    const hasIndependentAudit = auditTrail.some(
      (a) =>
        a.action === 'ENTITLEMENT_VERIFIED' ||
        a.action === 'INDEPENDENT_VERIFICATION_SUCCEEDED' ||
        (a.details && (a.details.includes('independently confirmed') || a.details.includes('fresh read')))
    );

    if (isReconcileDecision && entitlement && entitlement.isActive) {
      stages.push({
        stepNumber: 5,
        title: 'Pre-existing Entitlement Observed & Reconciled',
        badgeLabel: 'RECONCILED',
        status: 'COMPLETED',
        description: `Active entitlement ${entitlement.id} confirmed in database. Access was granted prior; no duplicate mutation required.`,
      });
    } else if (entitlement && entitlement.isActive) {
      stages.push({
        stepNumber: 5,
        title: hasIndependentAudit
          ? 'Entitlement Active & Independently Confirmed'
          : 'Active Entitlement Record Observed',
        badgeLabel: 'ACTIVE',
        status: 'COMPLETED',
        description: hasIndependentAudit
          ? `Entitlement ${entitlement.id} confirmed active via independent database read.`
          : `Entitlement ${entitlement.id} is active in database (independent confirmation query not recorded in audit trail).`,
      });
    } else if (entitlement) {
      stages.push({
        stepNumber: 5,
        title: 'Entitlement Created (Pending Activation)',
        badgeLabel: 'PROVISIONED',
        status: 'IN_PROGRESS',
        description: `Entitlement ${entitlement.id} created, awaiting independent activation confirmation.`,
      });
    } else if (incident.status === 'ESCALATED') {
      stages.push({
        stepNumber: 5,
        title: 'No Entitlement in Dossier',
        badgeLabel: 'NOT RETURNED',
        status: 'BLOCKED',
        description: 'No entitlement returned in incident dossier.',
      });
    } else {
      stages.push({
        stepNumber: 5,
        title: 'Entitlement Provisioning: Pending',
        badgeLabel: 'PENDING',
        status: 'PENDING',
        description: 'Awaiting investigation decision and deterministic authorization.',
      });
    }

    // Stage 6: Final Resolution State
    const isLeaseReleased = incident.leaseOwner === null;

    if (incident.status === 'RESOLVED') {
      if (isReconcileDecision) {
        stages.push({
          stepNumber: 6,
          title: isLeaseReleased
            ? 'Incident Resolved via Reconciliation'
            : `Incident Resolved (Lease: ${incident.leaseOwner})`,
          badgeLabel: 'RECONCILED',
          status: 'COMPLETED',
          timestamp: incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleTimeString() : null,
          description: isLeaseReleased
            ? 'Reconciliation complete. Existing access confirmed and worker lease cleanly released.'
            : 'Reconciliation complete and verified.',
        });
      } else {
        stages.push({
          stepNumber: 6,
          title: isLeaseReleased
            ? 'Incident Resolved & Lease Released'
            : `Incident Resolved (Lease: ${incident.leaseOwner})`,
          badgeLabel: 'RESOLVED',
          status: 'COMPLETED',
          timestamp: incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleTimeString() : null,
          description: isLeaseReleased
            ? 'Recovery complete. State verified and worker lease cleanly released.'
            : 'Recovery complete and verified.',
        });
      }
    } else if (incident.status === 'ESCALATED') {
      stages.push({
        stepNumber: 6,
        title: 'Incident Escalated for Human Review',
        badgeLabel: 'ESCALATED',
        status: 'REJECTED',
        description: 'Safety gate intervened or retry budget exhausted. Awaiting operator inspection.',
      });
    } else if (incident.status === 'PROVISIONED') {
      stages.push({
        stepNumber: 6,
        title: 'State: Provisioned',
        badgeLabel: 'PROVISIONED',
        status: 'IN_PROGRESS',
        description: 'State transition committed; awaiting final independent verification sweep.',
      });
    } else if (incident.status === 'INVESTIGATING') {
      stages.push({
        stepNumber: 6,
        title: 'State: Actively Investigating',
        badgeLabel: 'INVESTIGATING',
        status: 'IN_PROGRESS',
        description: 'Active investigation underway. Final resolution pending.',
      });
    } else {
      stages.push({
        stepNumber: 6,
        title: 'State: Open',
        badgeLabel: 'OPEN',
        status: 'PENDING',
        description: 'Queued for reconciliation sweep or worker claim.',
      });
    }

    return stages;
}

export function IncidentDetailModal({
  incidentId,
  onClose,
}: IncidentDetailModalProps) {
  const [data, setData] = useState<IncidentDetailView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'timeline' | 'evidence'>('timeline');
  const [copiedText, setCopiedText] = useState<string | null>(null);

  useEffect(() => {
    if (!incidentId) {
      setData(null);
      setError(null);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetch(`/api/incidents/${incidentId}`)
      .then(async (res) => {
        if (res.status === 401) {
          throw new Error('Operator authentication required to view incident dossier.');
        }
        if (!res.ok) {
          throw new Error(`Incident ${incidentId} not found`);
        }
        return res.json();
      })
      .then((json) => {
        if (isMounted) setData(json);
      })
      .catch((err) => {
        if (isMounted) setError((err as Error).message);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [incidentId]);

  function copyText(val: string) {
    navigator.clipboard.writeText(val);
    setCopiedText(val);
    setTimeout(() => setCopiedText(null), 2000);
  }

  const timelineStages = data ? buildTruthfulTimeline(data) : [];

  // Determine transaction reference verification state
  const refState = data
    ? determineReferenceMatch(data)
    : {
        hasProviderVerification: false,
        verifiedPaymentRef: null,
        isReferenceMatched: false,
        displayStatus: 'UNVERIFIED' as const,
      };

  return (
    <Dialog open={Boolean(incidentId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] p-0 overflow-hidden flex flex-col" showCloseButton={false}>
        {/* Header */}
        <DialogHeader className="p-5 border-b border-border bg-card shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5 min-w-0 pr-1">
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle className="text-sm sm:text-base font-bold font-mono tracking-tight text-foreground truncate max-w-[210px] sm:max-w-none">
                  {incidentId}
                </DialogTitle>
                {incidentId && (
                  <button
                    onClick={() => copyText(incidentId)}
                    className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors cursor-pointer shrink-0"
                    title="Copy Incident ID"
                    aria-label="Copy Incident ID"
                  >
                    <CopyIcon size={13} />
                  </button>
                )}
                {copiedText === incidentId && (
                  <span className="text-[11px] font-mono text-emerald-600 font-medium shrink-0">Copied</span>
                )}
                {data && (
                  <StatusBadge
                    status={data.incident.status}
                    pulse={data.incident.isLeaseActive}
                  />
                )}
              </div>

              {data && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap pt-0.5">
                  <span className="bg-muted px-2 py-0.5 rounded border border-border text-foreground font-mono">
                    Order: {data.order.id}
                  </span>
                  <span className="bg-muted px-2 py-0.5 rounded border border-border font-mono">
                    Ref: {data.incident.paymentReference}
                  </span>
                  <span className="bg-muted px-2 py-0.5 rounded border border-border font-mono">
                    Fencing: #{data.incident.fencingToken}
                  </span>
                  <span className="bg-muted px-2 py-0.5 rounded border border-border font-mono">
                    Retries: {data.incident.retryCount}/5
                  </span>
                </div>
              )}
            </div>

            <DialogClose asChild>
              <button
                type="button"
                className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer shrink-0 -mt-0.5"
                aria-label="Close dialog"
              >
                <XIcon size={16} />
              </button>
            </DialogClose>
          </div>
        </DialogHeader>

        {/* Tab Navigation using accessible Radix Tabs primitive */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as 'timeline' | 'evidence')}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="px-5 border-b border-border bg-muted/20 shrink-0">
            <TabsList variant="line" className="h-11">
              <TabsTrigger
                value="timeline"
                onClick={() => setActiveTab('timeline')}
                className="text-xs"
              >
                Authoritative Timeline
              </TabsTrigger>
              <TabsTrigger
                value="evidence"
                onClick={() => setActiveTab('evidence')}
                className="text-xs"
              >
                Evidence & Verification Dossier
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Timeline Tab Content */}
          <TabsContent value="timeline" className="p-6 overflow-y-auto space-y-6 flex-1 m-0">
            {isLoading ? (
              <div className="py-20 text-center space-y-3">
                <span className="size-6 border-2 border-border border-t-primary rounded-full animate-spin inline-block" />
                <p className="text-xs text-muted-foreground">Loading authoritative incident record...</p>
              </div>
            ) : error ? (
              <div className="py-16 text-center text-rose-600 text-xs font-medium">{error}</div>
            ) : !data ? (
              <div className="py-16 text-center text-muted-foreground text-xs">No data available</div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">
                    Actual Incident Progression
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Each milestone reflects verified database and telemetry records. Future or unexecuted stages are marked pending.
                  </p>
                </div>

                <div className="relative pl-6 space-y-7 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
                  {timelineStages.map((st) => {
                    let dotColor = 'border-border bg-card';

                    if (st.status === 'COMPLETED') {
                      dotColor = 'border-emerald-600 bg-emerald-50';
                    } else if (st.status === 'IN_PROGRESS') {
                      dotColor = 'border-amber-600 bg-amber-50';
                    } else if (st.status === 'REJECTED') {
                      dotColor = 'border-rose-600 bg-rose-50';
                    } else if (st.status === 'BLOCKED') {
                      dotColor = 'border-border bg-muted';
                    }

                    return (
                      <div key={st.stepNumber} className="relative">
                        <div
                          className={`absolute -left-[27px] top-0.5 size-4 rounded-full border-2 ${dotColor} flex items-center justify-center`}
                        />
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-foreground">
                              Step {st.stepNumber}: {st.title}
                            </span>
                            {st.timestamp && (
                              <span className="text-[11px] font-mono text-muted-foreground ml-auto tabular-nums">
                                {st.timestamp}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            <FormattedInline text={st.description} />
                          </p>
                          {st.callout}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Audit Trail Section */}
                <div className="pt-4 border-t border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold text-foreground">
                      Persisted Audit Event Trail ({data.auditTrail.length})
                    </h4>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      Authoritative DB Records
                    </span>
                  </div>

                  {data.auditTrail.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No audit entries recorded for this incident.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {data.auditTrail.map((ev) => (
                        <AuditLogEntryCard
                          key={ev.id}
                          log={{
                            ...ev,
                            incidentId: data.incident.id,
                            orderId: data.order.id,
                          }}
                          compact
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Evidence Dossier Tab Content */}
          <TabsContent value="evidence" className="p-6 overflow-y-auto space-y-6 flex-1 m-0">
            {isLoading ? (
              <div className="py-20 text-center space-y-3">
                <span className="size-6 border-2 border-border border-t-primary rounded-full animate-spin inline-block" />
                <p className="text-xs text-muted-foreground">Loading evidence verification dossier...</p>
              </div>
            ) : error ? (
              <div className="py-16 text-center text-rose-600 text-xs font-medium">{error}</div>
            ) : !data ? (
              <div className="py-16 text-center text-muted-foreground text-xs">No data available</div>
            ) : (
              <div className="space-y-6">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-foreground">
                    Authoritative Recovery Evidence
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Ground-truth comparisons verified by the deterministic authorization service before any state mutation.
                  </p>
                </div>

                {/* Evidence Comparison Table */}
                <div className="rounded-xl border border-border overflow-hidden bg-card shadow-xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-[11px] font-medium text-muted-foreground">
                        <th className="p-3 px-4">Verification Check</th>
                        <th className="p-3 px-4">Expected (Order)</th>
                        <th className="p-3 px-4">Verified (Payment)</th>
                        <th className="p-3 px-4 text-right">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {/* Amount Check */}
                      <tr>
                        <td className="p-3 px-4 text-foreground/90 font-medium">Amount (Minor Units)</td>
                        <td className="p-3 px-4 font-mono tabular-nums text-foreground">{data.evidenceDossier.amountExpected.toLocaleString()} kobo</td>
                        <td className="p-3 px-4 font-mono tabular-nums text-foreground">
                          {data.evidenceDossier.amountVerified !== null
                            ? `${data.evidenceDossier.amountVerified.toLocaleString()} kobo`
                            : 'Pending / Unverified'}
                        </td>
                        <td className="p-3 px-4 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                              data.evidenceDossier.amountMatched === 'VERIFIED'
                                ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                : data.evidenceDossier.amountMatched === 'MISMATCH'
                                ? 'text-rose-700 bg-rose-50 border border-rose-200'
                                : 'text-muted-foreground bg-muted border border-border'
                            }`}
                          >
                            {data.evidenceDossier.amountMatched === 'VERIFIED'
                              ? 'MATCH'
                              : data.evidenceDossier.amountMatched === 'MISMATCH'
                              ? 'MISMATCH'
                              : 'UNRECORDED'}
                          </span>
                        </td>
                      </tr>

                      {/* Currency Check */}
                      <tr>
                        <td className="p-3 px-4 text-foreground/90 font-medium">Currency Code</td>
                        <td className="p-3 px-4 font-mono text-foreground">{data.evidenceDossier.currencyExpected}</td>
                        <td className="p-3 px-4 font-mono text-foreground">
                          {data.evidenceDossier.currencyVerified || 'Pending / Unverified'}
                        </td>
                        <td className="p-3 px-4 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                              data.evidenceDossier.currencyMatched === 'VERIFIED'
                                ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                : data.evidenceDossier.currencyMatched === 'MISMATCH'
                                ? 'text-rose-700 bg-rose-50 border border-rose-200'
                                : 'text-muted-foreground bg-muted border border-border'
                            }`}
                          >
                            {data.evidenceDossier.currencyMatched === 'VERIFIED'
                              ? 'MATCH'
                              : data.evidenceDossier.currencyMatched === 'MISMATCH'
                              ? 'MISMATCH'
                              : 'UNRECORDED'}
                          </span>
                        </td>
                      </tr>

                      {/* Customer Identity Check */}
                      <tr>
                        <td className="p-3 px-4 text-foreground/90 font-medium">Customer Identity</td>
                        <td className="p-3 px-4 font-mono text-foreground">{data.evidenceDossier.customerExpected}</td>
                        <td className="p-3 px-4 font-mono text-foreground">
                          {data.evidenceDossier.customerVerified || 'Pending / Unverified'}
                        </td>
                        <td className="p-3 px-4 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                              data.evidenceDossier.customerMatched === 'VERIFIED'
                                ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                : data.evidenceDossier.customerMatched === 'MISMATCH'
                                ? 'text-rose-700 bg-rose-50 border border-rose-200'
                                : 'text-muted-foreground bg-muted border border-border'
                            }`}
                          >
                            {data.evidenceDossier.customerMatched === 'VERIFIED'
                              ? 'MATCH'
                              : data.evidenceDossier.customerMatched === 'MISMATCH'
                              ? 'MISMATCH'
                              : 'UNRECORDED'}
                          </span>
                        </td>
                      </tr>

                      {/* Transaction Reference Check - Distinguish Live Match from Local Binding */}
                      <tr>
                        <td className="p-3 px-4 text-foreground/90 font-medium">Transaction Reference</td>
                        <td className="p-3 px-4 font-mono text-foreground truncate max-w-[140px]">{data.order.paymentReference}</td>
                        <td className="p-3 px-4 font-mono text-foreground truncate max-w-[140px]">
                          {refState.verifiedPaymentRef || 'Not verified via gateway'}
                        </td>
                        <td className="p-3 px-4 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                              refState.isReferenceMatched
                                ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                : refState.verifiedPaymentRef
                                ? 'text-foreground/80 bg-muted border border-border'
                                : 'text-muted-foreground bg-muted border border-border'
                            }`}
                          >
                            {refState.displayStatus}
                          </span>
                        </td>
                      </tr>

                      {/* Active Entitlement Record */}
                      <tr>
                        <td className="p-3 px-4 text-foreground/90 font-medium">Active Entitlement</td>
                        <td className="p-3 px-4 font-mono text-foreground">{data.plan?.name || 'Configured Plan'}</td>
                        <td className="p-3 px-4 font-mono text-foreground">
                          {data.entitlement ? data.entitlement.id : 'No entitlement returned in dossier'}
                        </td>
                        <td className="p-3 px-4 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                              data.entitlement && data.entitlement.isActive
                                ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                : 'text-muted-foreground bg-muted border border-border'
                            }`}
                          >
                            {data.entitlement && data.entitlement.isActive
                              ? 'ACTIVE'
                              : 'ABSENT'}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Explanatory Callouts for Conflicting or Insufficient Evidence */}
                {data.evidenceDossier.customerMatched === 'MISMATCH' && (
                  <div className="p-3.5 rounded-lg bg-amber-50/70 border border-amber-200/80 text-amber-900 text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-amber-800">
                      <AlertTriangleIcon size={14} className="text-amber-600 shrink-0" />
                      <span>Identity Evidence Note</span>
                    </div>
                    <p className="leading-relaxed text-[11px] text-amber-800/90">
                      {data.evidenceDossier.customerExpected === data.evidenceDossier.customerVerified
                        ? 'Expected and verified identity strings match after redaction, but underlying audit comparison evaluated to MISMATCH. In simulated test fixtures, this reflects audit-level email redaction prior to equality evaluation. In production, operator review is required.'
                        : 'Recorded verification identity does not match local customer record. In accordance with invariant safety rules, recovery requires exact equality between payer email and local order record.'}
                    </p>
                  </div>
                )}

                {!refState.hasProviderVerification && (
                  <div className="p-3.5 rounded-lg bg-muted/50 border border-border text-muted-foreground text-xs space-y-1">
                    <div className="flex items-center gap-1.5 font-semibold text-foreground">
                      <ClockIcon size={14} className="text-muted-foreground shrink-0" />
                      <span>Gateway Verification Pending</span>
                    </div>
                    <p className="leading-relaxed text-[11px]">
                      Independent Paystack HTTP transaction verification has not yet been completed for this reference. Local order binding is established.
                    </p>
                  </div>
                )}

                {/* neatlogs Telemetry Trace Card */}
                <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2 text-xs font-mono">
                  <div className="flex items-center justify-between pb-1.5 border-b border-border">
                    <div className="flex items-center gap-2">
                      <ActivityIcon size={14} className="text-muted-foreground" />
                      <span className="font-semibold text-foreground text-[11px] uppercase tracking-wider">
                        neatlogs Telemetry Trace
                      </span>
                    </div>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border font-medium">
                      {data.evidenceDossier.paymentVerificationState}
                    </span>
                  </div>

                  <div className="space-y-1 text-muted-foreground pt-1">
                    <div className="flex justify-between">
                      <span>Trace ID:</span>
                      <span className="text-foreground">
                        {data.neatlogsTrace.traceId || 'None recorded (local/simulated)'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Workflow:</span>
                      <span className="text-foreground">{data.neatlogsTrace.workflowName}</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">Remote trace:</span>
                    {data.neatlogsTrace.traceUrl ? (
                      <a
                        href={data.neatlogsTrace.traceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:text-foreground flex items-center gap-1 font-medium transition-colors cursor-pointer"
                      >
                        <span>View in neatlogs</span>
                        <ExternalLinkIcon size={11} />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">No remote ingest link captured</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
