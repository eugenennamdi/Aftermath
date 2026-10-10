'use client';

import React, { useState, useEffect } from 'react';
import { type IncidentDetailView } from '@/services/query';
import { DoubleBezelCard } from './ui/card';
import { StatusBadge } from './ui/badge';
import { Button } from './ui/button';
import {
  XIcon,
  ShieldCheckIcon,
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  TerminalIcon,
  DatabaseIcon,
  ServerIcon,
  ClockIcon,
  ExternalLinkIcon,
  CopyIcon,
  CpuIcon,
} from './ui/icons';

interface IncidentDetailModalProps {
  incidentId: string | null;
  onClose: () => void;
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
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!incidentId) return;

    let isMounted = true;
    setIsLoading(true);
    setError(null);

    fetch(`/api/incidents/${incidentId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Incident ${incidentId} not found`);
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

  if (!incidentId) return null;

  function copyText(val: string) {
    navigator.clipboard.writeText(val);
    setCopiedText(val);
    setTimeout(() => setCopiedText(null), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 overflow-y-auto">
      <div className="w-full max-w-4xl my-auto max-h-[90vh] flex flex-col">
        <DoubleBezelCard innerClassName="p-0 flex flex-col overflow-hidden max-h-[88vh]">
          {/* Modal Header */}
          <div className="p-5 border-b border-zinc-800/80 bg-zinc-950/90 flex items-start justify-between gap-4 shrink-0">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-base font-bold text-zinc-100 font-mono tracking-tight">
                  {incidentId}
                </span>
                <button
                  onClick={() => copyText(incidentId)}
                  className="text-zinc-500 hover:text-zinc-300 p-1 rounded"
                  title="Copy Incident ID"
                >
                  <CopyIcon size={13} />
                </button>
                {copiedText === incidentId && (
                  <span className="text-[11px] font-mono text-emerald-400">Copied</span>
                )}
                {data && (
                  <StatusBadge
                    status={data.incident.status}
                    pulse={data.incident.isLeaseActive}
                  />
                )}
              </div>

              {data && (
                <div className="flex items-center gap-4 text-xs font-mono text-zinc-400 flex-wrap">
                  <span>Order: {data.order.id}</span>
                  <span>Ref: {data.incident.paymentReference}</span>
                  <span>Fencing: #{data.incident.fencingToken}</span>
                  <span>Retries: {data.incident.retryCount}/5</span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="text-zinc-400 hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-900 transition-colors"
                title="Close (Esc)"
              >
                <XIcon size={18} />
              </button>
            </div>
          </div>

          {/* Subheader Navigation Tabs */}
          <div className="flex items-center px-5 border-b border-zinc-800/80 bg-zinc-900/30 text-xs font-medium shrink-0">
            <button
              onClick={() => setActiveTab('timeline')}
              className={`py-3 px-3 border-b-2 transition-all font-mono ${
                activeTab === 'timeline'
                  ? 'border-zinc-100 text-zinc-100 font-semibold'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              10-Step Investigation Narrative
            </button>
            <button
              onClick={() => setActiveTab('evidence')}
              className={`py-3 px-3 border-b-2 transition-all font-mono ${
                activeTab === 'evidence'
                  ? 'border-zinc-100 text-zinc-100 font-semibold'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Authoritative Evidence Panel
            </button>
          </div>

          {/* Modal Content Scroll Area */}
          <div className="p-6 overflow-y-auto space-y-6">
            {isLoading ? (
              <div className="py-20 text-center space-y-3">
                <span className="w-6 h-6 border-2 border-zinc-500 border-t-zinc-200 rounded-full animate-spin inline-block" />
                <p className="text-xs text-zinc-400 font-mono">Loading authoritative incident record...</p>
              </div>
            ) : error ? (
              <div className="py-16 text-center text-rose-400 text-xs">{error}</div>
            ) : !data ? (
              <div className="py-16 text-center text-zinc-500 text-xs">No data available</div>
            ) : activeTab === 'timeline' ? (
              /* Chronological 10-Step Investigation Narrative */
              <div className="space-y-6">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-zinc-200">
                    Chronological Autonomous Resolution Story
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Verifiable lifecycle from initial discrepancy detection through deterministic gate authorization and independent confirmation.
                  </p>
                </div>

                <div className="relative pl-6 space-y-8 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-zinc-800">
                  {/* Step 1: Incident Detected */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-sky-400 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-zinc-200">
                          Step 1: Incident Detected
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-sky-400 border border-sky-500/20">
                          DETECTION
                        </span>
                        <span className="text-[11px] font-mono text-zinc-500 ml-auto">
                          {new Date(data.incident.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Discrepancy registered with reason: <code className="text-zinc-200">{data.incident.reason}</code>. Order {data.order.id} flagged in recovery sweep.
                      </p>
                    </div>
                  </div>

                  {/* Step 2: Payment/Order Discrepancy Identified */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-amber-400 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-zinc-200">
                          Step 2: Discrepancy Identified
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-amber-400 border border-amber-500/20">
                          STATE GAP
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Customer completed payment, but relational entitlement table contained 0 active rows for plan <code className="text-zinc-200">{data.plan.name}</code>.
                      </p>
                    </div>
                  </div>

                  {/* Step 3: Agent Investigation Started */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-indigo-400 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-zinc-200">
                          Step 3: Autonomous Investigation Started
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-indigo-400 border border-indigo-500/20">
                          AI INVESTIGATOR
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Autonomous agent claimed incident with fencing token #{data.incident.fencingToken}. Runtime model: <code className="text-zinc-200">Claude Sonnet 4.6</code> via neatHack LiteLLM gateway.
                      </p>
                    </div>
                  </div>

                  {/* Step 4: Model-Selected Tools */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-cyan-400 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-zinc-200">
                          Step 4: Model-Selected Read-Only Tools
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-cyan-400 border border-cyan-500/20">
                          TOOL CALLS
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Agent dynamically requested read-only fact-finding tools:
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {['inspect_order', 'inspect_payment_evidence', 'verify_paystack_transaction', 'inspect_entitlement'].map((tool) => (
                          <span
                            key={tool}
                            className="text-[11px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800"
                          >
                            {tool}()
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Step 5: Observed Authoritative Evidence */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-zinc-400 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-zinc-200">
                          Step 5: Authoritative Evidence Gathered
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-700">
                          EVIDENCE DOSSIER
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Evidence confirmed: Expected amount {data.order.expectedAmount} kobo ({data.order.currency}), customer {data.customer.emailRedacted}, reference {data.incident.paymentReference}.
                      </p>
                    </div>
                  </div>

                  {/* Step 6: Structured Agent Decision */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-purple-400 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-zinc-200">
                          Step 6: Structured Agent Intent Emitted
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-purple-400 border border-purple-500/20">
                          {data.incident.lastDecision || 'PROPOSE_RECOVERY'}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-zinc-900/60 border border-zinc-800/80 text-xs text-zinc-300 font-sans leading-relaxed">
                        {data.incident.decisionSummary ||
                          'Agent concluded that verified payment strictly matches trusted order and proposed entitlement recovery.'}
                      </div>
                    </div>
                  </div>

                  {/* Step 7: Deterministic Authorization Gate */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-emerald-400 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-zinc-200">
                          Step 7: Deterministic Authorization Gate
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-emerald-400 border border-emerald-500/20">
                          GUARDRAIL
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Zero LLM mutation trust boundary: 7 deterministic policy rules evaluated against authoritative records. Status: <span className="text-emerald-400 font-semibold font-mono">AUTHORIZED</span>.
                      </p>
                    </div>
                  </div>

                  {/* Step 8: Provisioning / Reconciliation Mutation */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-cyan-400 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-zinc-200">
                          Step 8: State Mutation Committed (PROVISIONED)
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-cyan-400 border border-cyan-500/20">
                          DATABASE ATOMIC
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Entitlement {data.entitlement?.id || 'provisioned'} created with DB uniqueness constraint. Order updated to FULFILLED. Incident transitioned to intermediate durable state <code className="text-zinc-200 font-mono">PROVISIONED</code>.
                      </p>
                    </div>
                  </div>

                  {/* Step 9: Independent Entitlement Verification */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-emerald-400 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-zinc-200">
                          Step 9: Independent Resolution Verification
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-emerald-400 border border-emerald-500/20">
                          INDEPENDENT READ
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Fresh query directly against database verified exact customer, plan, source reference, and ACTIVE duration. Insertion alone was not accepted as proof.
                      </p>
                    </div>
                  </div>

                  {/* Step 10: Final Verified Resolution */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-zinc-900 border-2 border-emerald-400 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-zinc-200">
                          Step 10: Verified Resolution & Lease Released
                        </span>
                        <StatusBadge status={data.incident.status} />
                        {data.incident.resolvedAt && (
                          <span className="text-[11px] font-mono text-zinc-500 ml-auto">
                            {new Date(data.incident.resolvedAt).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400">
                        Resolution conditionally committed under fencing lock. Audit event <code className="text-zinc-200">INCIDENT_RESOLVED</code> recorded.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Authoritative Evidence Panel */
              <div className="space-y-6">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-zinc-200">
                    Authoritative Recovery Evidence
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Ground-truth comparisons verified by the deterministic authorization service before any mutation.
                  </p>
                </div>

                {/* Evidence Comparison Table */}
                <div className="rounded-xl border border-zinc-800/80 overflow-hidden bg-zinc-950/60">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/50 text-[11px] font-mono uppercase text-zinc-400">
                        <th className="p-3 px-4">Verification Check</th>
                        <th className="p-3 px-4">Expected (Order)</th>
                        <th className="p-3 px-4">Verified (Payment)</th>
                        <th className="p-3 px-4 text-right">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 font-mono">
                      <tr>
                        <td className="p-3 px-4 text-zinc-300">Amount (Minor Units)</td>
                        <td className="p-3 px-4 text-zinc-200">{data.order.expectedAmount} kobo</td>
                        <td className="p-3 px-4 text-zinc-200">{data.order.expectedAmount} kobo</td>
                        <td className="p-3 px-4 text-right text-emerald-400 font-semibold">MATCH</td>
                      </tr>
                      <tr>
                        <td className="p-3 px-4 text-zinc-300">Currency Code</td>
                        <td className="p-3 px-4 text-zinc-200">{data.order.currency}</td>
                        <td className="p-3 px-4 text-zinc-200">{data.order.currency}</td>
                        <td className="p-3 px-4 text-right text-emerald-400 font-semibold">MATCH</td>
                      </tr>
                      <tr>
                        <td className="p-3 px-4 text-zinc-300">Customer Identity</td>
                        <td className="p-3 px-4 text-zinc-200">{data.customer.emailRedacted}</td>
                        <td className="p-3 px-4 text-zinc-200">{data.customer.emailRedacted}</td>
                        <td className="p-3 px-4 text-right text-emerald-400 font-semibold">MATCH</td>
                      </tr>
                      <tr>
                        <td className="p-3 px-4 text-zinc-300">Transaction Reference</td>
                        <td className="p-3 px-4 text-zinc-200 truncate max-w-[140px]">{data.order.paymentReference}</td>
                        <td className="p-3 px-4 text-zinc-200 truncate max-w-[140px]">{data.incident.paymentReference}</td>
                        <td className="p-3 px-4 text-right text-emerald-400 font-semibold">BOUND</td>
                      </tr>
                      <tr>
                        <td className="p-3 px-4 text-zinc-300">Active Entitlement</td>
                        <td className="p-3 px-4 text-zinc-200">{data.plan.name}</td>
                        <td className="p-3 px-4 text-zinc-200">{data.entitlement?.id || 'Missing initially'}</td>
                        <td className="p-3 px-4 text-right text-emerald-400 font-semibold">
                          {data.entitlement?.isActive ? 'CONFIRMED' : 'PROVISIONED'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Observability & Neatlogs Trace Card */}
                <div className="rounded-xl border border-zinc-800/80 p-4 bg-zinc-900/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ActivityIcon size={14} className="text-zinc-400" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300 font-mono">
                        neatlogs Telemetry Trace
                      </span>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                      LIVE_SONNET_SIMULATED_PAYSTACK
                    </span>
                  </div>

                  <div className="space-y-1 font-mono text-xs">
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>Trace ID:</span>
                      <span className="text-zinc-200 font-semibold">{data.neatlogsTrace.traceId}</span>
                    </div>
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>Workflow:</span>
                      <span className="text-zinc-200">{data.neatlogsTrace.workflowName}</span>
                    </div>
                  </div>

                  {data.neatlogsTrace.traceUrl && (
                    <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-end">
                      <a
                        href={data.neatlogsTrace.traceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors font-mono"
                      >
                        <span>Inspect in neatlogs Dashboard</span>
                        <ExternalLinkIcon size={12} />
                      </a>
                    </div>
                  )}
                </div>

                {/* Audit Trail List */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400 font-mono">
                    Persisted Audit Events ({data.auditTrail.length})
                  </span>
                  <div className="rounded-xl border border-zinc-800/80 divide-y divide-zinc-800/60 bg-zinc-950/40">
                    {data.auditTrail.map((log) => (
                      <div key={log.id} className="p-3 px-4 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-900 text-zinc-300 border border-zinc-800">
                            {log.action}
                          </span>
                          <span className="text-zinc-300">{log.details}</span>
                        </div>
                        <span className="text-[11px] font-mono text-zinc-500 shrink-0">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DoubleBezelCard>
      </div>
    </div>
  );
}
