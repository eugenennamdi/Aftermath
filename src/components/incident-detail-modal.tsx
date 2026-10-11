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
} from './ui/icons';

interface IncidentDetailModalProps {
  incidentId: string | null;
  onClose: () => void;
}

type TimelineStageStatus = 'COMPLETED' | 'IN_PROGRESS' | 'REJECTED' | 'PENDING' | 'BLOCKED';

interface TimelineStage {
  stepNumber: number;
  title: string;
  badgeLabel: string;
  status: TimelineStageStatus;
  timestamp?: string | null;
  description: string;
  callout?: React.ReactNode;
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

  // Derive truthful, evidence-based stages from authoritative DTO data
  function buildTruthfulTimeline(view: IncidentDetailView): TimelineStage[] {
    const { incident, order, entitlement, evidenceDossier } = view;
    const stages: TimelineStage[] = [];

    // Stage 1: Detection
    stages.push({
      stepNumber: 1,
      title: 'Incident Detected & Ingested',
      badgeLabel: 'DETECTION',
      status: 'COMPLETED',
      timestamp: incident.createdAt ? new Date(incident.createdAt).toLocaleTimeString() : null,
      description: `Discrepancy registered with reason: "${incident.reason}". Bound to trusted order ${order.id}.`,
    });

    // Stage 2: Worker Claim & Lease Fencing
    if (incident.leaseOwner) {
      stages.push({
        stepNumber: 2,
        title: 'Claimed by Recovery Worker',
        badgeLabel: 'WORKER LEASE',
        status: incident.status === 'INVESTIGATING' ? 'IN_PROGRESS' : 'COMPLETED',
        description: `Exclusive lease held by worker "${incident.leaseOwner}" under monotonic fencing token #${incident.fencingToken}.`,
      });
    } else if (incident.fencingToken > 0 || incident.status !== 'OPEN') {
      stages.push({
        stepNumber: 2,
        title: 'Fencing Token Assigned',
        badgeLabel: 'FENCING',
        status: 'COMPLETED',
        description: `Fencing token #${incident.fencingToken} assigned for distributed execution safety.`,
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
      stages.push({
        stepNumber: 3,
        title: `Investigator Decision: ${incident.lastDecision}`,
        badgeLabel: incident.lastDecision === 'ESCALATE' ? 'ESCALATE' : 'DECISION',
        status: incident.lastDecision === 'ESCALATE' ? 'REJECTED' : 'COMPLETED',
        description: 'Claude Sonnet 4.6 (LiteLLM) concluded evidence analysis and emitted structured intent.',
        callout: incident.decisionSummary ? (
          <div className="p-3 rounded-lg bg-muted/60 border border-border text-xs text-foreground/90 font-sans leading-relaxed">
            {incident.decisionSummary}
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
        title: 'Safety Violation Escalated',
        badgeLabel: 'ESCALATED',
        status: 'REJECTED',
        description: incident.errorDetail || 'Underpaid transaction or identity mismatch identified.',
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
    if (evidenceDossier.gateAuthorized) {
      stages.push({
        stepNumber: 4,
        title: 'Deterministic Gate: Authorized',
        badgeLabel: 'GATE PASSED',
        status: 'COMPLETED',
        description: 'Mathematical equality verified: amount, currency, and customer strictly matched trusted order.',
      });
    } else if (incident.status === 'ESCALATED') {
      stages.push({
        stepNumber: 4,
        title: 'Deterministic Gate: Rejected / Blocked',
        badgeLabel: 'GATE REJECTED',
        status: 'REJECTED',
        description: incident.errorDetail || 'Security invariants failed. Recovery strictly blocked by authorization gate.',
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

    // Stage 5: Entitlement Provisioning
    if (entitlement && entitlement.isActive) {
      stages.push({
        stepNumber: 5,
        title: 'Entitlement Active & Independently Confirmed',
        badgeLabel: 'ACTIVE',
        status: 'COMPLETED',
        description: `Entitlement ${entitlement.id} confirmed active in database. Fresh read independently verified.`,
      });
    } else if (entitlement) {
      stages.push({
        stepNumber: 5,
        title: 'Entitlement Created (Pending Activation)',
        badgeLabel: 'PROVISIONED',
        status: 'IN_PROGRESS',
        description: `Entitlement ${entitlement.id} created, awaiting independent query confirmation.`,
      });
    } else if (incident.status === 'ESCALATED') {
      stages.push({
        stepNumber: 5,
        title: 'Zero Entitlements Provisioned',
        badgeLabel: 'BLOCKED',
        status: 'BLOCKED',
        description: 'Relational safety guarantee: zero database records created in entitlements table.',
      });
    } else {
      stages.push({
        stepNumber: 5,
        title: 'Entitlement Provisioning: Pending',
        badgeLabel: 'PENDING',
        status: 'PENDING',
        description: 'No entitlement provisioned at this stage.',
      });
    }

    // Stage 6: Final Resolution State
    if (incident.status === 'RESOLVED') {
      stages.push({
        stepNumber: 6,
        title: 'Incident Resolved & Lease Released',
        badgeLabel: 'RESOLVED',
        status: 'COMPLETED',
        timestamp: incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleTimeString() : null,
        description: 'Recovery complete. State verified and worker lease cleanly released.',
      });
    } else if (incident.status === 'ESCALATED') {
      stages.push({
        stepNumber: 6,
        title: 'Incident Escalated for Human Review',
        badgeLabel: 'ESCALATED',
        status: 'REJECTED',
        description: 'Safety gate intervened. Awaiting manual operator inspection.',
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

  const timelineStages = data ? buildTruthfulTimeline(data) : [];

  return (
    <Dialog open={Boolean(incidentId)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 overflow-hidden flex flex-col" onClose={onClose}>
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

            <DialogClose className="shrink-0 -mt-0.5" />
          </div>
        </DialogHeader>

        {/* Tab Navigation */}
        <div
          role="tablist"
          aria-label="Incident dossier views"
          className="flex items-center px-5 border-b border-border bg-muted/30 text-xs font-medium shrink-0"
        >
          <button
            role="tab"
            aria-selected={activeTab === 'timeline'}
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-3 border-b-2 transition-all cursor-pointer ${
              activeTab === 'timeline'
                ? 'border-foreground text-foreground font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Authoritative Timeline
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'evidence'}
            onClick={() => setActiveTab('evidence')}
            className={`py-3 px-3 border-b-2 transition-all cursor-pointer ${
              activeTab === 'evidence'
                ? 'border-foreground text-foreground font-semibold'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Evidence & Verification Dossier
          </button>
        </div>

        {/* Content Scroll Area */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-card">
          {isLoading ? (
            <div className="py-20 text-center space-y-3">
              <span className="size-6 border-2 border-border border-t-primary rounded-full animate-spin inline-block" />
              <p className="text-xs text-muted-foreground">Loading authoritative incident record...</p>
            </div>
          ) : error ? (
            <div className="py-16 text-center text-rose-600 text-xs font-medium">{error}</div>
          ) : !data ? (
            <div className="py-16 text-center text-muted-foreground text-xs">No data available</div>
          ) : activeTab === 'timeline' ? (
            /* Truthful Timeline */
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
                  let badgeColor = 'bg-muted text-muted-foreground border-border';

                  if (st.status === 'COMPLETED') {
                    dotColor = 'border-emerald-600 bg-emerald-50';
                    badgeColor = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                  } else if (st.status === 'IN_PROGRESS') {
                    dotColor = 'border-amber-600 bg-amber-50';
                    badgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
                  } else if (st.status === 'REJECTED') {
                    dotColor = 'border-rose-600 bg-rose-50';
                    badgeColor = 'bg-rose-50 text-rose-700 border-rose-200';
                  } else if (st.status === 'BLOCKED') {
                    dotColor = 'border-border bg-muted';
                    badgeColor = 'bg-muted text-muted-foreground border-border';
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
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded border ${badgeColor}`}
                          >
                            {st.badgeLabel}
                          </span>
                          {st.timestamp && (
                            <span className="text-[11px] font-mono text-muted-foreground ml-auto tabular-nums">
                              {st.timestamp}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          {st.description}
                        </p>
                        {st.callout}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Persisted Audit Log Sub-Trail */}
              <div className="pt-4 border-t border-border space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-foreground">
                    Persisted Audit Event Trail ({data.auditTrail.length})
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono">Authoritative DB Records</span>
                </div>

                {data.auditTrail.length === 0 ? (
                  <div className="p-4 rounded-xl border border-border text-xs text-muted-foreground text-center">
                    No audit records registered yet for this incident.
                  </div>
                ) : (
                  <div className="rounded-xl border border-border divide-y divide-border/60 overflow-hidden bg-card">
                    {data.auditTrail.map((log) => (
                      <div key={log.id} className="p-3 px-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-muted text-foreground border border-border shrink-0">
                            {log.action}
                          </span>
                          <span className="text-foreground/90 truncate">{log.details || 'No details'}</span>
                        </div>
                        <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground shrink-0">
                          <span>{log.actor}</span>
                          <span className="tabular-nums">{new Date(log.createdAt).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Authoritative Evidence Panel */
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
                    <tr>
                      <td className="p-3 px-4 text-foreground/90">Amount (Minor Units)</td>
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
                    <tr>
                      <td className="p-3 px-4 text-foreground/90">Currency Code</td>
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
                    <tr>
                      <td className="p-3 px-4 text-foreground/90">Customer Identity</td>
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
                    <tr>
                      <td className="p-3 px-4 text-foreground/90">Transaction Reference</td>
                      <td className="p-3 px-4 font-mono text-foreground truncate max-w-[140px]">{data.order.paymentReference}</td>
                      <td className="p-3 px-4 font-mono text-foreground truncate max-w-[140px]">
                        {data.paymentEvents.length > 0
                          ? data.paymentEvents[0].paymentReference
                          : data.incident.paymentReference}
                      </td>
                      <td className="p-3 px-4 text-right">
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200">
                          {data.paymentEvents.length > 0 &&
                          data.paymentEvents[0].paymentReference === data.order.paymentReference
                            ? 'MATCH'
                            : 'BOUND'}
                        </span>
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 px-4 text-foreground/90">Active Entitlement</td>
                      <td className="p-3 px-4 text-foreground">{data.plan.name}</td>
                      <td className="p-3 px-4 font-mono text-foreground">{data.entitlement?.id || 'None'}</td>
                      <td className="p-3 px-4 text-right">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                            data.entitlement?.isActive
                              ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                              : data.entitlement
                              ? 'text-sky-700 bg-sky-50 border border-sky-200'
                              : 'text-amber-800 bg-amber-50 border border-amber-200'
                          }`}
                        >
                          {data.entitlement?.isActive
                            ? 'ACTIVE'
                            : data.entitlement
                            ? 'PROVISIONED'
                            : 'NOT PROVISIONED'}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Observability & Neatlogs Trace Card */}
              <div className="rounded-xl border border-border p-4 bg-muted/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ActivityIcon size={14} className="text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-foreground font-mono">
                      neatlogs Telemetry Trace
                    </span>
                  </div>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                      data.evidenceDossier.paymentVerificationState === 'PROVIDER_VERIFIED'
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : data.evidenceDossier.paymentVerificationState === 'WEBHOOK_OBSERVED'
                        ? 'bg-sky-50 text-sky-700 border border-sky-200'
                        : data.evidenceDossier.paymentVerificationState === 'SIMULATED_FIXTURE'
                        ? 'bg-purple-50 text-purple-700 border border-purple-200'
                        : data.evidenceDossier.paymentVerificationState === 'VERIFICATION_FAILED'
                        ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : 'bg-muted text-muted-foreground border border-border'
                    }`}
                  >
                    {data.evidenceDossier.paymentVerificationState}
                  </span>
                </div>

                <div className="space-y-1 font-mono text-xs">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Trace ID:</span>
                    <span className="text-foreground font-semibold">
                      {data.neatlogsTrace.traceId || 'None recorded (local/simulated)'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Workflow:</span>
                    <span className="text-foreground">{data.neatlogsTrace.workflowName}</span>
                  </div>
                </div>

                {data.neatlogsTrace.traceUrl ? (
                  <div className="pt-2 border-t border-border flex items-center justify-end">
                    <a
                      href={data.neatlogsTrace.traceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-mono font-medium"
                    >
                      <span>Inspect in neatlogs Dashboard</span>
                      <ExternalLinkIcon size={12} />
                    </a>
                  </div>
                ) : (
                  <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                    <span>Remote trace:</span>
                    <span>No remote ingest link captured</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
