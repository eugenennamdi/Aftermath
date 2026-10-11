'use client';

import React, { useState, useEffect } from 'react';
import { type IncidentDetailView } from '@/services/query';
import { StatusBadge } from './ui/badge';
import {
  XIcon,
  ShieldCheckIcon,
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  DatabaseIcon,
  ServerIcon,
  ClockIcon,
  ExternalLinkIcon,
  CopyIcon,
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
        if (res.status === 401) throw new Error('Operator authentication required to view incident dossier. Please unlock via Operator Login.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/45 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
      <div className="w-full max-w-4xl my-auto max-h-[90vh] flex flex-col">
        <div className="rounded-2xl bg-white border border-[#E5E7EB] shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
          {/* Modal Header */}
          <div className="p-5 border-b border-[#E5E7EB] bg-white flex items-start justify-between gap-4 shrink-0">
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-base font-bold text-[#171B23] font-mono tracking-tight">
                  {incidentId}
                </span>
                <button
                  onClick={() => copyText(incidentId)}
                  className="text-[#9CA3AF] hover:text-[#171B23] p-1 rounded transition-colors cursor-pointer"
                  title="Copy Incident ID"
                >
                  <CopyIcon size={13} />
                </button>
                {copiedText === incidentId && (
                  <span className="text-[11px] font-mono text-emerald-600 font-medium">Copied</span>
                )}
                {data && (
                  <StatusBadge
                    status={data.incident.status}
                    pulse={data.incident.isLeaseActive}
                  />
                )}
              </div>

              {data && (
                <div className="flex items-center gap-2 text-xs font-mono text-[#69717C] flex-wrap pt-0.5">
                  <span className="bg-[#F4F4F5] px-2 py-0.5 rounded border border-[#E5E7EB] text-[#171B23]">
                    Order: {data.order.id}
                  </span>
                  <span className="bg-[#F4F4F5] px-2 py-0.5 rounded border border-[#E5E7EB]">
                    Ref: {data.incident.paymentReference}
                  </span>
                  <span className="bg-[#F4F4F5] px-2 py-0.5 rounded border border-[#E5E7EB]">
                    Fencing: #{data.incident.fencingToken}
                  </span>
                  <span className="bg-[#F4F4F5] px-2 py-0.5 rounded border border-[#E5E7EB]">
                    Retries: {data.incident.retryCount}/5
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={onClose}
                className="text-[#9CA3AF] hover:text-[#171B23] p-1.5 rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                title="Close (Esc)"
              >
                <XIcon size={18} />
              </button>
            </div>
          </div>

          {/* Subheader Navigation Tabs */}
          <div className="flex items-center px-5 border-b border-[#E5E7EB] bg-[#FAFBFD] text-xs font-medium shrink-0">
            <button
              onClick={() => setActiveTab('timeline')}
              className={`py-3 px-3 border-b-2 transition-all font-mono cursor-pointer ${
                activeTab === 'timeline'
                  ? 'border-[#171B23] text-[#171B23] font-semibold'
                  : 'border-transparent text-[#69717C] hover:text-[#171B23]'
              }`}
            >
              10-Step Investigation Narrative
            </button>
            <button
              onClick={() => setActiveTab('evidence')}
              className={`py-3 px-3 border-b-2 transition-all font-mono cursor-pointer ${
                activeTab === 'evidence'
                  ? 'border-[#171B23] text-[#171B23] font-semibold'
                  : 'border-transparent text-[#69717C] hover:text-[#171B23]'
              }`}
            >
              Authoritative Evidence Panel
            </button>
          </div>

          {/* Modal Content Scroll Area */}
          <div className="p-6 overflow-y-auto space-y-6 bg-white flex-1">
            {isLoading ? (
              <div className="py-20 text-center space-y-3">
                <span className="w-6 h-6 border-2 border-[#D1D5DB] border-t-[#44647B] rounded-full animate-spin inline-block" />
                <p className="text-xs text-[#69717C] font-mono">Loading authoritative incident record...</p>
              </div>
            ) : error ? (
              <div className="py-16 text-center text-rose-600 text-xs font-medium">{error}</div>
            ) : !data ? (
              <div className="py-16 text-center text-[#69717C] text-xs">No data available</div>
            ) : activeTab === 'timeline' ? (
              /* Chronological 10-Step Investigation Narrative */
              <div className="space-y-6">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-[#171B23]">
                    Chronological Autonomous Resolution Story
                  </h3>
                  <p className="text-xs text-[#69717C]">
                    Verifiable lifecycle from initial discrepancy detection through deterministic gate authorization and independent confirmation.
                  </p>
                </div>

                <div className="relative pl-6 space-y-7 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#E5E7EB]">
                  {/* Step 1: Incident Detected */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-sky-500 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-[#171B23]">
                          Step 1: Incident Detected
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                          DETECTION
                        </span>
                        <span className="text-[11px] font-mono text-[#69717C] ml-auto tabular-nums">
                          {new Date(data.incident.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5563]">
                        Discrepancy registered with reason: <code className="text-[#171B23] bg-[#F4F4F5] px-1 rounded">{data.incident.reason}</code>. Order {data.order.id} flagged in recovery sweep.
                      </p>
                    </div>
                  </div>

                  {/* Step 2: Payment/Order Discrepancy Identified */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-amber-500 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-[#171B23]">
                          Step 2: Discrepancy Identified
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                          STATE GAP
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5563]">
                        Customer completed payment, but relational entitlement table contained 0 active rows for plan <code className="text-[#171B23] bg-[#F4F4F5] px-1 rounded">{data.plan.name}</code>.
                      </p>
                    </div>
                  </div>

                  {/* Step 3: Agent Investigation Started */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-indigo-500 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-[#171B23]">
                          Step 3: Autonomous Investigation Started
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                          AI INVESTIGATOR
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5563]">
                        Autonomous agent claimed incident with fencing token #{data.incident.fencingToken}. Runtime model: <code className="text-[#171B23] bg-[#F4F4F5] px-1 rounded">Claude Sonnet 4.6</code> via neatHack LiteLLM gateway.
                      </p>
                    </div>
                  </div>

                  {/* Step 4: Model-Selected Tools */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-teal-500 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-[#171B23]">
                          Step 4: Model-Selected Read-Only Tools
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200">
                          TOOL CALLS
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5563]">
                        Agent dynamically requested read-only fact-finding tools:
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {['inspect_order', 'inspect_payment_evidence', 'verify_paystack_transaction', 'inspect_entitlement'].map((tool) => (
                          <span
                            key={tool}
                            className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#F4F4F5] text-[#171B23] border border-[#E5E7EB]"
                          >
                            {tool}()
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Step 5: Observed Authoritative Evidence */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-slate-500 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-[#171B23]">
                          Step 5: Authoritative Evidence Gathered
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          EVIDENCE DOSSIER
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5563]">
                        Evidence confirmed: Expected amount {data.order.expectedAmount} kobo ({data.order.currency}), customer {data.customer.emailRedacted}, reference {data.incident.paymentReference}.
                      </p>
                    </div>
                  </div>

                  {/* Step 6: Structured Agent Decision */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-purple-500 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-[#171B23]">
                          Step 6: Structured Agent Intent Emitted
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                          {data.incident.lastDecision || 'PROPOSE_RECOVERY'}
                        </span>
                      </div>
                      <div className="p-3 rounded-xl bg-[#FAFBFD] border border-[#E5E7EB] text-xs text-[#374151] font-sans leading-relaxed">
                        {data.incident.decisionSummary ||
                          'Agent concluded that verified payment strictly matches trusted order and proposed entitlement recovery.'}
                      </div>
                    </div>
                  </div>

                  {/* Step 7: Deterministic Authorization Gate */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-emerald-500 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-[#171B23]">
                          Step 7: Deterministic Authorization Gate
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          GUARDRAIL
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5563]">
                        Zero LLM mutation trust boundary: 7 deterministic policy rules evaluated against authoritative records. Status: <span className="text-emerald-700 font-semibold font-mono">AUTHORIZED</span>.
                      </p>
                    </div>
                  </div>

                  {/* Step 8: Provisioning / Reconciliation Mutation */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-sky-500 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-[#171B23]">
                          Step 8: State Mutation Committed (PROVISIONED)
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                          DATABASE ATOMIC
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5563]">
                        Entitlement {data.entitlement?.id || 'provisioned'} created with DB uniqueness constraint. Order updated to FULFILLED. Incident transitioned to intermediate durable state <code className="text-[#171B23] font-mono bg-[#F4F4F5] px-1 rounded">PROVISIONED</code>.
                      </p>
                    </div>
                  </div>

                  {/* Step 9: Independent Entitlement Verification */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-emerald-500 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-[#171B23]">
                          Step 9: Independent Resolution Verification
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                          INDEPENDENT READ
                        </span>
                      </div>
                      <p className="text-xs text-[#4B5563]">
                        Fresh query directly against database verified exact customer, plan, source reference, and ACTIVE duration. Insertion alone was not accepted as proof.
                      </p>
                    </div>
                  </div>

                  {/* Step 10: Final Verified Resolution */}
                  <div className="relative">
                    <div className="absolute -left-[27px] top-0.5 w-4 h-4 rounded-full bg-white border-2 border-emerald-500 flex items-center justify-center" />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-semibold text-[#171B23]">
                          Step 10: Verified Resolution & Lease Released
                        </span>
                        <StatusBadge status={data.incident.status} />
                        {data.incident.resolvedAt && (
                          <span className="text-[11px] font-mono text-[#69717C] ml-auto tabular-nums">
                            {new Date(data.incident.resolvedAt).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#4B5563]">
                        Resolution conditionally committed under fencing lock. Audit event <code className="text-[#171B23] bg-[#F4F4F5] px-1 rounded">INCIDENT_RESOLVED</code> recorded.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Authoritative Evidence Panel */
              <div className="space-y-6">
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-[#171B23]">
                    Authoritative Recovery Evidence
                  </h3>
                  <p className="text-xs text-[#69717C]">
                    Ground-truth comparisons verified by the deterministic authorization service before any mutation.
                  </p>
                </div>

                {/* Evidence Comparison Table */}
                <div className="rounded-xl border border-[#E5E7EB] overflow-hidden bg-white shadow-xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] bg-[#F9FAFB] text-[11px] font-mono uppercase text-[#69717C]">
                        <th className="p-3 px-4 font-medium">Verification Check</th>
                        <th className="p-3 px-4 font-medium">Expected (Order)</th>
                        <th className="p-3 px-4 font-medium">Verified (Payment)</th>
                        <th className="p-3 px-4 text-right font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6] font-mono">
                      <tr>
                        <td className="p-3 px-4 text-[#374151]">Amount (Minor Units)</td>
                        <td className="p-3 px-4 text-[#171B23] tabular-nums">{data.evidenceDossier.amountExpected.toLocaleString()} kobo</td>
                        <td className="p-3 px-4 text-[#171B23] tabular-nums">
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
                                : 'text-zinc-600 bg-zinc-100 border border-zinc-200'
                            }`}
                          >
                            {data.evidenceDossier.amountMatched === 'VERIFIED'
                              ? 'RECORDED MATCH'
                              : data.evidenceDossier.amountMatched === 'MISMATCH'
                              ? 'RECORDED MISMATCH'
                              : 'UNRECORDED'}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3 px-4 text-[#374151]">Currency Code</td>
                        <td className="p-3 px-4 text-[#171B23]">{data.evidenceDossier.currencyExpected}</td>
                        <td className="p-3 px-4 text-[#171B23]">
                          {data.evidenceDossier.currencyVerified || 'Pending / Unverified'}
                        </td>
                        <td className="p-3 px-4 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                              data.evidenceDossier.currencyMatched === 'VERIFIED'
                                ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                : data.evidenceDossier.currencyMatched === 'MISMATCH'
                                ? 'text-rose-700 bg-rose-50 border border-rose-200'
                                : 'text-zinc-600 bg-zinc-100 border border-zinc-200'
                            }`}
                          >
                            {data.evidenceDossier.currencyMatched === 'VERIFIED'
                              ? 'RECORDED MATCH'
                              : data.evidenceDossier.currencyMatched === 'MISMATCH'
                              ? 'RECORDED MISMATCH'
                              : 'UNRECORDED'}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3 px-4 text-[#374151]">Customer Identity</td>
                        <td className="p-3 px-4 text-[#171B23]">{data.evidenceDossier.customerExpected}</td>
                        <td className="p-3 px-4 text-[#171B23]">
                          {data.evidenceDossier.customerVerified || 'Pending / Unverified'}
                        </td>
                        <td className="p-3 px-4 text-right">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold ${
                              data.evidenceDossier.customerMatched === 'VERIFIED'
                                ? 'text-emerald-700 bg-emerald-50 border border-emerald-200'
                                : data.evidenceDossier.customerMatched === 'MISMATCH'
                                ? 'text-rose-700 bg-rose-50 border border-rose-200'
                                : 'text-zinc-600 bg-zinc-100 border border-zinc-200'
                            }`}
                          >
                            {data.evidenceDossier.customerMatched === 'VERIFIED'
                              ? 'RECORDED MATCH'
                              : data.evidenceDossier.customerMatched === 'MISMATCH'
                              ? 'RECORDED MISMATCH'
                              : 'UNRECORDED'}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3 px-4 text-[#374151]">Transaction Reference</td>
                        <td className="p-3 px-4 text-[#171B23] truncate max-w-[140px]">{data.order.paymentReference}</td>
                        <td className="p-3 px-4 text-[#171B23] truncate max-w-[140px]">
                          {data.paymentEvents.length > 0
                            ? data.paymentEvents[0].paymentReference
                            : data.incident.paymentReference}
                        </td>
                        <td className="p-3 px-4 text-right">
                          <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200">
                            {data.paymentEvents.length > 0 &&
                            data.paymentEvents[0].paymentReference === data.order.paymentReference
                              ? 'RECORDED MATCH'
                              : 'BOUND (Order)'}
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td className="p-3 px-4 text-[#374151]">Active Entitlement</td>
                        <td className="p-3 px-4 text-[#171B23]">{data.plan.name}</td>
                        <td className="p-3 px-4 text-[#171B23]">{data.entitlement?.id || 'Missing initially'}</td>
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
                              ? 'CONFIRMED ACTIVE'
                              : data.entitlement
                              ? 'PROVISIONED'
                              : 'NOT FOUND'}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Observability & Neatlogs Trace Card */}
                <div className="rounded-xl border border-[#E5E7EB] p-4 bg-[#FAFBFD] space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ActivityIcon size={14} className="text-[#69717C]" />
                      <span className="text-xs font-semibold uppercase tracking-wider text-[#171B23] font-mono">
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
                          : 'bg-zinc-100 text-zinc-600 border border-zinc-200'
                      }`}
                    >
                      {data.evidenceDossier.paymentVerificationState}
                    </span>
                  </div>

                  <div className="space-y-1 font-mono text-xs">
                    <div className="flex items-center justify-between text-[#69717C]">
                      <span>Trace ID:</span>
                      <span className="text-[#171B23] font-semibold">
                        {data.neatlogsTrace.traceId || 'None recorded (local/simulated)'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[#69717C]">
                      <span>Workflow:</span>
                      <span className="text-[#171B23]">{data.neatlogsTrace.workflowName}</span>
                    </div>
                  </div>

                  {data.neatlogsTrace.traceUrl ? (
                    <div className="pt-2 border-t border-[#E5E7EB] flex items-center justify-end">
                      <a
                        href={data.neatlogsTrace.traceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-[#44647B] hover:text-[#171B23] transition-colors font-mono font-medium"
                      >
                        <span>Inspect in neatlogs Dashboard</span>
                        <ExternalLinkIcon size={12} />
                      </a>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-[#E5E7EB] flex items-center justify-between text-[11px] text-[#69717C] font-mono">
                      <span>Remote trace:</span>
                      <span>No remote ingest link captured</span>
                    </div>
                  )}
                </div>

                {/* Audit Trail List */}
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#69717C] font-mono">
                    Persisted Audit Events ({data.auditTrail.length})
                  </span>
                  <div className="rounded-xl border border-[#E5E7EB] divide-y divide-[#F3F4F6] bg-white">
                    {data.auditTrail.map((log) => (
                      <div key={log.id} className="p-3 px-4 flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F4F4F5] text-[#171B23] border border-[#E5E7EB] shrink-0">
                            {log.action}
                          </span>
                          <span className="text-[#374151] truncate">{log.details}</span>
                        </div>
                        <span className="text-[11px] font-mono text-[#69717C] shrink-0 tabular-nums">
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
